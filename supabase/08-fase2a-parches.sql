-- =====================================================================
--  FLY BOUTIQUE — FASE 2a: PARCHES URGENTES DE SEGURIDAD Y STOCK
--  Pegar TODO en Supabase → SQL Editor → New query → Run.
--
--  ORDEN:
--    1. Panel → Más → "Descargar copia de seguridad" (por si acaso).
--    2. Correr ESTE archivo.
--    3. Enseguida, hacer Merge del Pull Request en GitHub (Vercel publica solo).
--    Entre el paso 2 y el 3 NO valides pagos de pedidos web (el panel viejo
--    descontaría el stock dos veces). Son solo unos minutos.
--
--  No borra datos. Para volver atrás: 08-fase2a-VOLVER-ATRAS.sql
-- =====================================================================

-- ---------- Ayudas ----------
-- Convierte texto a número sin fallar (si viene vacío o raro, devuelve null)
create or replace function public.fly_num(t text) returns numeric
language plpgsql immutable as $$
begin
  return nullif(trim(t), '')::numeric;
exception when others then
  return null;
end $$;

create or replace function public.my_staff_name() returns text
language sql stable security definer set search_path = public as $$
  select name from public.staff_profiles where user_id = auth.uid()
$$;

-- Registro de auditoría (quién hizo qué). Solo se escribe desde funciones del servidor.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key, at timestamptz default now(),
  user_id uuid, user_name text, action text not null, details jsonb
);
alter table public.audit_log enable row level security;
drop policy if exists "auditoria_ver" on public.audit_log;
create policy "auditoria_ver" on public.audit_log for select using (public.has_role('superadmin', 'administrador'));

create or replace function public.audit(p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (user_id, user_name, action, details) values (auth.uid(), public.my_staff_name(), p_action, p_details)
$$;
revoke execute on function public.audit(text, jsonb) from public, anon, authenticated;

-- Agrega movimientos al historial de stock (store_private)
create or replace function public.log_stock_movements(p_movs jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_movs is null or jsonb_array_length(p_movs) = 0 then return; end if;
  insert into public.store_private (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing;
  update public.store_private
     set data = jsonb_set(data, '{stockMovements}', p_movs || coalesce(data->'stockMovements', '[]'::jsonb)), updated_at = now()
   where id = 'main';
end $$;
revoke execute on function public.log_stock_movements(jsonb) from public, anon, authenticated;

-- ---------- 1. Super Admin y Administrador: el servidor exige el código de verificación (MFA) ----------
-- Antes solo lo pedía la pantalla. Ahora, sin el código, el servidor no les da permisos.
-- (Solo agrega una condición: no quita nada de lo que ya revisaba.)
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then (
    select role from public.staff_profiles
     where user_id = auth.uid()
       and (role not in ('superadmin', 'administrador') or coalesce(auth.jwt()->>'aal', '') = 'aal2')
  ) end
$$;

-- ---------- 2. Canje de puntos: solo el staff (antes cualquiera con un celular podía gastar puntos ajenos) ----------
create or replace function public.redeem_points(p_phone text, p_cost integer) returns integer
language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  if public.staff_role() is null then raise exception 'SIN_PERMISO'; end if;
  select coalesce((data->>'points')::int, 0) into pts from public.customers where phone = p_phone for update;
  if pts is null or p_cost <= 0 or pts < p_cost then raise exception 'PUNTOS_INSUFICIENTES'; end if;
  update public.customers set data = jsonb_set(data, '{points}', to_jsonb(pts - p_cost)) where phone = p_phone;
  perform public.audit('puntos_canjeados', jsonb_build_object('phone', p_phone, 'puntos', p_cost));
  return pts - p_cost;
end $$;

-- ---------- 3. Reservas de carrito: ya no se ve el código de carrito de otras personas ----------
-- La tienda solo necesita saber cuántas unidades tienen apartadas OTRAS clientas.
create or replace function public.reserved_stock(p_session text) returns table (variant_id text, qty bigint)
language sql stable security definer set search_path = public as $$
  select r.variant_id::text, sum(r.qty)::bigint from public.reservations r
   where r.expires_at > now() and r.session_id::text <> coalesce(p_session, '')
   group by 1
$$;
grant execute on function public.reserved_stock(text) to anon, authenticated;
drop policy if exists "reservas_leer" on public.reservations;

-- ---------- 4. Ventas sin duplicar en reintentos ----------
create unique index if not exists sales_client_request_uq on public.sales ((data->>'clientRequestId'))
  where data ? 'clientRequestId' and data->>'clientRequestId' <> '';

-- ---------- 5. Pedido web: el servidor calcula el total y RESERVA el stock al instante ----------
-- Reglas copiadas de la tienda (App.jsx): descuento por código, puntos por bloques y envío.
-- Si cambias las tarifas de envío en App.jsx (PROVINCE_ZONES o delivery local), cámbialas también aquí.
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

-- ---------- 6. Venta en caja: sin duplicados al reintentar y con la vendedora verificada ----------
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

-- ---------- 7. Validar pago web (solo administración, en el servidor) ----------
create or replace function public.validate_online_payment(p_sale_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; it jsonb; pidx int; vidx int; st int; earned int := 0; used int; l jsonb; sps numeric; pps numeric; ph text;
        movs jsonb := '[]'::jsonb; label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  select data into s from public.sales where id = p_sale_id for update;
  if s is null then raise exception 'PEDIDO_NO_EXISTE'; end if;
  if s->>'paymentStatus' = 'confirmado' then return s; end if;
  if s->>'status' = 'anulado' then raise exception 'PEDIDO_ANULADO'; end if;
  label := coalesce(s->>'serie', '') || '-' || lpad(coalesce(s->>'numero', '0'), 6, '0');
  select data into d from public.store_data where id = 'main' for update;

  -- Pedidos antiguos (antes de este parche): el stock aún no se había descontado
  if not coalesce((s->>'stockReserved')::boolean, false) then
    for it in select * from jsonb_array_elements(s->'items') loop
      pidx := null;
      select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0) into pidx, vidx, st
        from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
       where v.val->>'id' = it->>'variantId'
          or (coalesce(it->>'variantId', '') = '' and p.val->>'id' = it->>'productId' and v.val->>'size' = it->>'size' and v.val->>'colorName' = it->>'colorName')
       limit 1;
      if pidx is not null then
        d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(greatest(st - (it->>'qty')::int, 0)));
        movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId', 'size', it->'size', 'colorName', it->'colorName',
          'type', 'venta', 'qty', (it->>'qty')::int, 'note', 'Pago validado — pedido web ' || label, 'staffName', public.my_staff_name(), 'createdAt', now_ms));
      end if;
    end loop;
    update public.store_data set data = d, updated_at = now() where id = 'main';
    perform public.log_stock_movements(movs);
  end if;

  ph := regexp_replace(coalesce(s->>'customerPhone', ''), '\D', '', 'g');
  if length(ph) >= 7 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    earned := (floor(greatest(coalesce((s->>'subtotal')::numeric, 0) - coalesce((s->>'discount')::numeric, 0) - coalesce((s->>'pointsDiscount')::numeric, 0), 0) / sps) * pps)::int;
    -- Los puntos usados ya se descontaron al hacer el pedido (pedidos nuevos); en los antiguos se descuentan ahora
    used := case when coalesce((s->>'pointsDeducted')::boolean, false) then 0 else coalesce((s->>'pointsUsed')::int, 0) end;
    update public.customers set data = data || jsonb_build_object('points', greatest(coalesce((data->>'points')::int, 0) + earned - used, 0)) where phone = ph;
  end if;

  update public.sales set data = data || jsonb_build_object('paymentStatus', 'confirmado', 'stockReserved', true, 'earnedPoints', earned,
         'pointsDeducted', true, 'validatedBy', public.my_staff_name(), 'validatedAt', now_ms)
   where id = p_sale_id returning data into s;
  perform public.audit('pago_validado', jsonb_build_object('sale', p_sale_id, 'total', s->'total'));
  return s;
end $$;

-- ---------- 8. Anular venta o pedido (solo administración, en el servidor): devuelve stock y puntos ----------
create or replace function public.void_sale(p_sale_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; it jsonb; pidx int; vidx int; st int; ph text; returned boolean; used int;
        movs jsonb := '[]'::jsonb; label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
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
          'type', 'ajuste', 'qty', (it->>'qty')::int, 'note', 'Anulación de ' || label || ': ' || trim(p_reason), 'staffName', public.my_staff_name(), 'createdAt', now_ms));
      end if;
    end loop;
    update public.store_data set data = d, updated_at = now() where id = 'main';
    perform public.log_stock_movements(movs);
  end if;

  -- Puntos: se quitan los ganados y se devuelven los usados (solo si se habían descontado)
  ph := regexp_replace(coalesce(s->>'customerPhone', ''), '\D', '', 'g');
  used := case when coalesce((s->>'pointsDeducted')::boolean, false) or s->>'paymentStatus' = 'confirmado' then coalesce((s->>'pointsUsed')::int, 0) else 0 end;
  if length(ph) >= 7 and (coalesce((s->>'earnedPoints')::int, 0) > 0 or used > 0) then
    update public.customers set data = data || jsonb_build_object('points', greatest(coalesce((data->>'points')::int, 0) - coalesce((s->>'earnedPoints')::int, 0) + used, 0)) where phone = ph;
  end if;

  update public.sales set data = data || jsonb_build_object('status', 'anulado', 'voidReason', trim(p_reason), 'voidedBy', public.my_staff_name(),
         'voidedAt', now_ms, 'stockReturned', returned) where id = p_sale_id returning data into s;
  perform public.audit('venta_anulada', jsonb_build_object('sale', p_sale_id, 'motivo', p_reason, 'total', s->'total'));
  return s;
end $$;

-- ---------- 9. Guardar catálogo SIN pisar el stock ----------
-- Antes: al editar un producto se subía el stock que el panel tenía en pantalla y se perdían
-- las ventas hechas mientras tanto. Ahora el servidor conserva el stock real y solo aplica
-- los cambios de stock que la administradora hizo a propósito (p_stock_deltas: {variantId: +/-n}).
create or replace function public.save_catalog(p_data jsonb, p_stock_deltas jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb; stocks jsonb; prods jsonb;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_data->'products') <> 'array' then raise exception 'CATALOGO_INVALIDO'; end if;
  select data into cur from public.store_data where id = 'main' for update;

  select coalesce(jsonb_object_agg(v->>'id', coalesce(public.fly_num(v->>'stock'), 0)), '{}'::jsonb) into stocks
    from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
   where v->>'id' is not null;

  select coalesce(jsonb_agg(
           case when jsonb_typeof(p->'variants') = 'array' then p || jsonb_build_object('variants', (
             select coalesce(jsonb_agg(
                      case when v->>'id' is not null and stocks ? (v->>'id')
                           then v || jsonb_build_object('stock', greatest(0, (stocks->>(v->>'id'))::numeric + coalesce(public.fly_num(coalesce(p_stock_deltas, '{}'::jsonb)->>(v->>'id')), 0))::int)
                           else v end order by vo), '[]'::jsonb)
               from jsonb_array_elements(p->'variants') with ordinality x(v, vo)))
           else p end order by po), '[]'::jsonb)
    into prods
    from jsonb_array_elements(p_data->'products') with ordinality y(p, po);

  if cur is null then
    insert into public.store_data (id, data, updated_at) values ('main', p_data || jsonb_build_object('products', prods), now());
  else
    update public.store_data set data = cur || p_data || jsonb_build_object('products', prods), updated_at = now() where id = 'main';
  end if;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public.validate_online_payment(text), public.void_sale(text, text),
  public.save_catalog(jsonb, jsonb), public.my_staff_name() from public, anon;
grant execute on function public.validate_online_payment(text), public.void_sale(text, text),
  public.save_catalog(jsonb, jsonb), public.my_staff_name() to authenticated;

-- =====================================================================
--  LISTO. Ahora haz Merge del Pull Request.
--  Comprobación rápida (solo lectura):
--    select proname from pg_proc where proname in ('save_catalog','void_sale','validate_online_payment','reserved_stock','fly_num');
--  Deben salir las 5.
-- =====================================================================
