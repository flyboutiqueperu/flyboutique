-- =====================================================================
--  FLY BOUTIQUE — VOLVER ATRÁS EL ARCHIVO 14
--  1. "Revert" del PR en GitHub.  2. Correr este archivo.
--  Restaura las funciones como estaban (11, 12, 13 y 08) y apaga el "vigilante" del historial.
--  No borra datos: la tabla stock_movements con el historial se conserva.
-- =====================================================================
drop trigger if exists trg_stock_changes on public.store_data;
drop function if exists public.save_catalog(jsonb, jsonb, text[], text[], text[], text);
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


create or replace function public.pos_sale(p_sale jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int;
  sub numeric := 0; disc numeric; tot numeric; v_serie text; n int; sid text; sale jsonb; prev jsonb;
  movs jsonb := '[]'::jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  ph text; earned int := 0; l jsonb; sps numeric; pps numeric; paid numeric; v_seller text; v_cashier text;
  promo jsonb; promo_disc numeric := 0; used int; bp numeric; bv numeric; pdisc numeric := 0; cpts int; manual numeric; cap numeric;
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

  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');

  -- Código promocional: lo calcula el servidor
  if coalesce(trim(p_sale->>'promoCode'), '') <> '' then
    select x into promo from jsonb_array_elements(coalesce(d->'promoCodes', '[]'::jsonb)) x
     where coalesce((x->>'active')::boolean, false) and lower(x->>'code') = lower(trim(p_sale->>'promoCode')) limit 1;
    if promo is null then raise exception 'PROMO_INVALIDA'; end if;
    if promo->>'type' = 'percent' then
      promo_disc := floor(sub::float8 * (coalesce(public.fly_num(promo->>'value'), 0)::float8 / 100) + 0.5)::numeric;
    else
      promo_disc := least(coalesce(public.fly_num(promo->>'value'), 0), sub);
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
    if pdisc > sub - promo_disc then raise exception 'PUNTOS_INVALIDOS'; end if;
    select coalesce((data->>'points')::int, 0) into cpts from public.customers where phone = ph for update;
    if cpts is null or cpts < used then raise exception 'PUNTOS_INSUFICIENTES'; end if;
    update public.customers set data = jsonb_set(data, '{points}', to_jsonb(cpts - used)) where phone = ph;
  end if;

  disc := least(greatest(coalesce((p_sale->>'discount')::numeric, 0), 0), sub);
  if disc + 0.01 < promo_disc + pdisc then raise exception 'DESCUENTO_INVALIDO'; end if;
  -- Descuento manual: las vendedoras tienen un tope (Panel → ajustes; 20% si no se configuró). Administración no tiene tope.
  manual := disc - promo_disc - pdisc;
  if manual > 0 and not public.has_role('superadmin', 'administrador') then
    cap := coalesce(public.fly_num(d->'settings'->>'posMaxDiscountPct'), 20);
    if manual > round(sub * cap / 100, 2) + 0.01 then raise exception 'DESCUENTO_EXCEDE:%', cap; end if;
  end if;
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
           'pointsUsed', used, 'pointsDiscount', pdisc, 'pointsDeducted', used > 0, 'manualDiscount', greatest(manual, 0),
           'cashSessionId', cash_id, 'sellerCode', v_seller_code, 'storeId', case when is_store then v_store else p_sale->'storeId' #>> '{}' end,
           'createdAt', now_ms);
  insert into public.sales (id, data) values (sid, sale);

  perform public.log_stock_movements((select coalesce(jsonb_agg(m || jsonb_build_object('note', 'Venta ' || v_serie || '-' || lpad(n::text, 6, '0'))), '[]'::jsonb) from jsonb_array_elements(movs) m));

  -- Clienta y puntos (si dio su celular)
  if length(ph) >= 7 and not coalesce((p_sale->>'anonymous')::boolean, false) then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    earned := case when public.club_enabled(d) then (floor(greatest(tot, 0) / sps) * pps)::int else 0 end;
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


-- ---------- 5. Cambiar el nombre de usuario del staff sin borrar la cuenta (solo Super Admin) ----------
-- El usuario es la primera parte del correo interno con el que entra (usuario@staff.flyboutique.pe).
-- Se cambia en los dos sitios a la vez; la contraseña y la verificación en dos pasos no cambian.
create or replace function public.staff_set_username(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare u text := lower(trim(coalesce(p_username, ''))); em text;
begin
  if not public.has_role('superadmin') then raise exception 'SIN_PERMISO'; end if;
  if u !~ '^[a-z0-9._-]{3,30}$' then raise exception 'USUARIO_INVALIDO'; end if;
  if not exists (select 1 from public.staff_profiles where user_id = p_user) then raise exception 'USUARIO_NO_EXISTE'; end if;
  em := u || '@staff.flyboutique.pe';
  if exists (select 1 from auth.users where lower(email) = em and id <> p_user)
     or exists (select 1 from public.staff_profiles where lower(username) = u and user_id <> p_user) then
    raise exception 'USUARIO_EXISTE';
  end if;
  update auth.users set email = em, updated_at = now() where id = p_user;
  update auth.identities set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', em), updated_at = now()
   where user_id = p_user and provider = 'email';
  update public.staff_profiles set username = u where user_id = p_user;
  perform public.audit('usuario_renombrado', jsonb_build_object('user', p_user, 'username', u));
end $$;
revoke execute on function public.staff_set_username(uuid, text) from public, anon;
grant execute on function public.staff_set_username(uuid, text) to authenticated;


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
    -- Tarifa del departamento configurada en Panel → Envíos; si no hay, la tarifa por defecto
    ship := coalesce(public.fly_num(d->'settings'->'provinceRates'->>dep), case
      when dep in ('La Libertad', 'Lambayeque', 'Piura', 'Tumbes', 'Cajamarca', 'Áncash', 'Amazonas', 'San Martín') then 12
      when dep in ('Lima', 'Callao', 'Ica', 'Junín', 'Pasco', 'Huánuco', 'Huancavelica', 'Ayacucho') then 15
      when dep in ('Arequipa', 'Moquegua', 'Tacna', 'Cusco', 'Puno', 'Apurímac') then 18
      when dep in ('Loreto', 'Ucayali', 'Madre de Dios') then 22
      else 15 end);
  elsif dm = 'internacional' then ship := greatest(coalesce(public.fly_num(p_sale->>'shipping'), 0), 0); -- se cotiza y confirma aparte
  else -- delivery local en Trujillo (precio y monto para envío gratis configurables)
    ship := case when sub >= coalesce(public.fly_num(d->'settings'->'localShipping'->>'freeFrom'), 200) then 0
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
    if pdisc > sub - disc then raise exception 'PUNTOS_INVALIDOS'; end if;
    -- Usar puntos online solo con la cuenta de Google de la dueña de esos puntos
    if not public.owns_customer(ph) then raise exception 'PUNTOS_SOLO_GOOGLE'; end if;
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
    earned := case when not public.club_enabled(d) then 0 else (floor(greatest(coalesce((s->>'subtotal')::numeric, 0) - coalesce((s->>'discount')::numeric, 0) - coalesce((s->>'pointsDiscount')::numeric, 0), 0) / sps) * pps)::int end;
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


drop function if exists public.cash_move(uuid, text, numeric, text);
create or replace function public.cash_move(p_session uuid, p_type text, p_amount numeric, p_reason text, p_seller text default null) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if not exists (select 1 from public.cash_sessions where id = p_session and status = 'abierta') then raise exception 'CAJA_CERRADA'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  who := public.seller_tag(p_seller);
  insert into public.cash_movements (session_id, type, amount, reason, created_by, created_by_name, seller)
  values (p_session, p_type, p_amount, trim(p_reason), auth.uid(), public.my_staff_name(), who);
  perform public.audit('caja_' || p_type, jsonb_build_object('session', p_session, 'monto', p_amount, 'motivo', p_reason, 'vendedora', who));
end $$;


drop function if exists public.close_cash(uuid, numeric, text);
create or replace function public.close_cash(p_session uuid, p_counted numeric, p_notes text, p_seller text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sm jsonb; diff numeric; who text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if not exists (select 1 from public.cash_sessions where id = p_session and status = 'abierta') then raise exception 'CAJA_CERRADA'; end if;
  who := public.seller_tag(p_seller);
  sm := public.cash_summary(p_session);
  diff := round(coalesce(p_counted, 0) - (sm->>'expectedCash')::numeric, 2);
  if diff <> 0 and coalesce(trim(p_notes), '') = '' then raise exception 'MOTIVO_DIFERENCIA'; end if;
  update public.cash_sessions set status = 'cerrada', closed_by = auth.uid(), closed_by_name = public.my_staff_name(), closed_at = now(), closed_seller = who,
         expected_cash = (sm->>'expectedCash')::numeric, counted_cash = p_counted, difference = diff, notes = p_notes,
         totals = jsonb_build_object('byMethod', sm->'byMethod', 'bySeller', sm->'bySeller', 'salesCount', sm->'salesCount', 'entradas', sm->'entradas', 'salidas', sm->'salidas', 'cashSales', sm->'cashSales')
   where id = p_session;
  perform public.audit('caja_cerrada', jsonb_build_object('session', p_session, 'esperado', sm->'expectedCash', 'contado', p_counted, 'diferencia', diff, 'vendedora', who));
  return public.cash_summary(p_session);
end $$;


create or replace function public.shift_change(p_session uuid, p_counted numeric, p_notes text, p_next_amount numeric,
                                               p_seller_out text default null, p_seller_in text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; closed jsonb; opened jsonb; nxt numeric;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  select * into s from public.cash_sessions where id = p_session;
  if s.id is null or s.status <> 'abierta' then raise exception 'CAJA_CERRADA'; end if;
  nxt := greatest(coalesce(p_next_amount, p_counted, 0), 0);
  if nxt > coalesce(p_counted, 0) + 0.001 then raise exception 'FONDO_MAYOR_QUE_CONTADO'; end if;
  closed := public.close_cash(p_session, p_counted,
              trim(both ' ' from coalesce(p_notes, '') || case when nxt < coalesce(p_counted, 0) then ' [Cambio de turno: se retiraron S/ ' || (coalesce(p_counted, 0) - nxt) || ']' else '' end),
              p_seller_out);
  opened := public.open_cash(s.store_id, nxt, s.register_id, p_seller_in);
  return jsonb_build_object('closed', closed, 'opened', opened);
end $$;


grant execute on function public.save_catalog(jsonb, jsonb) to authenticated;
revoke execute on function public.save_catalog(jsonb, jsonb) from public, anon;
grant execute on function public.cash_move(uuid, text, numeric, text, text), public.close_cash(uuid, numeric, text, text) to authenticated;
