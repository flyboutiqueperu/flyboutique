-- Prueba del SQL 31 (asistencia). Correr en una base recién creada: bash pruebas/sql/build.sh a31 && psql … -d a31 -f pruebas/sql/t31.sql
set client_min_messages = warning;
create temp table r (n serial, t text, ok boolean);
create or replace function pg_temp.chk(t text, c boolean) returns void language sql as $$ insert into r (t, ok) values (t, coalesce(c, false)) $$;
insert into staff_profiles (user_id, username, name, role) values ('33333333-3333-3333-3333-333333333333', 'caja', 'Caja Larco', 'vendedora_tienda') on conflict do nothing;
update staff_profiles set role = 'superadmin' where user_id = '11111111-1111-1111-1111-111111111111';
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select (att_save_person(null, 'Nicolle', 8, 0, 615, null, true, null))->>'id' as nico \gset
select (att_save_person(null, 'Gabriela', 4, 0, 307.5, null, true, '0006930684'))->>'id' as gabi \gset
select pg_temp.chk('PIN fácil rechazado', t_expect_error($q$ select att_set_pin(1, '1111') $q$, 'PIN_FACIL') like 'ok%');
select att_set_pin(:nico, '4821');
select pg_temp.chk('PIN repetido rechazado', t_expect_error(format($q$ select att_set_pin(%s, '4821') $q$, :gabi), 'PIN_REPETIDO') like 'ok%');
select pg_temp.chk('Llavero repetido rechazado', t_expect_error($q$ select att_save_person(null, 'Otra', 8, 0, 1, null, true, '0006930684') $q$, 'LLAVERO_REPETIDO') like 'ok%');
select pg_temp.chk('La lista no devuelve el PIN', (select bool_and(not (x ? 'pin_hash') and not (x ? 'pin_salt')) from jsonb_array_elements(att_people_list()) x));
select pg_temp.chk('El PIN no se guarda en claro', not exists (select 1 from att_people where pin_hash = '4821' or pin_salt = '4821'));
-- Marcar desde la caja (vendedora de tienda con sesión)
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select att_clock('4821') as m1 \gset
select pg_temp.chk('PIN → entrada de Nicolle', (:'m1'::jsonb)->>'kind' = 'entrada' and (:'m1'::jsonb)->>'name' = 'Nicolle');
select pg_temp.chk('Segundo toque al instante no duplica', (att_clock('4821'))->>'repeat' = 'true' and (select count(*) from att_marks where person_id = :nico) = 1);
update att_marks set at = at - interval '3 hours' where person_id = :nico;
select pg_temp.chk('Después marca salida', (att_clock('4821'))->>'kind' = 'salida');
select pg_temp.chk('Llavero (tag) → entrada de Gabriela', (att_clock('0006930684'))->>'name' = 'Gabriela');
select pg_temp.chk('Código malo: no marca y avisa', (att_clock('9999'))->>'error' = 'CODIGO_INVALIDO' and (select count(*) from att_marks) = 3);
select pg_temp.chk('El intento malo queda anotado', exists (select 1 from audit_log where action = 'asistencia_codigo_invalido'));
select att_clock('9998'), att_clock('9997'), att_clock('9996'), att_clock('9995'), att_clock('9994'), att_clock('9993'), att_clock('9992');
select pg_temp.chk('Tras 8 intentos malos se frena', (att_clock('4821'))->>'error' = 'DEMASIADOS_INTENTOS');
select pg_temp.chk('Hoy: lista de marcas sin datos privados', jsonb_array_length(att_today()) = 3);
select pg_temp.chk('Vendedora no ve personas ni sueldos', t_expect_error($q$ select att_people_list() $q$, 'SIN_PERMISO') like 'ok%');
select pg_temp.chk('Vendedora no corrige marcas', t_expect_error(format($q$ select att_add_mark(%s, 'entrada', now(), 'x') $q$, :nico), 'SIN_PERMISO') like 'ok%');
select pg_temp.chk('Sin acceso directo a las tablas', t_expect_error($q$ set local role authenticated; select * from att_people $q$, 'permission denied') like 'ok%');
select t_as('{}');
select pg_temp.chk('Sin sesión no se marca', t_expect_error($q$ select att_clock('4821') $q$, 'SIN_PERMISO') like 'ok%');
-- Administración
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select pg_temp.chk('Corrección sin motivo: no', t_expect_error(format($q$ select att_add_mark(%s, 'salida', now() - interval '1 hour', '') $q$, :nico), 'MOTIVO_REQUERIDO') like 'ok%');
select att_add_mark(:gabi, 'salida', now(), 'Olvidó marcar');
select pg_temp.chk('Corrección manual guardada', exists (select 1 from att_marks where source = 'manual' and created_by = 'Admin Uno'));
select att_void_mark((select max(id) from att_marks), 'Puse mal la hora');
select pg_temp.chk('Anular conserva la marca (no borra)', exists (select 1 from att_marks where voided and void_reason = 'Puse mal la hora'));
select pg_temp.chk('Rango de marcas', jsonb_array_length(att_marks_range(current_date - 1, current_date + 1)) = 4);
select pg_temp.chk('Ajuste en quincena inválida: no', t_expect_error(format($q$ select att_save_adjustment(%s, '2026-10-05', 'bono', 10, '') $q$, :nico), 'QUINCENA_INVALIDA') like 'ok%');
select att_save_adjustment(:nico, '2026-10-01', 'ausencia', 41, 'Faltó el 3');
select pg_temp.chk('Ajuste guardado', jsonb_array_length(att_adjustments_list('2026-10-01')) = 1);
select (n || '. ' || case when ok then 'OK    ' else 'FALLA ' end || t) as resultado from r order by n;
select case when bool_and(ok) then 'TODO OK' else 'HAY FALLAS' end as final from r;
