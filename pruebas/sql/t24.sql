set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values
 ('44444444-4444-4444-4444-444444444444','alberto','Alberto','superadmin'),
 ('33333333-3333-3333-3333-333333333333','caja','Caja Larco','cajero'),
 ('55555555-5555-5555-5555-555555555555','alma','Almacén','almacen') on conflict do nothing;
-- Simulación de la extensión http de Supabase (en la base local no existe): responde según el número pedido
do $$ begin
  if not exists (select 1 from pg_type where typname = 'http_header') then
    create type extensions.http_header as (field varchar, value varchar);
    create type extensions.http_request as (method text, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
  end if;
end $$;
create or replace function extensions.http_header(field varchar, value varchar) returns extensions.http_header language sql as $$ select row(field, value)::extensions.http_header $$;
create table if not exists t_http_calls (uri text, auth text, at timestamptz default now());
create or replace function extensions.http(r extensions.http_request) returns table(status int, content text) language plpgsql as $$
begin
  insert into t_http_calls values (r.uri, (r.headers[1]).value);
  if (r.headers[1]).value <> 'Bearer token-bueno' then return query select 401, '{"message":"unauthorized"}'; return; end if;
  if r.uri like '%dni?numero=45678912' then return query select 200, '{"first_name":"LUCIA","first_last_name":"TORRES","second_last_name":"VEGA","document_number":"45678912"}';
  elsif r.uri like '%dni?numero=11111111' then return query select 404, '{"message":"not found"}';
  elsif r.uri like '%ruc?numero=20100047218' then return query select 200, '{"data":{"razonSocial":"Banco de Credito del Peru","estado":"ACTIVO","condicion":"HABIDO","direccion":"Calle Centenario 156","distrito":"La Molina","provincia":"Lima","departamento":"Lima"}}';
  elsif r.uri like '%caido%' then raise exception 'timeout';
  else return query select 404, ''; end if;
end $$;
\set ON_ERROR_STOP 1
\i supabase/24-consulta-dni-ruc.sql
\set ON_ERROR_STOP 0
select 'RUC dígito verificador' as prueba, ruc_valido('20100047218') as bcp_ok, ruc_valido('20100047219') as malo_no, ruc_valido('12345678901') as prefijo_no;
-- Cajero: sin token → apagada
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select lookup_document('DNI', '45678912')->>'reason' as sin_token;
select (doc_lookup_status()->>'configured') as configurado_no;
select t_expect_error($q$ select set_doc_lookup_config('token-bueno') $q$, 'SIN_PERMISO') as cajero_no_guarda_token;
-- Administración tampoco puede guardar el token; Super Admin sí (y nunca se devuelve)
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select t_expect_error($q$ select set_doc_lookup_config('token-bueno') $q$, 'SIN_PERMISO') as admin_no_guarda_token;
select t_as('{"sub":"44444444-4444-4444-4444-444444444444","aal":"aal2"}');
select set_doc_lookup_config('token-malo')::text not like '%token-malo%' as token_no_se_devuelve;
select lookup_document('DNI', '45678912')->>'reason' as token_rechazado;
select set_doc_lookup_config('token-bueno')->>'configured' as configurado_si;
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select lookup_document('DNI', '45678912') as dni_ok;
select lookup_document('DNI', '45678912')->>'source' as segunda_vez_desde_memoria;
select count(*) as llamadas_al_proveedor_por_45678912 from t_http_calls where uri like '%45678912' and auth = 'Bearer token-bueno';
select lookup_document('RUC', '20100047218') as ruc_ok;
select lookup_document('DNI', '11111111')->>'reason' as dni_no_existe;
select lookup_document('DNI', '1234')->>'reason' as dni_corto;
select lookup_document('RUC', '20100047219')->>'reason' as ruc_digito_malo;
-- Sin conexión con el proveedor
select t_as('{"sub":"44444444-4444-4444-4444-444444444444","aal":"aal2"}');
select set_doc_lookup_config('', 'https://caido.test/dni?numero={n}')->>'dniUrl' as url_cambiada;
select t_expect_error($q$ select set_doc_lookup_config('', 'http://inseguro.test/{n}') $q$, 'URL_INVALIDA') as url_sin_https;
select lookup_document('DNI', '70000001')->>'reason' as sin_conexion;
-- Límite por hora
insert into doc_lookup_log (user_id, doc_type, number, result) select '33333333-3333-3333-3333-333333333333', 'DNI', '0', 'ok' from generate_series(1, 60);
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select lookup_document('DNI', '70000002')->>'reason' as limite;
select lookup_document('DNI', '45678912')->>'source' as memoria_sigue_aunque_haya_limite;
-- Almacén no puede consultar; nadie puede leer las tablas directo
select t_as('{"sub":"55555555-5555-5555-5555-555555555555","aal":"aal1"}');
select t_expect_error($q$ select lookup_document('DNI', '45678912') $q$, 'SIN_PERMISO') as almacen_no;
set role authenticated;
select t_expect_error($q$ select * from doc_lookups $q$, 'permission denied') as tabla_privada;
reset role;
-- Borrar token apaga la consulta
select t_as('{"sub":"44444444-4444-4444-4444-444444444444","aal":"aal2"}');
select set_doc_lookup_config('-')->>'configured' as apagada_otra_vez;
-- Se puede volver a correr el SQL sin errores
\set ON_ERROR_STOP 1
\i supabase/24-consulta-dni-ruc.sql
select 'repetible' as ok;
