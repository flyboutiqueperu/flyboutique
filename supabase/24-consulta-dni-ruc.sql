-- =====================================================================
--  FLY BOUTIQUE — 24: CONSULTA DE DNI (RENIEC) Y RUC (SUNAT) EN LA CAJA
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 23. Después, Merge del PR.
--  - Al escribir un DNI o RUC en la caja se completan el nombre / razón social (y la dirección fiscal en factura).
--  - Queda APAGADA hasta que Super Admin guarde el token del proveedor en Más → Consulta DNI/RUC.
--    El token se guarda en app_secrets (solo servidor): nunca vuelve al navegador ni va en el código.
--  - Cada número consultado se recuerda (tabla privada doc_lookups) para no pagar dos veces la misma consulta.
--  - Límite: 60 consultas nuevas por hora por usuario (protege el saldo del proveedor).
--  - Solo staff que vende (Super Admin, Administración, Cajero, Vendedora de tienda u online). No borra datos.
--  Para volver atrás: 24-consulta-dni-ruc-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.doc_lookups (
  doc_type text not null check (doc_type in ('DNI', 'RUC')),
  number text not null,
  name text, address text, estado text, condicion text,
  fetched_at timestamptz not null default now(),
  primary key (doc_type, number)
);
create table if not exists public.doc_lookup_log (
  id bigint generated always as identity primary key,
  user_id uuid, doc_type text, number text, result text,
  at timestamptz not null default now()
);
create index if not exists doc_lookup_log_user_at on public.doc_lookup_log (user_id, at);
alter table public.doc_lookups enable row level security;
alter table public.doc_lookup_log enable row level security;
revoke all on public.doc_lookups from anon, authenticated;
revoke all on public.doc_lookup_log from anon, authenticated;

-- RUC válido: 11 dígitos, empieza en 10/15/16/17/20 y su dígito verificador cuadra
create or replace function public.ruc_valido(p text) returns boolean
language plpgsql immutable as $$
declare w int[] := array[5,4,3,2,7,6,5,4,3,2]; s int := 0; r int; i int;
begin
  if p !~ '^(10|15|16|17|20)[0-9]{9}$' then return false; end if;
  for i in 1..10 loop s := s + substr(p, i, 1)::int * w[i]; end loop;
  r := 11 - (s % 11);
  if r = 10 then r := 0; elsif r = 11 then r := 1; end if;
  return r = substr(p, 11, 1)::int;
end $$;

-- ¿Está activa la consulta? (para mostrar u ocultar el aviso en la caja). Nunca devuelve el token.
create or replace function public.doc_lookup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  return jsonb_build_object(
    'configured', coalesce((select value from public.app_secrets where name = 'docs_api_token'), '') <> '',
    'dniUrl', (select value from public.app_secrets where name = 'docs_api_dni_url'),
    'rucUrl', (select value from public.app_secrets where name = 'docs_api_ruc_url'),
    'cached', (select count(*) from public.doc_lookups));
end $$;
revoke execute on function public.doc_lookup_status() from public, anon;
grant execute on function public.doc_lookup_status() to authenticated;

-- Guarda un valor en app_secrets sin depender de que «name» sea único (actualiza o inserta)
create or replace function public.put_app_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.app_secrets set value = p_value where name = p_name;
  if not found then insert into public.app_secrets (name, value) values (p_name, p_value); end if;
end $$;
revoke execute on function public.put_app_secret(text, text) from public, anon, authenticated;

-- Guardar el token y las direcciones del proveedor (solo Super Admin). Token vacío = no cambiarlo; '-' = borrarlo (apaga la consulta).
create or replace function public.set_doc_lookup_config(p_token text, p_dni_url text default null, p_ruc_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_token), '') = '-' then
    delete from public.app_secrets where name = 'docs_api_token';
  elsif coalesce(trim(p_token), '') <> '' then
    if length(trim(p_token)) > 400 then raise exception 'TOKEN_INVALIDO'; end if;
    perform public.put_app_secret('docs_api_token', trim(p_token));
  end if;
  if p_dni_url is not null then
    if trim(p_dni_url) <> '' and trim(p_dni_url) !~ '^https://[^ ]+\{n\}' then raise exception 'URL_INVALIDA'; end if;
    perform public.put_app_secret('docs_api_dni_url', trim(p_dni_url));
  end if;
  if p_ruc_url is not null then
    if trim(p_ruc_url) <> '' and trim(p_ruc_url) !~ '^https://[^ ]+\{n\}' then raise exception 'URL_INVALIDA'; end if;
    perform public.put_app_secret('docs_api_ruc_url', trim(p_ruc_url));
  end if;
  perform public.audit('consulta_doc_config', jsonb_build_object('token', case when coalesce(trim(p_token), '') = '-' then 'borrado' when coalesce(trim(p_token), '') <> '' then 'cambiado' else 'sin cambio' end));
  return public.doc_lookup_status();
end $$;
revoke execute on function public.set_doc_lookup_config(text, text, text) from public, anon;
grant execute on function public.set_doc_lookup_config(text, text, text) to authenticated;

-- Consultar un DNI o RUC. Responde { ok, name, address, estado, condicion, source } o { ok:false, reason }.
create or replace function public.lookup_document(p_type text, p_number text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  typ text := upper(trim(coalesce(p_type, ''))); num text := regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
  c public.doc_lookups; tok text; url text; st int; body text; j jsonb; nm text; addr text; est text; cond text; n_hour int;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if typ = 'DNI' and num !~ '^[0-9]{8}$' then return jsonb_build_object('ok', false, 'reason', 'NUMERO_INVALIDO'); end if;
  if typ = 'RUC' and not public.ruc_valido(num) then return jsonb_build_object('ok', false, 'reason', 'RUC_INVALIDO'); end if;
  if typ not in ('DNI', 'RUC') then return jsonb_build_object('ok', false, 'reason', 'TIPO_INVALIDO'); end if;

  -- 1) Ya consultado antes (DNI: 1 año; RUC: 30 días, porque su estado puede cambiar)
  select * into c from public.doc_lookups where doc_type = typ and number = num
     and fetched_at > now() - case when typ = 'DNI' then interval '365 days' else interval '30 days' end;
  if c.number is not null then
    return jsonb_build_object('ok', true, 'name', c.name, 'address', c.address, 'estado', c.estado, 'condicion', c.condicion, 'source', 'memoria');
  end if;

  -- 2) Proveedor externo (solo si Super Admin guardó el token)
  select value into tok from public.app_secrets where name = 'docs_api_token';
  if coalesce(tok, '') = '' then return jsonb_build_object('ok', false, 'reason', 'NO_CONFIGURADO'); end if;
  select count(*) into n_hour from public.doc_lookup_log where user_id = auth.uid() and at > now() - interval '1 hour' and result <> 'memoria';
  if n_hour >= 60 then return jsonb_build_object('ok', false, 'reason', 'LIMITE'); end if;
  url := coalesce(nullif((select value from public.app_secrets where name = case when typ = 'DNI' then 'docs_api_dni_url' else 'docs_api_ruc_url' end), ''),
                  case when typ = 'DNI' then 'https://api.decolecta.com/v1/reniec/dni?numero={n}' else 'https://api.decolecta.com/v1/sunat/ruc?numero={n}' end);
  url := replace(url, '{n}', num);
  begin
    begin perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '6'); exception when others then null; end;
    select r.status, r.content into st, body
      from extensions.http(('GET', url, array[extensions.http_header('Authorization', 'Bearer ' || tok), extensions.http_header('Accept', 'application/json')], null, null)::extensions.http_request) r;
  exception when others then
    insert into public.doc_lookup_log (user_id, doc_type, number, result) values (auth.uid(), typ, num, 'sin-conexion');
    return jsonb_build_object('ok', false, 'reason', 'SIN_CONEXION');
  end;
  if st = 401 or st = 403 then
    insert into public.doc_lookup_log (user_id, doc_type, number, result) values (auth.uid(), typ, num, 'token-' || st);
    return jsonb_build_object('ok', false, 'reason', 'TOKEN_RECHAZADO');
  end if;
  begin j := body::jsonb; exception when others then j := null; end;
  if j ? 'data' and jsonb_typeof(j->'data') = 'object' then j := j->'data'; end if;   -- algunos proveedores envuelven la respuesta
  if st <> 200 or j is null then
    insert into public.doc_lookup_log (user_id, doc_type, number, result) values (auth.uid(), typ, num, 'no-encontrado-' || coalesce(st, 0));
    return jsonb_build_object('ok', false, 'reason', 'NO_ENCONTRADO');
  end if;

  -- Nombres de campos de los proveedores más usados en Perú (Decolecta / apis.net.pe / apiperu)
  if typ = 'DNI' then
    nm := coalesce(nullif(trim(concat_ws(' ', coalesce(j->>'first_name', j->>'nombres'),
                                               coalesce(j->>'first_last_name', j->>'apellidoPaterno', j->>'apellido_paterno'),
                                               coalesce(j->>'second_last_name', j->>'apellidoMaterno', j->>'apellido_materno'))), ''),
                   j->>'full_name', j->>'nombre_completo', j->>'nombreCompleto', j->>'nombre');
  else
    nm := coalesce(j->>'razon_social', j->>'razonSocial', j->>'nombre_o_razon_social', j->>'nombre');
    addr := nullif(trim(coalesce(j->>'direccion_completa', j->>'direccion', j->>'address', '')), '');
    if addr is not null and addr !~ ',' then
      addr := concat_ws(', ', addr, nullif(j->>'distrito', ''), nullif(j->>'provincia', ''), nullif(j->>'departamento', ''));
    end if;
    est := coalesce(j->>'estado', j->>'status');
    cond := coalesce(j->>'condicion', j->>'condition');
  end if;
  if coalesce(trim(nm), '') = '' then
    insert into public.doc_lookup_log (user_id, doc_type, number, result) values (auth.uid(), typ, num, 'sin-nombre');
    return jsonb_build_object('ok', false, 'reason', 'NO_ENCONTRADO');
  end if;
  nm := left(case when typ = 'DNI' then initcap(lower(trim(nm))) else upper(trim(nm)) end, 160);
  insert into public.doc_lookups (doc_type, number, name, address, estado, condicion, fetched_at)
  values (typ, num, left(nm, 160), left(addr, 250), left(est, 40), left(cond, 40), now())
  on conflict (doc_type, number) do update set name = excluded.name, address = excluded.address, estado = excluded.estado, condicion = excluded.condicion, fetched_at = now();
  insert into public.doc_lookup_log (user_id, doc_type, number, result) values (auth.uid(), typ, num, 'ok');
  return jsonb_build_object('ok', true, 'name', left(nm, 160), 'address', left(addr, 250), 'estado', est, 'condicion', cond, 'source', 'proveedor');
end $$;
revoke execute on function public.lookup_document(text, text) from public, anon;
grant execute on function public.lookup_document(text, text) to authenticated;
