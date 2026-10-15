-- 27 · Promociones automáticas en caja
-- Panel → Más → «Promociones en caja» guarda las reglas en store_data.settings.posPromos:
--   { id, active, name, kind: 'monto' | 'producto', minAmount, triggerProductIds[], targetProductIds[], price }
--   monto:    si lo demás de la venta suma al menos minAmount, UNA prenda de targetProductIds se cobra a «price».
--   producto: si la venta lleva alguna prenda de triggerProductIds, UNA prenda de targetProductIds se cobra a «price».
-- El servidor recalcula el descuento permitido (la caja no puede inventarlo) y NO lo cuenta dentro del tope
-- de descuento manual de las vendedoras. pos_sale es la misma del SQL 17 con ese agregado.
-- No borra datos. Para volver atrás: 27-promos-caja-VOLVER-ATRAS.sql

create or replace function public.auto_promo_discount(d jsonb, items jsonb) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare pr jsonb; it jsonb; total numeric := 0; best numeric; others numeric; price numeric; cat numeric; pid text; ok boolean; used text[] := '{}';
begin
  if jsonb_typeof(items) <> 'array' then return 0; end if;
  for pr in select x from jsonb_array_elements(coalesce(d->'settings'->'posPromos', '[]'::jsonb)) x where coalesce((x->>'active')::boolean, true) loop
    price := greatest(coalesce(public.fly_num(pr->>'price'), 0), 0);
    best := 0; pid := null;
    for it in select x from jsonb_array_elements(items) x loop
      if coalesce(pr->'targetProductIds', '[]'::jsonb) ? (it->>'productId') and not ((it->>'variantId') = any(used)) then
        select (p->>'price')::numeric into cat from jsonb_array_elements(d->'products') p where p->>'id' = it->>'productId' limit 1;
        if cat is null then continue; end if;
        -- condición
        if pr->>'kind' = 'monto' then
          select coalesce(sum((y->>'unitPrice')::numeric * (y->>'qty')::int), 0) - cat into others from jsonb_array_elements(items) y;
          ok := others + 0.001 >= coalesce(public.fly_num(pr->>'minAmount'), 0);
        else
          ok := exists (select 1 from jsonb_array_elements(items) y where coalesce(pr->'triggerProductIds', '[]'::jsonb) ? (y->>'productId')
                          and ((y->>'variantId') <> (it->>'variantId') or (y->>'qty')::int > 1));
        end if;
        if ok and cat - price > best then best := cat - price; pid := it->>'variantId'; end if;
      end if;
    end loop;
    if pid is not null then total := total + best; used := used || pid; end if;
  end loop;
  return round(total, 2);
end $$;
revoke execute on function public.auto_promo_discount(jsonb, jsonb) from public, anon;
grant execute on function public.auto_promo_discount(jsonb, jsonb) to authenticated;

create or replace function public.pos_sale(p_sale jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int;
  sub numeric := 0; disc numeric; tot numeric; v_serie text; n int; sid text; sale jsonb; prev jsonb;
  movs jsonb := '[]'::jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  ph text; earned int := 0; l jsonb; sps numeric; pps numeric; paid numeric; v_seller text; v_cashier text;
  promo jsonb; promo_disc numeric := 0; used int; bp numeric; bv numeric; pdisc numeric := 0; cpts int; manual numeric; cap numeric;
  outlet_sub numeric := 0; is_out boolean; ap numeric := 0;
  is_store boolean := coalesce(p_sale->>'channel', 'tienda') <> 'online'; v_store text; cash_id uuid; seller record; v_seller_code text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'VENTA_VACIA'; end if;

  -- Reintento de la misma venta: se devuelve la ya guardada, no se duplica
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data ? 'clientRequestId' and data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  v_cashier := public.my_staff_name();
  v_store := coalesce(nullif(trim(p_sale->>'storeId'), ''), 'principal');
  if is_store then
    -- Venta en tienda: tiene que haber una caja abierta en esa sede
    select id into cash_id from public.cash_sessions where store_id = v_store and status = 'abierta' order by opened_at desc limit 1;
    if cash_id is null then raise exception 'CAJA_CERRADA'; end if;
    -- Quién vendió: su código (ej. MA01). El código identifica a la vendedora, no da permisos.
    select * into seller from public.sellers where code = upper(trim(coalesce(p_sale->>'sellerCode', ''))) and active;
    if seller.code is not null then
      v_seller := seller.name; v_seller_code := seller.code;
    elsif exists (select 1 from public.sellers where active) then
      raise exception 'VENDEDOR_INVALIDO';
    end if;
  end if;
  if v_seller is null then
    -- Sin códigos creados todavía (o venta online): la vendedora elegida debe ser del staff activo; si no, quien cobra
    v_seller := p_sale->>'staffName';
    if v_seller is null or not exists (select 1 from public.staff_profiles where name = v_seller and coalesce(active, true)) then
      v_seller := v_cashier;
    end if;
  end if;

  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    pidx := null; vidx := null; st := null; pr := null; is_out := false;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0), (p.val->>'price')::numeric, coalesce(p.val->>'outlet', '') = 'true'
      into pidx, vidx, st, pr, is_out
      from jsonb_array_elements(d->'products') with ordinality p(val, ord),
           jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then raise exception 'PRODUCTO_NO_EXISTE:%', it->>'name'; end if;
    if st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from (it->>'unitPrice')::numeric then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
    if is_out then outlet_sub := outlet_sub + pr * qty; end if;   -- Outlet: precio final
    movs := movs || jsonb_build_array(jsonb_build_object(
      'id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
      'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId',
      'size', it->'size', 'colorName', it->'colorName', 'type', 'venta', 'qty', qty,
      'staffName', v_seller, 'storeId', p_sale->'storeId', 'createdAt', now_ms));
  end loop;

  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');

  -- Código promocional: lo calcula el servidor
  if coalesce(trim(p_sale->>'promoCode'), '') <> '' then
    select x into promo from jsonb_array_elements(coalesce(d->'promoCodes', '[]'::jsonb)) x
     where coalesce((x->>'active')::boolean, false) and lower(x->>'code') = lower(trim(p_sale->>'promoCode')) limit 1;
    if promo is null then raise exception 'PROMO_INVALIDA'; end if;
    if promo->>'type' = 'percent' then
      -- Los cupones no aplican a prendas Outlet
      promo_disc := floor((sub - outlet_sub)::float8 * (coalesce(public.fly_num(promo->>'value'), 0)::float8 / 100) + 0.5)::numeric;
    else
      promo_disc := least(coalesce(public.fly_num(promo->>'value'), 0), sub - outlet_sub);
    end if;
  end if;

  -- Puntos usados en tienda (la clienta está presente): se revisan y se descuentan ya
  used := coalesce(public.fly_num(p_sale->>'pointsUsed'), 0)::int;
  if used > 0 and not public.club_enabled(d) then raise exception 'CLUB_DESACTIVADO'; end if;
  if used > 0 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    bp := greatest(1, coalesce(nullif(public.fly_num(l->>'blockPoints'), 0), 100));
    bv := case when l ? 'blockValue' then coalesce(public.fly_num(l->>'blockValue'), 0) else 3 end;
    if bv <= 0 or used % bp::int <> 0 or length(ph) < 7 then raise exception 'PUNTOS_INVALIDOS'; end if;
    pdisc := (used / bp::int) * bv;
    if pdisc > sub - outlet_sub - promo_disc then raise exception 'PUNTOS_INVALIDOS'; end if;   -- los puntos no se usan en Outlet
    select coalesce((data->>'points')::int, 0) into cpts from public.customers where phone = ph for update;
    if cpts is null or cpts < used then raise exception 'PUNTOS_INSUFICIENTES'; end if;
    update public.customers set data = jsonb_set(data, '{points}', to_jsonb(cpts - used)) where phone = ph;
  end if;

  disc := least(greatest(coalesce((p_sale->>'discount')::numeric, 0), 0), sub);
  if disc + 0.01 < promo_disc + pdisc then raise exception 'DESCUENTO_INVALIDO'; end if;
  -- Promociones automáticas de caja (Panel → Promociones en caja): el servidor calcula cuánto se puede descontar
  ap := least(greatest(coalesce(public.fly_num(p_sale->>'autoPromoDiscount'), 0), 0), public.auto_promo_discount(d, p_sale->'items'), greatest(disc - promo_disc - pdisc, 0));
  -- Descuento manual: las vendedoras tienen un tope (Panel → ajustes; 20% si no se configuró). Administración no tiene tope.
  manual := disc - promo_disc - pdisc - ap;
  if manual > 0 and not public.has_role('superadmin', 'administrador') then
    cap := coalesce(public.fly_num(d->'settings'->>'posMaxDiscountPct'), 20);
    if manual > round(sub * cap / 100, 2) + 0.01 then raise exception 'DESCUENTO_EXCEDE:%', cap; end if;
  end if;
  tot := round(sub - disc, 2);
  if p_sale ? 'payments' and jsonb_typeof(p_sale->'payments') = 'array' and jsonb_array_length(p_sale->'payments') > 0 then
    select coalesce(sum((x->>'amount')::numeric), 0) into paid from jsonb_array_elements(p_sale->'payments') x;
    if abs(paid - tot) > 0.01 then raise exception 'PAGO_INCOMPLETO'; end if;
  end if;

  v_serie := case when p_sale->>'tipo' = 'factura' then 'F001' else 'B001' end;
  insert into public.doc_counters (serie, next_number) values (v_serie, 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = v_serie returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);

  -- Historial de stock: qué venta es, a quién, quién vendió y a qué precio
  perform public.set_stock_context(jsonb_build_object('type', 'venta', 'doc', v_serie || '-' || lpad(n::text, 6, '0'), 'saleId', sid,
    'customer', nullif(trim(coalesce(p_sale->>'customerName', '') || ' ' || coalesce(p_sale->>'customerDoc', '')), ''),
    'seller', case when v_seller_code is not null then v_seller_code || ' · ' || v_seller else v_seller end, 'staff', v_cashier,
    'store', case when is_store then v_store else 'web' end, 'channel', coalesce(p_sale->>'channel', 'tienda'),
    'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(p_sale->'items') x)));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  sale := p_sale || jsonb_build_object('id', sid, 'serie', v_serie, 'numero', n, 'subtotal', sub, 'discount', disc, 'total', tot,
           'status', 'emitido', 'source', 'pos', 'staffUserId', auth.uid()::text, 'staffName', v_seller, 'cashierName', v_cashier,
           'pointsUsed', used, 'pointsDiscount', pdisc, 'outletSubtotal', outlet_sub, 'pointsDeducted', used > 0, 'manualDiscount', greatest(manual, 0), 'autoPromoDiscount', ap,
           'cashSessionId', cash_id, 'sellerCode', v_seller_code, 'storeId', case when is_store then v_store else p_sale->'storeId' #>> '{}' end,
           'createdAt', now_ms);
  insert into public.sales (id, data) values (sid, sale);

  perform public.log_stock_movements((select coalesce(jsonb_agg(m || jsonb_build_object('note', 'Venta ' || v_serie || '-' || lpad(n::text, 6, '0'))), '[]'::jsonb) from jsonb_array_elements(movs) m));

  -- Clienta y puntos (si dio su celular)
  if length(ph) >= 7 and not coalesce((p_sale->>'anonymous')::boolean, false) then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    -- Las prendas Outlet no suman puntos
    earned := case when public.club_enabled(d) then (floor(greatest(sub - outlet_sub - disc, 0) / sps) * pps)::int else 0 end;
    if exists (select 1 from public.customers where phone = ph) then
      update public.customers
         set data = data || jsonb_build_object('points', coalesce((data->>'points')::int, 0) + earned)
                  || case when coalesce(data->>'doc', '') = '' then jsonb_build_object('doc', coalesce(p_sale->>'customerDoc', '')) else '{}'::jsonb end
                  || case when coalesce(data->>'email', '') = '' then jsonb_build_object('email', coalesce(p_sale->>'customerEmail', '')) else '{}'::jsonb end
       where phone = ph;
    else
      insert into public.customers (phone, data) values (ph, jsonb_build_object(
        'id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', coalesce(p_sale->>'customerName', ''), 'phone', ph,
        'doc', coalesce(p_sale->>'customerDoc', ''), 'email', coalesce(p_sale->>'customerEmail', ''),
        'points', earned, 'via', 'tienda', 'createdAt', now_ms));
    end if;
  end if;
  sale := sale || jsonb_build_object('earnedPoints', earned);
  update public.sales set data = sale where id = sid;
  return sale;
end $$;
