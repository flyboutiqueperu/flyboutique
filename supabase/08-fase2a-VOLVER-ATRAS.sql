-- =====================================================================
--  FLY BOUTIQUE — VOLVER ATRÁS LA FASE 2a
--  Usar SOLO si la Fase 2a dio problemas.
--
--  ORDEN:
--    1. En GitHub/Vercel, volver a publicar la versión anterior de la app
--       (Vercel → Deployments → la anterior → "Promote to Production", o "Revert" del PR).
--    2. Correr ESTE archivo en Supabase → SQL Editor.
--    3. Ojo: los pedidos web hechos con la Fase 2a ya descontaron su stock. Con la app
--       anterior, "validar pago" lo descontaría otra vez: revisa el stock de esos pedidos
--       o anúlalos/valídalos antes del paso 1.
--
--  Restaura las funciones tal como estaban el 13-oct-2026 (copiadas de Supabase).
--  No borra datos. Las tablas/funciones nuevas (audit_log, save_catalog, etc.) pueden quedarse.
-- =====================================================================

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = 'public' as $function$
  select case when public.is_staff()
    then (select role from public.staff_profiles where user_id = auth.uid()) end
$function$;

create or replace function public.redeem_points(p_phone text, p_cost integer) returns integer
language plpgsql security definer set search_path = 'public' as $function$
declare pts int;
begin
  select coalesce((data->>'points')::int, 0) into pts from public.customers where phone = p_phone for update;
  if pts is null or p_cost <= 0 or pts < p_cost then raise exception 'PUNTOS_INSUFICIENTES'; end if;
  update public.customers set data = jsonb_set(data, '{points}', to_jsonb(pts - p_cost)) where phone = p_phone;
  return pts - p_cost;
end $function$;

drop policy if exists "reservas_leer" on public.reservations;
create policy "reservas_leer" on public.reservations for select using (true);

create or replace function public.place_order(p_sale jsonb, p_session text) returns jsonb
language plpgsql security definer set search_path = 'public' as $function$
declare it jsonb; st int; pr numeric; n int; sale jsonb; sid text; em text; gkey text; ph text; gpts int;
begin
  if pg_column_size(p_sale) > 60000 then raise exception 'PEDIDO_INVALIDO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'PEDIDO_VACIO'; end if;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    select (v->>'stock')::int, (p->>'price')::numeric into st, pr
    from public.store_data s, jsonb_array_elements(s.data->'products') p, jsonb_array_elements(p->'variants') v
    where s.id = 'main' and v->>'id' = it->>'variantId' limit 1;
    if st is null or st < coalesce((it->>'qty')::int, 0) then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from (it->>'unitPrice')::numeric then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
  end loop;
  update public.doc_counters set next_number = next_number + 1 where serie = 'B001' returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);
  sale := p_sale || jsonb_build_object(
    'id', sid, 'tipo', 'boleta', 'serie', 'B001', 'numero', n,
    'channel', 'online', 'source', 'web', 'status', 'emitido',
    'paymentStatus', 'pendiente_validacion', 'fulfillment', 'pendiente',
    'staffName', 'Tienda Online (autoservicio web)',
    'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.sales (id, data) values (sid, sale);
  delete from public.reservations where session_id = p_session;

  -- Vincular la cuenta de Google con el celular del pedido
  em := lower(coalesce(auth.jwt()->>'email', ''));
  ph := coalesce(p_sale->>'customerPhone', '');
  if auth.uid() is not null and em <> '' and coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google' and length(ph) >= 7 then
    gkey := 'g:' || em;
    select coalesce((data->>'points')::int, 0) into gpts from public.customers where phone = gkey;
    if found then
      if exists (select 1 from public.customers where phone = ph) then
        update public.customers
        set data = jsonb_set(data, '{points}', to_jsonb(coalesce((data->>'points')::int, 0) + gpts)) || jsonb_build_object('email', em)
        where phone = ph;
        delete from public.customers where phone = gkey;
      else
        update public.customers set phone = ph, data = data || jsonb_build_object('phone', ph) where phone = gkey;
      end if;
    end if;
  end if;
  return sale;
end $function$;

create or replace function public.pos_sale(p_sale jsonb) returns jsonb
language plpgsql security definer set search_path = 'public' as $function$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int;
  sub numeric := 0; disc numeric; tot numeric; v_serie text; n int; sid text; sale jsonb;
  movs jsonb := '[]'::jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  ph text; earned int := 0; l jsonb; sps numeric; pps numeric; paid numeric;
begin
  if not public.has_role('superadmin', 'administrador', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'VENTA_VACIA'; end if;

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
      'staffName', p_sale->'staffName', 'storeId', p_sale->'storeId', 'createdAt', now_ms));
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
           'status', 'emitido', 'source', 'pos', 'staffUserId', auth.uid()::text, 'createdAt', now_ms);
  insert into public.sales (id, data) values (sid, sale);

  insert into public.store_private (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing;
  update public.store_private
     set data = jsonb_set(data, '{stockMovements}', (select coalesce(jsonb_agg(m || jsonb_build_object('note', 'Venta ' || v_serie || '-' || lpad(n::text, 6, '0'))), '[]'::jsonb) from jsonb_array_elements(movs) m) || coalesce(data->'stockMovements', '[]'::jsonb)),
         updated_at = now()
   where id = 'main';

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
  return sale || jsonb_build_object('earnedPoints', earned);
end $function$;

-- =====================================================================
--  LISTO. La base quedó como antes de la Fase 2a.
-- =====================================================================
