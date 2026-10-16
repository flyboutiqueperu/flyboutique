-- =====================================================================
--  30 · Inventario: tres arreglos encontrados con la prueba completa (pruebas/sql/t30-inventario.sql)
--  1) Entrada/devolución en Almacén de una prenda que aún no tenía stock por sede: quedaba contada en Larco.
--  2) Pedido web pagado justo cuando se cancelaba (a mano o por vencimiento): quedaba anulado y su prenda
--     volvía a venderse. Ahora se bloquea la fila y se revisa el pago antes de anular.
--  3) Pedido web cancelado: la prenda volvía a Larco aunque había salido del Almacén. Ahora el pedido
--     guarda de qué sede salió (stockFrom, lo decide el servidor) y vuelve ahí.
--  No borra datos. Correr ANTES del Merge (el código no depende de esto; se puede correr en cualquier orden).
--  Volver atrás: 30-inventario-arreglos-VOLVER-ATRAS.sql
-- =====================================================================
create or replace function public.reconcile_stock_locations() returns trigger
language plpgsql security definer set search_path = public as $$
declare ctx jsonb; locs text[]; pref text; r record; sb jsonb; total int; delta int; take int; l text; order_l text[]; d jsonb := NEW.data;
begin
  begin ctx := coalesce(nullif(current_setting('fly.mov', true), ''), '{}')::jsonb; exception when others then ctx := '{}'::jsonb; end;
  locs := public.stock_locations(d);
  pref := coalesce(case when ctx->>'location' = any(locs) then ctx->>'location' end, case when ctx->>'store' = any(locs) then ctx->>'store' end, 'principal');
  -- Prendas que aún no tienen stock por sede: si el cambio es en OTRA sede (ej. entrada en Almacén),
  -- primero se les crea su stockBy (lo que había = Larco) para que el cambio quede en la sede correcta.
  if TG_OP = 'UPDATE' and pref <> 'principal' then
    for r in
      select (p.ord - 1)::int pi, (v.ord - 1)::int vi, v.val,
             (select coalesce(public.fly_num(ov->>'stock'), 0)::int from jsonb_array_elements(coalesce(OLD.data->'products', '[]'::jsonb)) op,
                     jsonb_array_elements(coalesce(op->'variants', '[]'::jsonb)) ov where ov->>'id' = v.val->>'id' limit 1) old_st
        from jsonb_array_elements(coalesce(d->'products', '[]'::jsonb)) with ordinality p(val, ord),
             jsonb_array_elements(coalesce(p.val->'variants', '[]'::jsonb)) with ordinality v(val, ord)
       where jsonb_typeof(v.val->'stockBy') is distinct from 'object' and v.val->>'id' is not null
    loop
      if r.old_st is not null and coalesce(public.fly_num(r.val->>'stock'), 0)::int <> r.old_st then
        d := jsonb_set(d, array['products', r.pi::text, 'variants', r.vi::text, 'stockBy'], jsonb_build_object('principal', r.old_st));
      end if;
    end loop;
  end if;
  for r in
    select (p.ord - 1)::int pi, (v.ord - 1)::int vi, v.val
      from jsonb_array_elements(coalesce(d->'products', '[]'::jsonb)) with ordinality p(val, ord),
           jsonb_array_elements(coalesce(p.val->'variants', '[]'::jsonb)) with ordinality v(val, ord)
     where jsonb_typeof(v.val->'stockBy') = 'object'
  loop
    sb := r.val->'stockBy';
    total := coalesce(public.fly_num(r.val->>'stock'), 0)::int;
    select total - coalesce(sum(greatest(coalesce(public.fly_num(value), 0), 0)), 0)::int into delta from jsonb_each_text(sb);
    if delta = 0 then continue; end if;
    if delta > 0 then
      sb := sb || jsonb_build_object(pref, coalesce((sb->>pref)::int, 0) + delta);
    else
      delta := -delta;
      order_l := array[pref, 'principal'] || locs || array(select jsonb_object_keys(sb));
      foreach l in array order_l loop
        exit when delta <= 0;
        take := least(delta, greatest(coalesce((sb->>l)::int, 0), 0));
        if take > 0 then sb := sb || jsonb_build_object(l, (sb->>l)::int - take); delta := delta - take; end if;
      end loop;
    end if;
    d := jsonb_set(d, array['products', r.pi::text, 'variants', r.vi::text, 'stockBy'], sb);
  end loop;
  NEW.data := d;
  return NEW;
end $$;

create or replace function public.cancel_unpaid_order(p_sale_id text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  select data into s from public.sales where id = p_sale_id for update;   -- bloquea antes de revisar el pago
  if s is null then raise exception 'PEDIDO_NO_EXISTE'; end if;
  if coalesce(s->>'source', '') <> 'web' or s->>'paymentStatus' = 'confirmado' then raise exception 'SOLO_PEDIDOS_SIN_PAGO'; end if;
  return public.void_sale_core(p_sale_id, coalesce(nullif(trim(p_reason), ''), 'Pago no recibido'), public.my_staff_name());
end $$;

-- ---------- Cancelación automática de pedidos sin pago ----------
-- Pasadas N horas (Panel → Pedidos; 24 por defecto; 0 = nunca) los pedidos web sin pago confirmado
-- se anulan solos y la prenda vuelve a estar disponible. La tienda llama a esta función al cargar.

create or replace function public.expire_unpaid_orders() returns int
language plpgsql security definer set search_path = public as $$
declare h numeric; r record; n int := 0;
begin
  select coalesce(public.fly_num(data->'settings'->>'unpaidOrderHours'), 24) into h from public.store_data where id = 'main';
  if h is null or h <= 0 then return 0; end if;
  for r in select id from public.sales
            where data->>'source' = 'web' and coalesce(data->>'status', '') <> 'anulado'
              and coalesce(data->>'paymentStatus', '') <> 'confirmado'
              and created_at < now() - make_interval(secs => (h * 3600)::double precision)
            order by created_at limit 50 loop
    -- se vuelve a revisar con la fila bloqueada (pudieron validar el pago recién)
    perform 1 from public.sales where id = r.id and coalesce(data->>'status', '') <> 'anulado' and coalesce(data->>'paymentStatus', '') <> 'confirmado' for update;
    if not found then continue; end if;
    perform public.void_sale_core(r.id, 'Pago no recibido en ' || h || ' h (cancelación automática)', 'Sistema');
    n := n + 1;
  end loop;
  return n;
end $$;


create or replace function public.place_order(p_sale jsonb, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int; n int; sale jsonb; sid text; prev jsonb;
  em text; gkey text; ph text; gpts int; crow jsonb; is_google boolean;
  sub numeric := 0; disc numeric := 0; ship numeric := 0; pdisc numeric := 0; tot numeric; client_tot numeric;
  outlet_sub numeric := 0; is_out boolean;
  promo jsonb; l jsonb; bp numeric; bv numeric; used int; cpts int; dm text; dep text; from_map jsonb;
begin
  if pg_column_size(p_sale) > 60000 then raise exception 'PEDIDO_INVALIDO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'PEDIDO_VACIO'; end if;

  -- Reintento del mismo pedido (se cortó internet): se devuelve el ya guardado
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data ? 'clientRequestId' and data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  em := lower(coalesce(auth.jwt()->>'email', ''));
  is_google := public.google_email() <> '';   -- cuenta confirmada (Google; desde el SQL 15 también código al correo)
  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');

  -- Stock y precios reales (bloqueando el catálogo para que nadie compre la misma unidad a la vez)
  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 or qty > 50 then raise exception 'PEDIDO_INVALIDO'; end if;
    pidx := null; vidx := null; st := null; pr := null; is_out := false;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int, public.fly_num(p.val->>'price'), coalesce(p.val->>'outlet', '') = 'true'
      into pidx, vidx, st, pr, is_out
      from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null or st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    -- Outlet pausado en Panel → Configuración: no se vende por la web
    if is_out and coalesce(d->'settings'->>'outletEnabled', 'true') = 'false' then raise exception 'OUTLET_CERRADO:%', it->>'name'; end if;
    if pr is distinct from public.fly_num(it->>'unitPrice') then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
    if is_out then outlet_sub := outlet_sub + pr * qty; end if;   -- Outlet: precio final
  end loop;

  -- Código promocional (se revisa en el servidor, no se confía en el navegador)
  if coalesce(trim(p_sale->>'promoCode'), '') <> '' then
    select x into promo from jsonb_array_elements(coalesce(d->'promoCodes', '[]'::jsonb)) x
     where coalesce((x->>'active')::boolean, false) and lower(x->>'code') = lower(trim(p_sale->>'promoCode')) limit 1;
    if promo is null then raise exception 'PROMO_INVALIDA'; end if;
    if coalesce((promo->>'clubOnly')::boolean, false)
       and not exists (select 1 from public.customers where phone = ph)
       and not (is_google and exists (select 1 from public.customers where phone = 'g:' || em)) then
      raise exception 'PROMO_SOLO_CLUB';
    end if;
    if promo->>'type' = 'percent' then
      -- igual que Math.round() de la tienda (mismo cálculo en coma flotante), para que el total coincida al céntimo
      -- Los cupones no aplican a prendas Outlet
      disc := floor((sub - outlet_sub)::float8 * (coalesce(public.fly_num(promo->>'value'), 0)::float8 / 100) + 0.5)::numeric;
    else
      disc := least(coalesce(public.fly_num(promo->>'value'), 0), sub - outlet_sub);
    end if;
  end if;

  -- Envío
  dm := coalesce(p_sale->>'deliveryMethod', 'recojo');
  dep := coalesce(p_sale->'deliveryDetails'->>'department', '');
  if dm = 'recojo' then ship := 0;
  elsif dm = 'provincia' then
    -- Tarifa del departamento configurada en Panel → Envíos; si no hay, la tarifa por defecto
    ship := coalesce(public.fly_num(d->'settings'->'provinceRates'->>dep), case
      when dep in ('La Libertad', 'Lambayeque', 'Piura', 'Tumbes', 'Cajamarca', 'Áncash', 'Amazonas', 'San Martín') then 12
      when dep in ('Lima', 'Callao', 'Ica', 'Junín', 'Pasco', 'Huánuco', 'Huancavelica', 'Ayacucho') then 15
      when dep in ('Arequipa', 'Moquegua', 'Tacna', 'Cusco', 'Puno', 'Apurímac') then 18
      when dep in ('Loreto', 'Ucayali', 'Madre de Dios') then 22
      else 15 end);
  elsif dm = 'internacional' then ship := greatest(coalesce(public.fly_num(p_sale->>'shipping'), 0), 0); -- se cotiza y confirma aparte
  else -- delivery local en Trujillo (precio y monto para envío gratis configurables)
    -- Las prendas Outlet no cuentan para el envío gratis
    ship := case when sub - outlet_sub >= coalesce(public.fly_num(d->'settings'->'localShipping'->>'freeFrom'), 200) then 0
                 else coalesce(public.fly_num(d->'settings'->'localShipping'->>'price'), 12) end;
  end if;

  -- Puntos del Club usados como descuento: se revisan y se descuentan YA (no se pueden usar dos veces)
  used := coalesce(public.fly_num(p_sale->>'pointsUsed'), 0)::int;
  if used > 0 and not public.club_enabled(d) then raise exception 'CLUB_DESACTIVADO'; end if;
  if used > 0 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    bp := greatest(1, coalesce(nullif(public.fly_num(l->>'blockPoints'), 0), 100));
    bv := case when l ? 'blockValue' then coalesce(public.fly_num(l->>'blockValue'), 0) else 3 end;
    if bv <= 0 or used % bp::int <> 0 then raise exception 'PUNTOS_INVALIDOS'; end if;
    pdisc := (used / bp::int) * bv;
    if pdisc > sub - outlet_sub - disc then raise exception 'PUNTOS_INVALIDOS'; end if;   -- los puntos no se usan en Outlet
    -- Usar puntos online solo con la cuenta de Google de la dueña de esos puntos
    if not public.owns_customer(ph) then raise exception 'PUNTOS_SOLO_GOOGLE'; end if;
    select coalesce((data->>'points')::int, 0) into cpts from public.customers where phone = ph for update;
    if cpts is null or cpts < used then raise exception 'PUNTOS_INSUFICIENTES'; end if;
    update public.customers set data = jsonb_set(data, '{points}', to_jsonb(cpts - used)) where phone = ph;
  end if;

  tot := round(greatest(sub + ship - disc - pdisc, 0), 2);
  client_tot := public.fly_num(p_sale->>'total');
  if client_tot is null or abs(client_tot - tot) > 0.05 then raise exception 'TOTAL_CAMBIO'; end if;

  insert into public.doc_counters (serie, next_number) values ('B001', 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = 'B001' returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);

  perform public.set_stock_context(jsonb_build_object('type', 'pedido web', 'doc', 'B001-' || lpad(n::text, 6, '0'), 'saleId', sid,
    'customer', nullif(trim(coalesce(p_sale->>'customerName', '') || ' ' || coalesce(p_sale->>'customerPhone', '')), ''),
    'seller', 'Tienda online', 'staff', 'Web', 'store', 'web', 'channel', 'online', 'note', 'Apartado hasta confirmar el pago',
    'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(p_sale->'items') x)));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  -- De qué sede salió cada unidad (lo decidió el cuadre): se guarda para devolverla al mismo lugar si se cancela
  with ids as (select distinct x->>'variantId' vid from jsonb_array_elements(p_sale->'items') x),
       antes as (select v->>'id' vid, v->'stockBy' sb from jsonb_array_elements(d->'products') p, jsonb_array_elements(p->'variants') v
                  where v->>'id' in (select vid from ids) and jsonb_typeof(v->'stockBy') = 'object'),
       despues as (select v->>'id' vid, v->'stockBy' sb from public.store_data sd, jsonb_array_elements(sd.data->'products') p, jsonb_array_elements(p->'variants') v
                  where sd.id = 'main' and v->>'id' in (select vid from ids))
  select coalesce(jsonb_object_agg(a.vid, (select jsonb_object_agg(e.key, e.value::int - coalesce((b.sb->>e.key)::int, 0)) from jsonb_each_text(a.sb) e
                                          where e.value::int - coalesce((b.sb->>e.key)::int, 0) > 0)), '{}'::jsonb) into from_map
    from antes a join despues b using (vid);
  sale := (p_sale - 'stockFrom') || jsonb_build_object('stockFrom', jsonb_strip_nulls(from_map)) || jsonb_build_object(
    'id', sid, 'tipo', 'boleta', 'serie', 'B001', 'numero', n,
    'channel', 'online', 'source', 'web', 'status', 'emitido',
    'paymentStatus', 'pendiente_validacion', 'fulfillment', 'pendiente',
    'staffName', 'Tienda Online (autoservicio web)',
    'subtotal', sub, 'discount', disc, 'shipping', ship, 'pointsUsed', used, 'pointsDiscount', pdisc, 'total', tot, 'outletSubtotal', outlet_sub,
    'stockReserved', true, 'pointsDeducted', used > 0,
    'buyerEmail', case when is_google then em else null end,
    'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.sales (id, data) values (sid, sale);
  delete from public.reservations where session_id = p_session;

  -- Vincular la cuenta de Google con el celular del pedido.
  -- Solo si ese celular aún no es clienta, o si es de la misma persona (mismo correo).
  -- Antes se podía "adueñar" del celular de otra clienta cambiándole el correo.
  if is_google and length(ph) >= 7 then
    gkey := 'g:' || em;
    select coalesce((data->>'points')::int, 0) into gpts from public.customers where phone = gkey for update;
    if found then
      select data into crow from public.customers where phone = ph for update;
      if crow is null then
        update public.customers set phone = ph, data = data || jsonb_build_object('phone', ph, 'googleEmail', em) where phone = gkey;
      elsif lower(coalesce(crow->>'email', '')) = em then
        update public.customers set data = jsonb_set(data, '{points}', to_jsonb(coalesce((data->>'points')::int, 0) + gpts)) || jsonb_build_object('googleEmail', em) where phone = ph;
        delete from public.customers where phone = gkey;
      end if;
    end if;
  end if;
  return sale;
end $$;


create or replace function public.void_sale_core(p_sale_id text, p_reason text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; it jsonb; pidx int; vidx int; st int; ph text; returned boolean; used int;
        movs jsonb := '[]'::jsonb; label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  select data into s from public.sales where id = p_sale_id for update;
  if s is null then raise exception 'VENTA_NO_EXISTE'; end if;
  if s->>'status' = 'anulado' then return s; end if;
  label := coalesce(s->>'serie', '') || '-' || lpad(coalesce(s->>'numero', '0'), 6, '0');

  -- Solo se devuelve el stock si de verdad se había descontado
  returned := coalesce((s->>'stockReserved')::boolean, false) or s->>'source' = 'pos' or s->>'paymentStatus' = 'confirmado';
  if returned then
    select data into d from public.store_data where id = 'main' for update;
    for it in select * from jsonb_array_elements(s->'items') loop
      pidx := null;
      select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0) into pidx, vidx, st
        from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
       where v.val->>'id' = it->>'variantId'
          or (coalesce(it->>'variantId', '') = '' and p.val->>'id' = it->>'productId' and v.val->>'size' = it->>'size' and v.val->>'colorName' = it->>'colorName')
       limit 1;
      if pidx is not null then
        d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st + (it->>'qty')::int));
        movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId', 'size', it->'size', 'colorName', it->'colorName',
          'type', 'ajuste', 'qty', (it->>'qty')::int, 'note', 'Anulación de ' || label || ': ' || trim(p_reason), 'staffName', p_by, 'createdAt', now_ms));
      end if;
    end loop;
    -- Pedido web: cada unidad vuelve a la sede de donde salió (stockFrom); el resto lo ordena el cuadre
    if jsonb_typeof(s->'stockFrom') = 'object' then
      for it in select jsonb_build_object('vid', key, 'fr', value) from jsonb_each(s->'stockFrom') loop
        pidx := null;
        select (p.ord - 1)::int, (v.ord - 1)::int into pidx, vidx
          from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
         where v.val->>'id' = it->>'vid' and jsonb_typeof(v.val->'stockBy') = 'object' limit 1;
        if pidx is not null then
          d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'],
                 (select jsonb_object_agg(k, coalesce((d->'products'->pidx->'variants'->vidx->'stockBy'->>k)::int, 0) + coalesce((it->'fr'->>k)::int, 0))
                    from (select jsonb_object_keys(d->'products'->pidx->'variants'->vidx->'stockBy') k union select jsonb_object_keys(it->'fr')) ks));
        end if;
      end loop;
    end if;
    perform public.set_stock_context(jsonb_build_object('type', case when s->>'source' = 'web' and coalesce(s->>'paymentStatus', '') <> 'confirmado' then 'pedido cancelado' else 'anulación / devolución' end,
      'doc', label, 'saleId', p_sale_id, 'customer', nullif(trim(coalesce(s->>'customerName', '') || ' ' || coalesce(s->>'customerDoc', s->>'customerPhone', '')), ''),
      'seller', s->>'staffName', 'staff', p_by, 'store', coalesce(s->>'storeId', 'web'), 'channel', s->>'channel', 'note', trim(p_reason),
      'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(s->'items') x)));
    update public.store_data set data = d, updated_at = now() where id = 'main';
    perform public.log_stock_movements(movs);
  end if;

  -- Puntos: se quitan los ganados y se devuelven los usados (solo si se habían descontado)
  ph := regexp_replace(coalesce(s->>'customerPhone', ''), '\D', '', 'g');
  used := case when coalesce((s->>'pointsDeducted')::boolean, false) or s->>'paymentStatus' = 'confirmado' then coalesce((s->>'pointsUsed')::int, 0) else 0 end;
  if length(ph) >= 7 and (coalesce((s->>'earnedPoints')::int, 0) > 0 or used > 0) then
    update public.customers set data = data || jsonb_build_object('points', greatest(coalesce((data->>'points')::int, 0) - coalesce((s->>'earnedPoints')::int, 0) + used, 0)) where phone = ph;
  end if;

  update public.sales set data = data || jsonb_build_object('status', 'anulado', 'voidReason', trim(p_reason), 'voidedBy', p_by,
         'voidedAt', now_ms, 'stockReturned', returned) where id = p_sale_id returning data into s;
  perform public.audit('venta_anulada', jsonb_build_object('sale', p_sale_id, 'motivo', p_reason, 'total', s->'total', 'por', p_by));
  return s;
end $$;



-- Comprobación (solo lectura): select position('stockFrom' in pg_get_functiondef('public.place_order(jsonb,text)'::regprocedure)) > 0;
