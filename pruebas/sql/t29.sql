-- Prueba del SQL 29: «Avísame cuando vuelva»
set client_min_messages = warning;
\echo '1. Visita de la tienda (sin sesión) pide aviso con celular: ok; repetir: ya_estaba'
select t_as('{}');
set role anon;
select request_stock_alert('p1', 'Negro', 'S', '+51 999 888 777', 'Ana', 'es') = 'ok' as pide_aviso;
select request_stock_alert('p1', 'Negro', 'S', '999888777') = 'ya_estaba' as no_duplica;
select request_stock_alert('p2', 'Marfil', 'S', 'Ana@Correo.com') = 'ok' as pide_con_correo;
\echo '2. Datos malos: rechazados'
select t_expect_error($q$ select request_stock_alert('p1', 'Negro', 'M', '12345') $q$, 'CONTACTO_INVALIDO') as celular_malo;
select t_expect_error($q$ select request_stock_alert('nada', 'Negro', 'M', '999888777') $q$, 'PRENDA_NO_EXISTE') as prenda_inventada;
\echo '3. Nadie de afuera puede leer la lista'
select t_expect_error('select count(*) from stock_alerts', 'permission') as anon_no_lee_tabla;
select t_expect_error($q$ select count(*) from staff_stock_alerts() $q$, 'permission') as anon_no_lee_lista;
reset role;
\echo '4. La vendedora ve la lista, marca «avisado» y queda su nombre'
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select count(*) = 2 as ve_dos, bool_and(contact in ('999888777', 'ana@correo.com')) as contacto_limpio, bool_and(product_name in ('Vestido', 'Blusa')) as con_nombre from staff_stock_alerts();
select set_stock_alert_status((select id from stock_alerts where product_id = 'p1'), 'avisado');
select status = 'avisado' and handled_by = 'Ana' as marcado from stock_alerts where product_id = 'p1';
select count(*) = 1 as quedan_pendientes from staff_stock_alerts('pendiente');
select t_expect_error($q$ select set_stock_alert_status(1, 'borrado') $q$, 'ESTADO_INVALIDO') as estado_malo;
\echo '5. Límite: 10 avisos pendientes por contacto'
select t_as('{}');
insert into stock_alerts (product_id, product_name, color, size, contact, contact_type) select 'p1', 'Vestido', 'C' || g, 'S', '988777666', 'celular' from generate_series(1, 10) g;
select t_expect_error($q$ select request_stock_alert('p1', 'Negro', 'M', '988777666') $q$, 'DEMASIADOS_AVISOS') as limite;
