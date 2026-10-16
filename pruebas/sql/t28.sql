-- Prueba del SQL 28: historial de cargas masivas (importar Excel / fotos en lote)
set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero') on conflict do nothing;
\echo '1. Administración registra «catálogo importado» y queda en audit_log con su nombre'
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select staff_log('catalogo_importado', '{"archivo":"listado.xlsx","nuevas":12,"actualizadas":3}');
select staff_log('fotos_subidas', '{"fotos":40,"prendas":12,"publicadas":12}');
select count(*) = 2 as dos_registros, bool_and(user_name is not null) as con_nombre from audit_log where action in ('catalogo_importado','fotos_subidas');
\echo '2. Acción que no es de la lista: rechazada'
select t_expect_error($q$ select staff_log('venta_anulada', '{"x":1}') $q$, 'ACCION_INVALIDA') as accion_invalida;
\echo '3. Detalle enorme: rechazado'
select t_expect_error($q$ select staff_log('fotos_subidas', jsonb_build_object('x', repeat('a', 5000))) $q$, 'DETALLE_INVALIDO') as detalle_grande;
\echo '4. Un cajero no puede escribir en el historial'
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select t_expect_error($q$ select staff_log('fotos_subidas', '{"fotos":1}') $q$, 'SIN_PERMISO') as cajero_sin_permiso;
