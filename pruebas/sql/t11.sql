\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('55555555-5555-5555-5555-555555555555','caja','Carla Cajera','cajero');
\echo '--- 1. Sin caja abierta no se vende en tienda'
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}]}') $q$, 'CAJA_CERRADA');
\echo '--- 2. Abrir caja: vendedora NO, cajero SI, no dos veces'
select t_expect_error($q$ select open_cash('principal', 100) $q$, 'SIN_PERMISO');
select t_as('{"sub":"55555555-5555-5555-5555-555555555555","aal":"aal1"}');
select staff_role() as rol_cajero;
select open_cash('principal', 100)->>'opening_amount' as fondo_100;
select t_expect_error($q$ select open_cash('principal', 50) $q$, 'CAJA_YA_ABIERTA');
\echo '--- 3. Codigos de vendedor: solo administracion los crea'
select t_expect_error($q$ select upsert_seller('MA01','Maria A','principal',true) $q$, 'SIN_PERMISO');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select upsert_seller('ma01','María Alvarado','principal',true);
select t_expect_error($q$ select upsert_seller('M1','X','principal',true) $q$, 'check');
\echo '--- 4. Venta: sin codigo NO; con codigo queda a nombre de la vendedora, cajero y caja'
select t_as('{"sub":"55555555-5555-5555-5555-555555555555","aal":"aal1"}');
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}]}') $q$, 'VENDEDOR_INVALIDO');
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"sellerCode":"ZZ99"}') $q$, 'VENDEDOR_INVALIDO');
select v->>'staffName' as vendedora, v->>'sellerCode' as codigo, v->>'cashierName' as cajero, v->>'cashSessionId' is not null as con_caja, v->>'storeId' as sede
  from (select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"sellerCode":"ma01","payments":[{"method":"Efectivo","amount":100}]}') v) x;
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"sellerCode":"MA01","payments":[{"method":"Yape","amount":60},{"method":"Efectivo","amount":40}]}')->>'total' as mixto_100;
\echo '--- 5. Movimientos de efectivo'
select (current_cash('principal')->>'id') as sid \gset
select t_expect_error($q$ select cash_move(current_setting('my.sid')::uuid, 'salida', 20, '') $q$, 'MOTIVO_REQUERIDO') from (select set_config('my.sid', :'sid', false)) z;
select cash_move(:'sid', 'salida', 20, 'Compra de bolsas');
select cash_move(:'sid', 'entrada', 5, 'Sencillo');
select s->>'expectedCash' as esperado_100_mas_140_menos_20_mas_5_225, s->'byMethod' as por_metodo, s->>'salesCount' as ventas_2
  from (select cash_summary(:'sid') s) x;
\echo '--- 6. Vendedora ve si la caja esta abierta, pero no los montos'
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select current_cash('principal') ? 'expectedCash' as vendedora_ve_montos_false, current_cash('principal')->>'status' as estado;
select t_expect_error($q$ select close_cash(current_setting('my.sid')::uuid, 225, '') $q$, 'SIN_PERMISO');
\echo '--- 7. Cierre con arqueo: diferencia exige motivo'
select t_as('{"sub":"55555555-5555-5555-5555-555555555555","aal":"aal1"}');
select t_expect_error($q$ select close_cash(current_setting('my.sid')::uuid, 220, '') $q$, 'MOTIVO_DIFERENCIA');
select c->>'status' as cerrada, c->>'difference' as diferencia_menos_5 from (select close_cash(:'sid', 220, 'Faltan 5 soles, se revisa') c) x;
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"sellerCode":"MA01"}') $q$, 'CAJA_CERRADA');
\echo '--- 8. Venta online (vendedora online) no necesita caja'
insert into staff_profiles (user_id, username, name, role) values ('66666666-6666-6666-6666-666666666666','web','Wendy Web','vendedora_online');
select t_as('{"sub":"66666666-6666-6666-6666-666666666666","aal":"aal1"}');
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"channel":"online","staffName":"Wendy Web"}')->>'staffName' as venta_online_ok;
