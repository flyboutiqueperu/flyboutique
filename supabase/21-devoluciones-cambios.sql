-- =====================================================================
--  FLY BOUTIQUE — 21: DEVOLUCIONES PARCIALES Y CAMBIOS (talla, color u otra prenda)
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Después, Merge del PR.
--  - Se devuelven solo las prendas elegidas de una venta (no hace falta anular toda la venta).
--  - Cambio: lo devuelto vuelve al stock y la prenda nueva sale del stock, en un solo paso.
--  - Se calcula la diferencia: si la prenda nueva cuesta más, se cobra; si cuesta menos, se devuelve.
--    Lo devuelto vale lo que se pagó (con el descuento que tuvo la venta; el envío no se devuelve).
--  - Si se paga o devuelve en EFECTIVO, queda como entrada/salida de la caja abierta (el arqueo cuadra).
--  - Puntos del Club: se quitan en proporción a lo devuelto.
--  - No se puede devolver más de lo vendido. Reintentar no duplica (mismo código de operación).
--  - Solo Super Admin, Administración y Cajero(a). Todo queda en la venta, en el historial de stock y en la auditoría.
--  No borra datos. Para volver atrás: 21-devoluciones-VOLVER-ATRAS.sql
-- =====================================================================

create or replace function public.return_sale(p_sale_id text, p_lines jsonb, p_reason text, p_method text default 'Efectivo',
                                              p_new_items jsonb default '[]'::jsonb, p_location text default null,
                                              p_request_id text default null, p_seller text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; d jsonb; it jsonb; l jsonb; si jsonb; pidx int; vidx int; st int; pr numeric; q int; sold int; already int;
  label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint; who text := public.my_staff_name(); seller text;
  ratio numeric; ret_amount numeric := 0; new_amount numeric := 0; diff numeric; ret_lines jsonb := '[]'::jsonb; new_lines jsonb := '[]'::jsonb;
  loc text; cash_id uuid; ph text; pts_off int := 0; total numeric; ship numeric; sub numeric; rec jsonb; rid text;
  movs jsonb := '[]'::jsonb; method text := coalesce(nullif(trim(p_method), ''), 'Efectivo');
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'NADA_PARA_DEVOLVER'; end if;
  if jsonb_typeof(coalesce(p_new_items, '[]'::jsonb)) <> 'array' then raise exception 'DATOS_INVALIDOS'; end if;
  if method not in ('Efectivo', 'Yape', 'Plin', 'Tarjeta', 'Transferencia', 'Vale') then raise exception 'METODO_INVALIDO'; end if;
  seller := case when coalesce(trim(p_seller), '') <> '' then public.seller_tag(p_seller) end;   -- el código es opcional aquí

  select data into s from public.sales where id = p_sale_id for update;
  if s is null then raise exception 'VENTA_NO_EXISTE'; end if;
  if s->>'status' = 'anulado' then raise exception 'VENTA_ANULADA'; end if;
  if s->>'source' = 'web' and coalesce(s->>'paymentStatus', '') <> 'confirmado' then raise exception 'PEDIDO_SIN_PAGO'; end if;
  -- Reintento: si esta operación ya se guardó, se devuelve igual (no se duplica)
  rid := coalesce(nullif(trim(p_request_id), ''), 'dev_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  if exists (select 1 from jsonb_array_elements(coalesce(s->'returns', '[]'::jsonb)) r where r->>'id' = rid) then
    return s || jsonb_build_object('duplicate', true);
  end if;
  label := coalesce(s->>'serie', '') || '-' || lpad(coalesce(s->>'numero', '0'), 6, '0');

  -- Cuánto se pagó de verdad por cada sol de prendas (descuentos, puntos, cupón). El envío no se devuelve.
  total := coalesce(public.fly_num(s->>'total'), 0);
  ship := coalesce(public.fly_num(s->>'shipping'), 0);
  sub := coalesce(nullif(public.fly_num(s->>'subtotal'), 0), (select sum(coalesce(public.fly_num(x->>'unitPrice'), 0) * coalesce((x->>'qty')::int, 0)) from jsonb_array_elements(s->'items') x));
  ratio := case when coalesce(sub, 0) > 0 then least(greatest((total - ship) / sub, 0), 1) else 1 end;

  -- Prendas que vuelven: no más de lo vendido menos lo ya devuelto
  for l in select * from jsonb_array_elements(p_lines) loop
    q := coalesce((l->>'qty')::int, 0);
    if q <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    select x into si from jsonb_array_elements(s->'items') x where x->>'variantId' = l->>'variantId' limit 1;
    if si is null then raise exception 'NO_ESTA_EN_LA_VENTA'; end if;
    sold := (select coalesce(sum((x->>'qty')::int), 0) from jsonb_array_elements(s->'items') x where x->>'variantId' = l->>'variantId');
    already := (select coalesce(sum((y->>'qty')::int), 0) from jsonb_array_elements(coalesce(s->'returns', '[]'::jsonb)) r, jsonb_array_elements(r->'lines') y where y->>'variantId' = l->>'variantId');
    if q + already > sold then raise exception 'YA_DEVUELTO:%', greatest(sold - already, 0); end if;
    pr := round(coalesce(public.fly_num(si->>'unitPrice'), 0) * ratio, 2);
    ret_amount := ret_amount + pr * q;
    ret_lines := ret_lines || jsonb_build_array(jsonb_build_object('variantId', si->'variantId', 'productId', si->'productId', 'name', si->'name',
                  'size', si->'size', 'colorName', si->'colorName', 'qty', q, 'unitPrice', pr));
  end loop;

  select data into d from public.store_data where id = 'main' for update;
  loc := coalesce(nullif(trim(coalesce(p_location, '')), ''), case when s->>'storeId' = any(public.stock_locations(d)) then s->>'storeId' end, 'principal');
  if not (loc = any(public.stock_locations(d))) then raise exception 'UBICACION_INVALIDA'; end if;

  -- 1) Lo devuelto vuelve al stock (en el lugar elegido)
  for l in select * from jsonb_array_elements(ret_lines) loop
    pidx := null;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int into pidx, vidx, st
      from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = l->>'variantId' limit 1;
    if pidx is not null then
      d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st + (l->>'qty')::int));
      movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
        'productId', l->'productId', 'productName', l->'name', 'variantId', l->'variantId', 'size', l->'size', 'colorName', l->'colorName',
        'type', 'devolucion', 'qty', (l->>'qty')::int, 'note', 'Devolución de ' || label || ': ' || trim(p_reason), 'staffName', who, 'createdAt', now_ms));
    end if;
  end loop;
  perform public.set_stock_context(jsonb_build_object('type', 'anulación / devolución', 'doc', label, 'saleId', p_sale_id,
    'customer', nullif(trim(coalesce(s->>'customerName', '') || ' ' || coalesce(s->>'customerDoc', s->>'customerPhone', '')), ''),
    'seller', coalesce(seller, s->>'staffName'), 'staff', who, 'store', loc, 'location', loc, 'channel', s->>'channel', 'note', 'Devolución: ' || trim(p_reason),
    'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(ret_lines) x)));
  update public.store_data set data = d, updated_at = now() where id = 'main';

  -- 2) Cambio: la prenda nueva sale del stock, a su precio actual
  if jsonb_array_length(coalesce(p_new_items, '[]'::jsonb)) > 0 then
    select data into d from public.store_data where id = 'main' for update;
    for it in select * from jsonb_array_elements(p_new_items) loop
      q := coalesce((it->>'qty')::int, 0);
      if q <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
      pidx := null;
      select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int, public.fly_num(p.val->>'price'),
             jsonb_build_object('variantId', v.val->'id', 'productId', p.val->'id', 'name', p.val->'name', 'size', v.val->'size', 'colorName', v.val->'colorName')
        into pidx, vidx, st, pr, si
        from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
       where v.val->>'id' = it->>'variantId' limit 1;
      if pidx is null then raise exception 'PRODUCTO_NO_EXISTE'; end if;
      if st < q then raise exception 'SIN_STOCK:%', si->>'name'; end if;
      d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - q));
      new_amount := new_amount + coalesce(pr, 0) * q;
      new_lines := new_lines || jsonb_build_array(si || jsonb_build_object('qty', q, 'unitPrice', coalesce(pr, 0)));
      movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
        'productId', si->'productId', 'productName', si->'name', 'variantId', si->'variantId', 'size', si->'size', 'colorName', si->'colorName',
        'type', 'venta', 'qty', q, 'note', 'Cambio en ' || label, 'staffName', who, 'createdAt', now_ms));
    end loop;
    perform public.set_stock_context(jsonb_build_object('type', 'venta', 'doc', label, 'saleId', p_sale_id,
      'customer', nullif(trim(coalesce(s->>'customerName', '') || ' ' || coalesce(s->>'customerDoc', s->>'customerPhone', '')), ''),
      'seller', coalesce(seller, s->>'staffName'), 'staff', who, 'store', loc, 'location', loc, 'channel', s->>'channel', 'note', 'Cambio: ' || trim(p_reason),
      'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(new_lines) x)));
    update public.store_data set data = d, updated_at = now() where id = 'main';
  end if;
  perform public.log_stock_movements(movs);

  -- 3) Dinero: positivo = se devuelve a la persona; negativo = la persona paga la diferencia
  diff := round(ret_amount - new_amount, 2);
  if method = 'Efectivo' and diff <> 0 then
    select id into cash_id from public.cash_sessions where store_id = loc and status = 'abierta' order by opened_at desc limit 1;
    if cash_id is null then select id into cash_id from public.cash_sessions where store_id = 'principal' and status = 'abierta' order by opened_at desc limit 1; end if;
    if cash_id is null then raise exception 'CAJA_CERRADA'; end if;
    insert into public.cash_movements (session_id, type, amount, reason, created_by, created_by_name, seller)
    values (cash_id, case when diff > 0 then 'salida' else 'entrada' end, abs(diff),
            case when diff > 0 then 'Devolución ' else 'Diferencia por cambio ' end || label || ': ' || trim(p_reason), auth.uid(), who, seller);
  end if;

  -- 4) Puntos del Club: se quitan en proporción a lo que se devolvió (no a lo cambiado)
  ph := regexp_replace(coalesce(s->>'customerPhone', ''), '\D', '', 'g');
  if diff > 0 and total - ship > 0 and coalesce((s->>'earnedPoints')::int, 0) > 0 and length(ph) >= 7 then
    pts_off := least(floor(coalesce((s->>'earnedPoints')::int, 0) * diff / (total - ship))::int, coalesce((s->>'earnedPoints')::int, 0) - coalesce((s->>'pointsReturned')::int, 0));
    pts_off := greatest(pts_off, 0);
    if pts_off > 0 then
      update public.customers set data = data || jsonb_build_object('points', greatest(coalesce((data->>'points')::int, 0) - pts_off, 0)) where phone = ph;
    end if;
  end if;

  rec := jsonb_build_object('id', rid, 'at', now_ms, 'by', who, 'seller', seller, 'reason', trim(p_reason), 'method', method, 'location', loc,
           'lines', ret_lines, 'newItems', new_lines, 'returnedAmount', ret_amount, 'newAmount', new_amount, 'difference', diff,
           'cashSessionId', cash_id, 'pointsRemoved', pts_off);
  update public.sales set data = data || jsonb_build_object(
           'returns', coalesce(data->'returns', '[]'::jsonb) || jsonb_build_array(rec),
           'refundedTotal', round(coalesce(public.fly_num(data->>'refundedTotal'), 0) + diff, 2),
           'pointsReturned', coalesce((data->>'pointsReturned')::int, 0) + pts_off,
           'returnStatus', case when (select coalesce(sum((x->>'qty')::int), 0) from jsonb_array_elements(data->'items') x)
                                     <= (select coalesce(sum((y->>'qty')::int), 0) from jsonb_array_elements(coalesce(data->'returns', '[]'::jsonb) || jsonb_build_array(rec)) r, jsonb_array_elements(r->'lines') y)
                                     and jsonb_array_length(new_lines) = 0 and not exists (select 1 from jsonb_array_elements(coalesce(data->'returns', '[]'::jsonb)) r where jsonb_array_length(coalesce(r->'newItems', '[]'::jsonb)) > 0)
                                then 'devuelto' else 'parcial' end)
   where id = p_sale_id returning data into s;
  perform public.audit(case when jsonb_array_length(new_lines) > 0 then 'cambio_prendas' else 'devolucion' end,
    jsonb_build_object('sale', p_sale_id, 'doc', label, 'devuelto', ret_amount, 'nuevo', new_amount, 'diferencia', diff, 'metodo', method, 'motivo', p_reason));
  return s;
end $$;
revoke execute on function public.return_sale(text, jsonb, text, text, jsonb, text, text, text) from public, anon;
grant execute on function public.return_sale(text, jsonb, text, text, jsonb, text, text, text) to authenticated;

-- Caja busca la venta por su número (ej. B001-000123) aunque la haya cobrado otra cuenta.
-- Solo devuelve UNA venta exacta (no permite listar todas).
create or replace function public.find_sale_for_return(p_doc text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m text[]; s jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  m := regexp_match(upper(trim(coalesce(p_doc, ''))), '^([A-Z]\d{3})\D*0*(\d{1,9})$');
  if m is null then raise exception 'NUMERO_INVALIDO'; end if;
  select data into s from public.sales where data->>'serie' = m[1] and (data->>'numero')::bigint = m[2]::bigint
   order by (data->>'createdAt')::bigint desc nulls last limit 1;
  return s;
end $$;
revoke execute on function public.find_sale_for_return(text) from public, anon;
grant execute on function public.find_sale_for_return(text) to authenticated;

-- Anular una venta que ya tuvo devoluciones devolvería el stock dos veces: se bloquea.
-- (Para lo que queda, se registra otra devolución con las prendas que faltan.)
create or replace function public.void_sale(p_sale_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if exists (select 1 from public.sales where id = p_sale_id and jsonb_array_length(coalesce(data->'returns', '[]'::jsonb)) > 0) then
    raise exception 'TIENE_DEVOLUCIONES';
  end if;
  return public.void_sale_core(p_sale_id, p_reason, public.my_staff_name());
end $$;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select proname from pg_proc where proname = 'return_sale';
-- =====================================================================
