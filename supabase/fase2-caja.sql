-- =====================================================================
--  FLY BOUTIQUE — FASE 2: CAJA, CÓDIGOS DE VENDEDOR, AUDITORÍA
--  y STOCK SIN SOBREVENTA (web + tienda)
--  Pegar TODO en Supabase → SQL Editor → New query → Run.
--  BORRADOR — NO CORRER TODAVÍA: falta adaptar App.jsx (caja, código de vendedor, rol cajero).
--  Requiere haber corrido antes: 08-fase2a-parches.sql (que ya trae: auditoría, pedido web con
--  reserva de stock y total calculado en el servidor, validar pago y anular venta en el servidor).
--  No borra datos. Antes de correrlo: Panel → Más → "Descargar copia de seguridad".
-- =====================================================================

-- ---------- Rol "cajero" ----------
alter table public.staff_profiles drop constraint if exists staff_profiles_role_check;
alter table public.staff_profiles add constraint staff_profiles_role_check
  check (role in ('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online', 'almacen'));

-- ---------- Tablas nuevas ----------
create table if not exists public.sellers (
  code text primary key check (code ~ '^[A-Z]{2,3}[0-9]{2}$'),
  name text not null, store_id text not null default 'principal',
  active boolean not null default true, created_at timestamptz default now()
);
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id text not null, register_id text not null default 'caja-1',
  status text not null default 'abierta' check (status in ('abierta', 'cerrada')),
  opened_by uuid, opened_by_name text, opened_at timestamptz default now(), opening_amount numeric not null default 0,
  closed_by uuid, closed_by_name text, closed_at timestamptz,
  expected_cash numeric, counted_cash numeric, difference numeric, notes text, totals jsonb
);
create unique index if not exists cash_one_open_per_register on public.cash_sessions (store_id, register_id) where status = 'abierta';
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.cash_sessions(id),
  type text not null check (type in ('entrada', 'salida')), amount numeric not null check (amount > 0),
  reason text not null, created_by uuid, created_by_name text, created_at timestamptz default now()
);

alter table public.sellers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists "vendedores_ver" on public.sellers;
drop policy if exists "caja_ver" on public.cash_sessions;
drop policy if exists "caja_mov_ver" on public.cash_movements;
create policy "vendedores_ver" on public.sellers for select using (public.staff_role() is not null);
create policy "caja_ver" on public.cash_sessions for select using (public.has_role('superadmin', 'administrador', 'cajero'));
create policy "caja_mov_ver" on public.cash_movements for select using (public.has_role('superadmin', 'administrador', 'cajero'));
-- (las escrituras de estas tablas van SOLO por las funciones de abajo)

-- ---------- Vendedores (códigos) ----------
create or replace function public.upsert_seller(p_code text, p_name text, p_store text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  insert into public.sellers (code, name, store_id, active) values (upper(trim(p_code)), trim(p_name), coalesce(p_store, 'principal'), coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, store_id = excluded.store_id, active = excluded.active;
  perform public.audit('vendedor_guardado', jsonb_build_object('code', upper(trim(p_code)), 'name', p_name, 'active', p_active));
end $$;

-- ---------- Turno de caja ----------
create or replace function public.open_cash(p_store text, p_amount numeric, p_register text default 'caja-1') returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if exists (select 1 from public.cash_sessions where store_id = p_store and register_id = p_register and status = 'abierta') then raise exception 'CAJA_YA_ABIERTA'; end if;
  insert into public.cash_sessions (store_id, register_id, opened_by, opened_by_name, opening_amount)
  values (p_store, p_register, auth.uid(), public.my_staff_name(), greatest(coalesce(p_amount, 0), 0)) returning * into s;
  perform public.audit('caja_abierta', jsonb_build_object('session', s.id, 'store', p_store, 'fondo', s.opening_amount));
  return to_jsonb(s);
end $$;

create or replace function public.cash_summary(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.cash_sessions; by_method jsonb; cash_in numeric; ent numeric; sal numeric; n int;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  select * into s from public.cash_sessions where id = p_session;
  if s.id is null then return null; end if;
  select coalesce(jsonb_object_agg(m, t), '{}'::jsonb), coalesce(sum(t) filter (where m = 'Efectivo'), 0)
    into by_method, cash_in
    from (select p->>'method' m, sum((p->>'amount')::numeric) t
            from public.sales x, jsonb_array_elements(coalesce(x.data->'payments', jsonb_build_array(jsonb_build_object('method', x.data->>'paymentMethod', 'amount', x.data->'total')))) p
           where x.data->>'cashSessionId' = p_session::text and coalesce(x.data->>'status', '') <> 'anulado'
           group by 1) q;
  select count(*) into n from public.sales x where x.data->>'cashSessionId' = p_session::text and coalesce(x.data->>'status', '') <> 'anulado';
  select coalesce(sum(amount) filter (where type = 'entrada'), 0), coalesce(sum(amount) filter (where type = 'salida'), 0) into ent, sal
    from public.cash_movements where session_id = p_session;
  return to_jsonb(s) || jsonb_build_object('byMethod', by_method, 'cashSales', cash_in, 'entradas', ent, 'salidas', sal, 'salesCount', n,
           'expectedCash', s.opening_amount + cash_in + ent - sal,
           'movements', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) from public.cash_movements m where m.session_id = p_session));
end $$;

create or replace function public.current_cash(p_store text, p_register text default 'caja-1') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid;
begin
  if public.staff_role() is null then raise exception 'SIN_PERMISO'; end if;
  select id into sid from public.cash_sessions where store_id = p_store and register_id = p_register and status = 'abierta';
  if sid is null then return null; end if;
  if public.has_role('superadmin', 'administrador', 'cajero') then return public.cash_summary(sid); end if;
  return (select jsonb_build_object('id', id, 'store_id', store_id, 'status', status, 'opened_by_name', opened_by_name, 'opened_at', opened_at) from public.cash_sessions where id = sid);
end $$;

create or replace function public.cash_move(p_session uuid, p_type text, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if not exists (select 1 from public.cash_sessions where id = p_session and status = 'abierta') then raise exception 'CAJA_CERRADA'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  insert into public.cash_movements (session_id, type, amount, reason, created_by, created_by_name) values (p_session, p_type, p_amount, trim(p_reason), auth.uid(), public.my_staff_name());
  perform public.audit('caja_' || p_type, jsonb_build_object('session', p_session, 'monto', p_amount, 'motivo', p_reason));
end $$;

create or replace function public.close_cash(p_session uuid, p_counted numeric, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sm jsonb; diff numeric;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if not exists (select 1 from public.cash_sessions where id = p_session and status = 'abierta') then raise exception 'CAJA_CERRADA'; end if;
  sm := public.cash_summary(p_session);
  diff := round(coalesce(p_counted, 0) - (sm->>'expectedCash')::numeric, 2);
  if diff <> 0 and coalesce(trim(p_notes), '') = '' then raise exception 'MOTIVO_DIFERENCIA'; end if;
  update public.cash_sessions set status = 'cerrada', closed_by = auth.uid(), closed_by_name = public.my_staff_name(), closed_at = now(),
         expected_cash = (sm->>'expectedCash')::numeric, counted_cash = p_counted, difference = diff, notes = p_notes,
         totals = jsonb_build_object('byMethod', sm->'byMethod', 'salesCount', sm->'salesCount', 'entradas', sm->'entradas', 'salidas', sm->'salidas', 'cashSales', sm->'cashSales')
   where id = p_session;
  perform public.audit('caja_cerrada', jsonb_build_object('session', p_session, 'esperado', sm->'expectedCash', 'contado', p_counted, 'diferencia', diff));
  return public.cash_summary(p_session);
end $$;

-- ---------- Venta de caja: con turno abierto, código de vendedor y sin duplicados ----------
create or replace function public.pos_sale(p_sale jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int;
  sub numeric := 0; disc numeric; tot numeric; v_serie text; n int; sid text; sale jsonb; prev jsonb;
  movs jsonb := '[]'::jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  ph text; earned int := 0; l jsonb; sps numeric; pps numeric; paid numeric;
  cash_id uuid; seller record; is_store boolean := coalesce(p_sale->>'channel', 'tienda') <> 'online';
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'VENTA_VACIA'; end if;

  -- Reintento de la misma venta (por ejemplo, se cortó internet): se devuelve la ya guardada, no se duplica
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  if is_store then
    select id into cash_id from public.cash_sessions where store_id = coalesce(p_sale->>'storeId', 'principal') and status = 'abierta' order by opened_at desc limit 1;
    if cash_id is null then raise exception 'CAJA_CERRADA'; end if;
    select * into seller from public.sellers where code = upper(coalesce(p_sale->>'sellerCode', '')) and active;
    if seller.code is null then raise exception 'VENDEDOR_INVALIDO'; end if;
  end if;

  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    pidx := null; vidx := null; st := null; pr := null;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0), (p.val->>'price')::numeric into pidx, vidx, st, pr
      from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then raise exception 'PRODUCTO_NO_EXISTE:%', it->>'name'; end if;
    if st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from (it->>'unitPrice')::numeric then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
    movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
      'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId', 'size', it->'size', 'colorName', it->'colorName',
      'type', 'venta', 'qty', qty, 'staffName', public.my_staff_name(), 'storeId', p_sale->'storeId', 'createdAt', now_ms));
  end loop;

  disc := least(greatest(coalesce((p_sale->>'discount')::numeric, 0), 0), sub);
  tot := round(sub - disc, 2);
  if jsonb_typeof(p_sale->'payments') = 'array' and jsonb_array_length(p_sale->'payments') > 0 then
    select coalesce(sum((x->>'amount')::numeric), 0) into paid from jsonb_array_elements(p_sale->'payments') x;
    if abs(paid - tot) > 0.01 then raise exception 'PAGO_INCOMPLETO'; end if;
  end if;
  update public.store_data set data = d, updated_at = now() where id = 'main';

  v_serie := case when p_sale->>'tipo' = 'factura' then 'F001' else 'B001' end;
  insert into public.doc_counters (serie, next_number) values (v_serie, 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = v_serie returning next_number - 1 into n;

  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');
  if length(ph) >= 7 and not coalesce((p_sale->>'anonymous')::boolean, false) then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    earned := (floor(greatest(tot, 0) / sps) * pps)::int;
  end if;

  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);
  sale := p_sale || jsonb_build_object('id', sid, 'serie', v_serie, 'numero', n, 'subtotal', sub, 'discount', disc, 'total', tot,
           'status', 'emitido', 'source', 'pos', 'staffUserId', auth.uid()::text, 'cashierName', public.my_staff_name(),
           'cashSessionId', cash_id, 'earnedPoints', earned, 'stockReserved', true, 'createdAt', now_ms)
        || case when is_store then jsonb_build_object('sellerCode', seller.code, 'staffName', seller.name) else '{}'::jsonb end;
  insert into public.sales (id, data) values (sid, sale);

  insert into public.store_private (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing;
  update public.store_private
     set data = jsonb_set(data, '{stockMovements}', (select coalesce(jsonb_agg(m || jsonb_build_object('note', 'Venta ' || v_serie || '-' || lpad(n::text, 6, '0'))), '[]'::jsonb) from jsonb_array_elements(movs) m) || coalesce(data->'stockMovements', '[]'::jsonb)),
         updated_at = now() where id = 'main';

  if earned > 0 then
    if exists (select 1 from public.customers where phone = ph) then
      update public.customers set data = data || jsonb_build_object('points', coalesce((data->>'points')::int, 0) + earned)
          || case when coalesce(data->>'doc', '') = '' then jsonb_build_object('doc', coalesce(p_sale->>'customerDoc', '')) else '{}'::jsonb end
          || case when coalesce(data->>'email', '') = '' then jsonb_build_object('email', coalesce(p_sale->>'customerEmail', '')) else '{}'::jsonb end
       where phone = ph;
    else
      insert into public.customers (phone, data) values (ph, jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12),
        'name', coalesce(p_sale->>'customerName', ''), 'phone', ph, 'doc', coalesce(p_sale->>'customerDoc', ''),
        'email', coalesce(p_sale->>'customerEmail', ''), 'points', earned, 'via', 'tienda', 'createdAt', now_ms));
    end if;
  end if;
  return sale;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public.upsert_seller(text, text, text, boolean), public.open_cash(text, numeric, text), public.cash_summary(uuid),
  public.current_cash(text, text), public.cash_move(uuid, text, numeric, text), public.close_cash(uuid, numeric, text),
  public.pos_sale(jsonb) from public, anon;
grant execute on function public.upsert_seller(text, text, text, boolean), public.open_cash(text, numeric, text), public.cash_summary(uuid),
  public.current_cash(text, text), public.cash_move(uuid, text, numeric, text), public.close_cash(uuid, numeric, text),
  public.pos_sale(jsonb) to authenticated;

-- El cajero ve ventas como una vendedora (las suyas y los pedidos web) y puede buscar clientas
drop policy if exists "ventas_ver" on public.sales;
create policy "ventas_ver" on public.sales for select using (
  public.has_role('superadmin', 'administrador')
  or (public.has_role('cajero', 'vendedora_tienda', 'vendedora_online', 'almacen') and (data->>'channel' = 'online' and data->>'source' = 'web' or data->>'staffUserId' = auth.uid()::text))
);
drop policy if exists "clientas_ver" on public.customers;
create policy "clientas_ver" on public.customers for select using (public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online'));

-- =====================================================================
--  LISTO. Ahora sube el App.jsx nuevo.
--  Para volver atrás: corre la función pos_sale de 08-fase2a-parches.sql y sube el App.jsx anterior
--  (las tablas nuevas pueden quedarse: no afectan a la versión anterior).
-- =====================================================================
