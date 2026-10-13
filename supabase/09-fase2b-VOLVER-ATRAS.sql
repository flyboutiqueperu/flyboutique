-- =====================================================================
--  FLY BOUTIQUE — VOLVER ATRÁS LA FASE 2b
--  1. En GitHub: "Revert" del Pull Request de la Fase 2b (o Vercel → versión anterior → Promote).
--  2. Correr ESTE archivo. Deja las funciones como quedaron con la Fase 2a. No borra datos.
-- =====================================================================

create or replace function public.my_orders(p_phone text) returns setof jsonb
language sql stable security definer set search_path = 'public' as $function$
  select jsonb_build_object('id', data->>'id', 'serie', data->'serie', 'numero', data->'numero', 'items', data->'items',
           'total', data->'total', 'fulfillment', data->'fulfillment', 'paymentStatus', data->'paymentStatus',
           'createdAt', data->'createdAt', 'deliveryMethod', data->'deliveryMethod')
  from public.sales
  where data->>'customerPhone' = p_phone and data->>'channel' = 'online' and length(coalesce(p_phone, '')) >= 7
  order by created_at desc limit 50
$function$;

create or replace function public.place_order(p_sale jsonb, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int; n int; sale jsonb; sid text; prev jsonb;
  em text; gkey text; ph text; gpts int; crow jsonb; is_google boolean;
  sub numeric := 0; disc numeric := 0; ship numeric := 0; pdisc numeric := 0; tot numeric; client_tot numeric;
  promo jsonb; l jsonb; bp numeric; bv numeric; used int; cpts int; dm text; dep text;
begin
  if pg_column_size(p_sale) > 60000 then raise exception 'PEDIDO_INVALIDO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'PEDIDO_VACIO'; end if;

  -- Reintento del mismo pedido (se cortó internet): se devuelve el ya guardado
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data ? 'clientRequestId' and data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  em := lower(coalesce(auth.jwt()->>'email', ''));
  is_google := auth.uid() is not null and em <> '' and (coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
               or coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google');
  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');

  -- Stock y precios reales (bloqueando el catálogo para que nadie compre la misma unidad a la vez)
  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 or qty > 50 then raise exception 'PEDIDO_INVALIDO'; end if;
    pidx := null; vidx := null; st := null; pr := null;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int, public.fly_num(p.val->>'price')
      into pidx, vidx, st, pr
      from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null or st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from public.fly_num(it->>'unitPrice') then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
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
      disc := floor(sub::float8 * (coalesce(public.fly_num(promo->>'value'), 0)::float8 / 100) + 0.5)::numeric;
    else
      disc := least(coalesce(public.fly_num(promo->>'value'), 0), sub);
    end if;
  end if;

  -- Envío
  dm := coalesce(p_sale->>'deliveryMethod', 'recojo');
  dep := coalesce(p_sale->'deliveryDetails'->>'department', '');
  if dm = 'recojo' then ship := 0;
  elsif dm = 'provincia' then
    ship := case
      when dep in ('La Libertad', 'Lambayeque', 'Piura', 'Tumbes', 'Cajamarca', 'Áncash', 'Amazonas', 'San Martín') then 12
      when dep in ('Lima', 'Callao', 'Ica', 'Junín', 'Pasco', 'Huánuco', 'Huancavelica', 'Ayacucho') then 15
      when dep in ('Arequipa', 'Moquegua', 'Tacna', 'Cusco', 'Puno', 'Apurímac') then 18
      when dep in ('Loreto', 'Ucayali', 'Madre de Dios') then 22
      else 15 end;
  elsif dm = 'internacional' then ship := greatest(coalesce(public.fly_num(p_sale->>'shipping'), 0), 0); -- se cotiza y confirma aparte
  else ship := case when sub >= 200 then 0 else 12 end; -- delivery local en Trujillo
  end if;

  -- Puntos del Club usados como descuento: se revisan y se descuentan YA (no se pueden usar dos veces)
  used := coalesce(public.fly_num(p_sale->>'pointsUsed'), 0)::int;
  if used > 0 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    bp := greatest(1, coalesce(nullif(public.fly_num(l->>'blockPoints'), 0), 100));
    bv := case when l ? 'blockValue' then coalesce(public.fly_num(l->>'blockValue'), 0) else 3 end;
    if bv <= 0 or used % bp::int <> 0 then raise exception 'PUNTOS_INVALIDOS'; end if;
    pdisc := (used / bp::int) * bv;
    if pdisc > sub - disc then raise exception 'PUNTOS_INVALIDOS'; end if;
    select coalesce((data->>'points')::int, 0) into cpts from public.customers where phone = ph for update;
    if cpts is null or cpts < used then raise exception 'PUNTOS_INSUFICIENTES'; end if;
    update public.customers set data = jsonb_set(data, '{points}', to_jsonb(cpts - used)) where phone = ph;
  end if;

  tot := round(greatest(sub + ship - disc - pdisc, 0), 2);
  client_tot := public.fly_num(p_sale->>'total');
  if client_tot is null or abs(client_tot - tot) > 0.05 then raise exception 'TOTAL_CAMBIO'; end if;

  update public.store_data set data = d, updated_at = now() where id = 'main';

  insert into public.doc_counters (serie, next_number) values ('B001', 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = 'B001' returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);
  sale := p_sale || jsonb_build_object(
    'id', sid, 'tipo', 'boleta', 'serie', 'B001', 'numero', n,
    'channel', 'online', 'source', 'web', 'status', 'emitido',
    'paymentStatus', 'pendiente_validacion', 'fulfillment', 'pendiente',
    'staffName', 'Tienda Online (autoservicio web)',
    'subtotal', sub, 'discount', disc, 'shipping', ship, 'pointsUsed', used, 'pointsDiscount', pdisc, 'total', tot,
    'stockReserved', true, 'pointsDeducted', used > 0,
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
        update public.customers set phone = ph, data = data || jsonb_build_object('phone', ph) where phone = gkey;
      elsif lower(coalesce(crow->>'email', '')) = em then
        update public.customers set data = jsonb_set(data, '{points}', to_jsonb(coalesce((data->>'points')::int, 0) + gpts)) where phone = ph;
        delete from public.customers where phone = gkey;
      end if;
    end if;
  end if;
  return sale;
end $$;


create or replace function public.pos_sale(p_sale jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int;
  sub numeric := 0; disc numeric; tot numeric; v_serie text; n int; sid text; sale jsonb; prev jsonb;
  movs jsonb := '[]'::jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  ph text; earned int := 0; l jsonb; sps numeric; pps numeric; paid numeric; v_seller text; v_cashier text;
begin
  if not public.has_role('superadmin', 'administrador', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'VENTA_VACIA'; end if;

  -- Reintento de la misma venta: se devuelve la ya guardada, no se duplica
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data ? 'clientRequestId' and data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  -- La vendedora elegida debe ser una persona activa del staff; si no, la venta queda a nombre de quien cobra
  v_cashier := public.my_staff_name();
  v_seller := p_sale->>'staffName';
  if v_seller is null or not exists (select 1 from public.staff_profiles where name = v_seller and coalesce(active, true)) then
    v_seller := v_cashier;
  end if;

  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    pidx := null; vidx := null; st := null; pr := null;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0), (p.val->>'price')::numeric
      into pidx, vidx, st, pr
      from jsonb_array_elements(d->'products') with ordinality p(val, ord),
           jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then raise exception 'PRODUCTO_NO_EXISTE:%', it->>'name'; end if;
    if st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from (it->>'unitPrice')::numeric then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
    movs := movs || jsonb_build_array(jsonb_build_object(
      'id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
      'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId',
      'size', it->'size', 'colorName', it->'colorName', 'type', 'venta', 'qty', qty,
      'staffName', v_seller, 'storeId', p_sale->'storeId', 'createdAt', now_ms));
  end loop;

  disc := least(greatest(coalesce((p_sale->>'discount')::numeric, 0), 0), sub);
  tot := round(sub - disc, 2);
  if p_sale ? 'payments' and jsonb_typeof(p_sale->'payments') = 'array' and jsonb_array_length(p_sale->'payments') > 0 then
    select coalesce(sum((x->>'amount')::numeric), 0) into paid from jsonb_array_elements(p_sale->'payments') x;
    if abs(paid - tot) > 0.01 then raise exception 'PAGO_INCOMPLETO'; end if;
  end if;

  update public.store_data set data = d, updated_at = now() where id = 'main';

  v_serie := case when p_sale->>'tipo' = 'factura' then 'F001' else 'B001' end;
  insert into public.doc_counters (serie, next_number) values (v_serie, 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = v_serie returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);
  sale := p_sale || jsonb_build_object('id', sid, 'serie', v_serie, 'numero', n, 'subtotal', sub, 'discount', disc, 'total', tot,
           'status', 'emitido', 'source', 'pos', 'staffUserId', auth.uid()::text, 'staffName', v_seller, 'cashierName', v_cashier,
           'createdAt', now_ms);
  insert into public.sales (id, data) values (sid, sale);

  perform public.log_stock_movements((select coalesce(jsonb_agg(m || jsonb_build_object('note', 'Venta ' || v_serie || '-' || lpad(n::text, 6, '0'))), '[]'::jsonb) from jsonb_array_elements(movs) m));

  -- Clienta y puntos (si dio su celular)
  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');
  if length(ph) >= 7 and not coalesce((p_sale->>'anonymous')::boolean, false) then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    earned := (floor(greatest(tot, 0) / sps) * pps)::int;
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


drop policy if exists "catalogo_crear" on public.store_data;
drop policy if exists "catalogo_editar" on public.store_data;
create policy "catalogo_crear" on public.store_data for insert with check (public.has_role('superadmin', 'administrador'));
create policy "catalogo_editar" on public.store_data for update using (public.has_role('superadmin', 'administrador')) with check (public.has_role('superadmin', 'administrador'));
-- (google_email, owns_customer y staff_set_username pueden quedarse: no afectan a la versión anterior)
