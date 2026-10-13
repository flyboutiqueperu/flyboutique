-- =====================================================================
--  FLY BOUTIQUE — 13: CAJA COMPARTIDA (quién cobró qué) Y CAMBIO DE TURNO
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Después, Merge del PR.
--  Pensado para una sola computadora con el usuario de la tienda (ej. "larco"): cada vendedora
--  se identifica con su código (MA01) al cobrar, abrir, mover dinero y cerrar.
--  No borra datos. Para volver atrás: 13-caja-turnos-VOLVER-ATRAS.sql
-- =====================================================================

-- ---------- Quién hizo cada cosa en la caja (código de vendedora) ----------
alter table public.cash_sessions add column if not exists opened_seller text;
alter table public.cash_sessions add column if not exists closed_seller text;
alter table public.cash_movements add column if not exists seller text;

-- "MA01 · María Alvarado" a partir del código. Si hay códigos creados, el código es obligatorio.
create or replace function public.seller_tag(p_code text) returns text
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select code, name into r from public.sellers where code = upper(trim(coalesce(p_code, ''))) and active;
  if r.code is not null then return r.code || ' · ' || r.name; end if;
  if exists (select 1 from public.sellers where active) then raise exception 'VENDEDOR_INVALIDO'; end if;
  return null; -- todavía no hay códigos: no se exige
end $$;
revoke execute on function public.seller_tag(text) from public, anon, authenticated;

-- ---------- Resumen del turno: ahora también "quién cobró qué" ----------
create or replace function public.cash_summary(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.cash_sessions; by_method jsonb; by_seller jsonb; cash_in numeric; ent numeric; sal numeric; n int;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  select * into s from public.cash_sessions where id = p_session;
  if s.id is null then return null; end if;
  with pays as (
    select x.id sid,
           coalesce(case when coalesce(x.data->>'sellerCode', '') <> '' then (x.data->>'sellerCode') || ' · ' || coalesce(x.data->>'staffName', '') end,
                    nullif(x.data->>'staffName', ''), '—') who,
           coalesce(p->>'method', 'Otro') m, coalesce((p->>'amount')::numeric, 0) a
      from public.sales x,
           jsonb_array_elements(coalesce(x.data->'payments', jsonb_build_array(jsonb_build_object('method', x.data->>'paymentMethod', 'amount', x.data->'total')))) p
     where x.data->>'cashSessionId' = p_session::text and coalesce(x.data->>'status', '') <> 'anulado'
  ),
  per_method as (select m, sum(a) t from pays group by m),
  per_who_method as (select who, m, sum(a) t from pays group by who, m),
  per_who as (select who, count(distinct sid) ventas, sum(a) total from pays group by who)
  select (select coalesce(jsonb_object_agg(m, t), '{}'::jsonb) from per_method),
         (select coalesce(sum(t), 0) from per_method where m = 'Efectivo'),
         (select coalesce(jsonb_object_agg(w.who, jsonb_build_object('ventas', w.ventas, 'total', w.total,
                   'porMetodo', (select jsonb_object_agg(pm.m, pm.t) from per_who_method pm where pm.who = w.who))), '{}'::jsonb) from per_who w)
    into by_method, cash_in, by_seller;
  select count(*) into n from public.sales x where x.data->>'cashSessionId' = p_session::text and coalesce(x.data->>'status', '') <> 'anulado';
  select coalesce(sum(amount) filter (where type = 'entrada'), 0), coalesce(sum(amount) filter (where type = 'salida'), 0) into ent, sal
    from public.cash_movements where session_id = p_session;
  return to_jsonb(s) || jsonb_build_object('byMethod', by_method, 'bySeller', by_seller, 'cashSales', cash_in, 'entradas', ent, 'salidas', sal, 'salesCount', n,
           'expectedCash', s.opening_amount + cash_in + ent - sal,
           'movements', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) from public.cash_movements m where m.session_id = p_session));
end $$;

-- ---------- Abrir caja: con quién la abre ----------
drop function if exists public.open_cash(text, numeric, text);
create or replace function public.open_cash(p_store text, p_amount numeric, p_register text default 'caja-1', p_seller text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; who text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  who := public.seller_tag(p_seller);
  if exists (select 1 from public.cash_sessions where store_id = p_store and register_id = p_register and status = 'abierta') then raise exception 'CAJA_YA_ABIERTA'; end if;
  insert into public.cash_sessions (store_id, register_id, opened_by, opened_by_name, opening_amount, opened_seller)
  values (p_store, p_register, auth.uid(), public.my_staff_name(), greatest(coalesce(p_amount, 0), 0), who) returning * into s;
  perform public.audit('caja_abierta', jsonb_build_object('session', s.id, 'store', p_store, 'fondo', s.opening_amount, 'vendedora', who));
  return to_jsonb(s);
end $$;

-- ---------- Entrada / salida de efectivo: con quién la hace ----------
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

-- ---------- Cerrar caja con arqueo: con quién la cierra ----------
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

-- ---------- Cambio de turno en un solo paso ----------
-- Cierra el turno con su arqueo y abre el siguiente en la misma caja con el dinero que queda.
-- Si se retira dinero (ej. a la dueña), el siguiente turno empieza con menos: queda en el informe.
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

revoke execute on function public.open_cash(text, numeric, text, text), public.cash_move(uuid, text, numeric, text, text),
  public.close_cash(uuid, numeric, text, text), public.shift_change(uuid, numeric, text, numeric, text, text) from public, anon;
grant execute on function public.open_cash(text, numeric, text, text), public.cash_move(uuid, text, numeric, text, text),
  public.close_cash(uuid, numeric, text, text), public.shift_change(uuid, numeric, text, numeric, text, text) to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select proname from pg_proc where proname in ('shift_change','seller_tag');
-- =====================================================================
