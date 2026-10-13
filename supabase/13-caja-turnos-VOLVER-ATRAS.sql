-- =====================================================================
--  FLY BOUTIQUE — VOLVER ATRÁS EL ARCHIVO 13 (caja compartida y cambio de turno)
--  Restaura las funciones de caja del archivo 11. No borra datos (las columnas nuevas se quedan).
--  Primero "Revert" del PR en GitHub; luego correr este archivo.
-- =====================================================================
drop function if exists public.shift_change(uuid, numeric, text, numeric, text, text);
drop function if exists public.open_cash(text, numeric, text, text);
drop function if exists public.cash_move(uuid, text, numeric, text, text);
drop function if exists public.close_cash(uuid, numeric, text, text);

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


grant execute on function public.open_cash(text, numeric, text), public.cash_move(uuid, text, numeric, text), public.close_cash(uuid, numeric, text) to authenticated;
revoke execute on function public.open_cash(text, numeric, text), public.cash_move(uuid, text, numeric, text), public.close_cash(uuid, numeric, text) from public, anon;
