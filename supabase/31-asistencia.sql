-- =====================================================================
--  31 · Asistencia (marcar entrada y salida) y datos para la quincena
--  - Cada persona marca en la PC de la tienda con su PIN (4 a 6 números) o, más adelante, con su llavero (tag):
--    el lector USB escribe el número del llavero y Enter, igual que un teclado. La hora la pone el SERVIDOR.
--  - Solo se puede marcar desde un equipo con sesión del staff abierta (no desde internet sin sesión).
--  - Los PIN se guardan cifrados (sha256 con sal), nunca se devuelven.
--  - Super Admin / Administración: personas, PIN, llavero, jornada, sueldo, correcciones y ajustes de la quincena.
--  - No borra datos: las marcas se anulan con motivo (queda quién y cuándo).
--  Volver atrás: 31-asistencia-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.att_people (
  id bigint generated always as identity primary key,
  name text not null,
  active boolean not null default true,
  daily_hours numeric not null default 8 check (daily_hours > 0 and daily_hours <= 16),
  break_minutes int not null default 0 check (break_minutes between 0 and 240),
  base_quincena numeric not null default 0 check (base_quincena >= 0),
  hour_rate numeric check (hour_rate is null or hour_rate >= 0),
  pin_salt text, pin_hash text,
  tag text unique,
  store_id text not null default 'principal',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.att_marks (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.att_people (id),
  kind text not null check (kind in ('entrada', 'salida')),
  at timestamptz not null default now(),
  source text not null default 'pin' check (source in ('pin', 'tag', 'manual')),
  created_by text, note text,
  voided boolean not null default false, voided_by text, void_reason text, voided_at timestamptz
);
create index if not exists att_marks_person_at on public.att_marks (person_id, at);

create table if not exists public.att_adjustments (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.att_people (id),
  period_start date not null,
  kind text not null check (kind in ('ausencia', 'feriado', 'bono', 'adelanto', 'descuento')),
  amount numeric not null check (amount >= 0),
  note text, created_by text, created_at timestamptz not null default now(),
  voided boolean not null default false
);

alter table public.att_people enable row level security;
alter table public.att_marks enable row level security;
alter table public.att_adjustments enable row level security;
revoke all on public.att_people, public.att_marks, public.att_adjustments from public, anon, authenticated;

create or replace function public.att_pin_hash(p_salt text, p_pin text) returns text
language sql immutable set search_path = public as $$ select encode(sha256(convert_to(p_salt || ':' || p_pin, 'UTF8')), 'hex') $$;
revoke execute on function public.att_pin_hash(text, text) from public, anon, authenticated;

-- Marcar: con PIN o llavero. Entrada o salida se decide sola (si lo último de hoy fue entrada → salida).
-- Un segundo toque dentro de 2 minutos no crea otra marca (devuelve la misma).
create or replace function public.att_clock(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g'); p public.att_people; last public.att_marks; k text; m public.att_marks; src text;
        day_start timestamptz := (date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima');
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online', 'almacen') then raise exception 'SIN_PERMISO'; end if;
  -- Muchos intentos fallidos seguidos desde la misma cuenta: se frena 10 minutos (evita adivinar PIN)
  if (select count(*) from public.audit_log where action = 'asistencia_codigo_invalido' and user_id = auth.uid() and at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'DEMASIADOS_INTENTOS');
  end if;
  if code !~ '^[0-9A-Za-z]{4,20}$' then return jsonb_build_object('ok', false, 'error', 'CODIGO_INVALIDO'); end if;
  select * into p from public.att_people where active and tag = upper(code) limit 1;
  src := 'tag';
  if p.id is null and code ~ '^[0-9]{4,6}$' then
    select * into p from public.att_people where active and pin_hash is not null and pin_hash = public.att_pin_hash(pin_salt, code) limit 1;
    src := 'pin';
  end if;
  if p.id is null then
    perform public.audit('asistencia_codigo_invalido', jsonb_build_object('largo', length(code)));
    return jsonb_build_object('ok', false, 'error', 'CODIGO_INVALIDO'); -- se devuelve (no error) para que quede anotado el intento
  end if;
  perform 1 from public.att_people where id = p.id for update; -- dos toques a la vez: el segundo espera
  select * into last from public.att_marks where person_id = p.id and not voided and at >= day_start order by at desc limit 1;
  if last.id is not null and last.at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', true, 'id', last.id, 'name', p.name, 'kind', last.kind, 'at', last.at, 'repeat', true);
  end if;
  k := case when last.kind = 'entrada' then 'salida' else 'entrada' end;
  insert into public.att_marks (person_id, kind, source, created_by) values (p.id, k, src, public.my_staff_name()) returning * into m;
  return jsonb_build_object('ok', true, 'id', m.id, 'name', p.name, 'kind', m.kind, 'at', m.at, 'repeat', false);
end $$;
revoke execute on function public.att_clock(text) from public, anon;
grant execute on function public.att_clock(text) to authenticated;

-- Marcas de hoy (para la pantalla de marcar): solo nombre, tipo y hora
create or replace function public.att_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare day_start timestamptz := (date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima');
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online', 'almacen') then raise exception 'SIN_PERMISO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'kind', m.kind, 'at', m.at) order by m.at desc)
                     from public.att_marks m join public.att_people p on p.id = m.person_id
                    where not m.voided and m.at >= day_start), '[]'::jsonb);
end $$;
revoke execute on function public.att_today() from public, anon;
grant execute on function public.att_today() to authenticated;

-- ---------- Administración (solo Super Admin y Administración) ----------
create or replace function public.att_people_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active, 'daily_hours', daily_hours, 'break_minutes', break_minutes,
    'base_quincena', base_quincena, 'hour_rate', hour_rate, 'has_pin', pin_hash is not null, 'tag', tag, 'store_id', store_id) order by active desc, name) from public.att_people), '[]'::jsonb);
end $$;
revoke execute on function public.att_people_list() from public, anon;
grant execute on function public.att_people_list() to authenticated;

create or replace function public.att_save_person(p_id bigint, p_name text, p_daily_hours numeric, p_break_minutes int, p_base numeric, p_hour_rate numeric, p_active boolean, p_tag text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.att_people; t text := nullif(upper(regexp_replace(coalesce(p_tag, ''), '\s', '', 'g')), '');
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_name), '') = '' or length(p_name) > 80 then raise exception 'NOMBRE_INVALIDO'; end if;
  if t is not null and t !~ '^[0-9A-Z]{4,20}$' then raise exception 'LLAVERO_INVALIDO'; end if;
  if t is not null and exists (select 1 from public.att_people where tag = t and id is distinct from p_id) then raise exception 'LLAVERO_REPETIDO'; end if;
  if p_id is null then
    insert into public.att_people (name, daily_hours, break_minutes, base_quincena, hour_rate, active, tag)
    values (trim(p_name), coalesce(p_daily_hours, 8), coalesce(p_break_minutes, 0), coalesce(p_base, 0), p_hour_rate, coalesce(p_active, true), t) returning * into r;
  else
    update public.att_people set name = trim(p_name), daily_hours = coalesce(p_daily_hours, daily_hours), break_minutes = coalesce(p_break_minutes, break_minutes),
      base_quincena = coalesce(p_base, base_quincena), hour_rate = p_hour_rate, active = coalesce(p_active, active), tag = t, updated_at = now()
     where id = p_id returning * into r;
    if r.id is null then raise exception 'NO_EXISTE'; end if;
  end if;
  perform public.audit('asistencia_persona', jsonb_build_object('id', r.id, 'nombre', r.name, 'jornada', r.daily_hours, 'base', r.base_quincena, 'activa', r.active, 'llavero', r.tag is not null));
  return jsonb_build_object('id', r.id);
end $$;
revoke execute on function public.att_save_person(bigint, text, numeric, int, numeric, numeric, boolean, text) from public, anon;
grant execute on function public.att_save_person(bigint, text, numeric, int, numeric, numeric, boolean, text) to authenticated;

create or replace function public.att_set_pin(p_id bigint, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare s text := md5(random()::text || clock_timestamp()::text);
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then raise exception 'PIN_INVALIDO'; end if;
  if p_pin ~ '^(.)\1+$' or p_pin in ('1234', '12345', '123456', '4321', '0123') then raise exception 'PIN_FACIL'; end if;
  if exists (select 1 from public.att_people where active and id <> p_id and pin_hash is not null and pin_hash = public.att_pin_hash(pin_salt, p_pin)) then raise exception 'PIN_REPETIDO'; end if;
  update public.att_people set pin_salt = s, pin_hash = public.att_pin_hash(s, p_pin), updated_at = now() where id = p_id;
  if not found then raise exception 'NO_EXISTE'; end if;
  perform public.audit('asistencia_pin', jsonb_build_object('id', p_id));
end $$;
revoke execute on function public.att_set_pin(bigint, text) from public, anon;
grant execute on function public.att_set_pin(bigint, text) to authenticated;

create or replace function public.att_marks_range(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'person_id', m.person_id, 'kind', m.kind, 'at', m.at, 'source', m.source, 'created_by', m.created_by,
      'note', m.note, 'voided', m.voided, 'voided_by', m.voided_by, 'void_reason', m.void_reason) order by m.at)
    from public.att_marks m
   where m.at >= (p_from::timestamp at time zone 'America/Lima') and m.at < ((p_to + 1)::timestamp at time zone 'America/Lima')), '[]'::jsonb);
end $$;
revoke execute on function public.att_marks_range(date, date) from public, anon;
grant execute on function public.att_marks_range(date, date) to authenticated;

-- Corrección: se olvidó marcar (queda como «manual», con quién la puso y por qué)
create or replace function public.att_add_mark(p_person bigint, p_kind text, p_at timestamptz, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.att_marks;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if p_kind not in ('entrada', 'salida') then raise exception 'TIPO_INVALIDO'; end if;
  if p_at is null or p_at > now() + interval '5 minutes' or p_at < now() - interval '120 days' then raise exception 'FECHA_INVALIDA'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  if not exists (select 1 from public.att_people where id = p_person) then raise exception 'NO_EXISTE'; end if;
  insert into public.att_marks (person_id, kind, at, source, created_by, note) values (p_person, p_kind, p_at, 'manual', public.my_staff_name(), left(trim(p_note), 200)) returning * into m;
  perform public.audit('asistencia_corregida', jsonb_build_object('persona', p_person, 'tipo', p_kind, 'hora', p_at, 'motivo', left(trim(p_note), 200)));
  return jsonb_build_object('id', m.id);
end $$;
revoke execute on function public.att_add_mark(bigint, text, timestamptz, text) from public, anon;
grant execute on function public.att_add_mark(bigint, text, timestamptz, text) to authenticated;

create or replace function public.att_void_mark(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  update public.att_marks set voided = true, voided_by = public.my_staff_name(), void_reason = left(trim(p_reason), 200), voided_at = now() where id = p_id and not voided;
  if not found then raise exception 'NO_EXISTE'; end if;
  perform public.audit('asistencia_anulada', jsonb_build_object('marca', p_id, 'motivo', left(trim(p_reason), 200)));
end $$;
revoke execute on function public.att_void_mark(bigint, text) from public, anon;
grant execute on function public.att_void_mark(bigint, text) to authenticated;

-- Ajustes de la quincena (ausencia, feriado trabajado, bono, adelanto, descuento)
create or replace function public.att_adjustments_list(p_period date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'person_id', person_id, 'kind', kind, 'amount', amount, 'note', note, 'created_by', created_by) order by id)
    from public.att_adjustments where period_start = p_period and not voided), '[]'::jsonb);
end $$;
revoke execute on function public.att_adjustments_list(date) from public, anon;
grant execute on function public.att_adjustments_list(date) to authenticated;

create or replace function public.att_save_adjustment(p_person bigint, p_period date, p_kind text, p_amount numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.att_adjustments;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if p_kind not in ('ausencia', 'feriado', 'bono', 'adelanto', 'descuento') then raise exception 'TIPO_INVALIDO'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'MONTO_INVALIDO'; end if;
  if extract(day from p_period) not in (1, 16) then raise exception 'QUINCENA_INVALIDA'; end if;
  insert into public.att_adjustments (person_id, period_start, kind, amount, note, created_by)
  values (p_person, p_period, p_kind, round(p_amount, 2), left(coalesce(trim(p_note), ''), 200), public.my_staff_name()) returning * into r;
  perform public.audit('asistencia_ajuste', jsonb_build_object('persona', p_person, 'quincena', p_period, 'tipo', p_kind, 'monto', r.amount));
  return jsonb_build_object('id', r.id);
end $$;
revoke execute on function public.att_save_adjustment(bigint, date, text, numeric, text) from public, anon;
grant execute on function public.att_save_adjustment(bigint, date, text, numeric, text) to authenticated;

create or replace function public.att_void_adjustment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  update public.att_adjustments set voided = true where id = p_id and not voided;
  if not found then raise exception 'NO_EXISTE'; end if;
  perform public.audit('asistencia_ajuste_anulado', jsonb_build_object('ajuste', p_id));
end $$;
revoke execute on function public.att_void_adjustment(bigint) from public, anon;
grant execute on function public.att_void_adjustment(bigint) to authenticated;

-- =====================================================================
--  Comprobación (solo lectura): select to_regclass('public.att_marks') is not null;
-- =====================================================================
