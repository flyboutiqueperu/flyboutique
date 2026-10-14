set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero'),('88888888-8888-8888-8888-888888888888','alm','Almacen','almacen');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select upsert_seller('MA01','María Alvarado','principal',true);
-- move_stock
select move_stock('v2','entrada',10,'Reposición proveedor X') as entrada_5_mas_10;
select move_stock('v2','merma',1,'Mancha') as merma_14;
select t_expect_error($q$ select move_stock('v2','salida',99) $q$,'STOCK_INSUFICIENTE:14') as salida_mas_de_lo_que_hay;
select t_expect_error($q$ select move_stock('v2','ajuste',12,null,15) $q$,'STOCK_CAMBIO:14') as conteo_desfasado;
select move_stock('v2','ajuste',12,'Conteo',14) as conteo_ok_12;
select move_stock('v2','devolucion',1,'Cliente devolvió') as devol_13;
select t_expect_error($q$ select move_stock('v2','robo',1) $q$,'TIPO_INVALIDO') as tipo_raro; select move_stock('v2','regalo',1,'Influencer') as regalo_12; select move_stock('v2','entrada',1) as vuelve_13;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error($q$ select move_stock('v2','entrada',1) $q$,'SIN_PERMISO') as vendedora_no_mueve_stock;
select count(*) as vendedora_no_ve_historial from stock_movements; -- superuser ve todo; RLS se prueba abajo
-- venta en caja
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100, 'caja-1', 'MA01') is not null as caja;
select pos_sale('{"items":[{"variantId":"v2","name":"Vestido","qty":2,"unitPrice":100}],"sellerCode":"MA01","customerName":"Rosa","payments":[{"method":"Efectivo","amount":200}]}')->>'id' as sid \gset
select type, qty, stock_before, stock_after, unit_price, doc is not null as doc, sale_id = :'sid' as sale, customer, seller, staff_name, channel from stock_movements where sale_id = :'sid';
-- anulación devuelve stock
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select void_sale(:'sid', 'Clienta se arrepintió')->>'status' as anulada;
select type, qty, stock_after, note from stock_movements where sale_id = :'sid' order by id;
-- pedido web
select t_as('{}');
select place_order('{"items":[{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"customerName":"Web","customerPhone":"51988777666","total":89.9,"shipping":0}', 's1')->>'id' as wid \gset
select type, qty, stock_after, channel from stock_movements where sale_id = :'wid';
-- historial completo de v2
select type, qty, stock_before, stock_after, staff_name, note from stock_movements where variant_id='v2' order by id;
-- RLS: vendedora no lee historial
set role authenticated;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1","role":"authenticated"}');
select count(*) as vendedora_ve_0 from stock_movements;
select t_as('{"sub":"88888888-8888-8888-8888-888888888888","aal":"aal1","role":"authenticated"}');
select count(*) > 0 as almacen_ve from stock_movements;
select t_expect_error($q$ insert into stock_movements(type,qty) values ('x',1) $q$,'') as nadie_escribe;
select t_expect_error($q$ select set_stock_context('{}') $q$,'permission') as ctx_privado;
reset role;
-- save_catalog: dos admins editan productos distintos con copias viejas
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
create temp table copia as select data from store_data where id='main';
select move_stock('v1','entrada',3,'llegó') as v1_5;
-- admin A cambia el nombre de p1 (copia vieja con stock v1=2)
select save_catalog(jsonb_set((select data from copia),'{products,0,name}','"Vestido Lino"'), '{}', array['p1'], null, null);
-- admin B cambia precio de p2 con copia vieja y agrega promo
select save_catalog(jsonb_set(jsonb_set((select data from copia),'{products,1,price}','79.9'),'{promoCodes}','[]'), '{}', array['p2'], null, array['promoCodes']);
select data->'products'->0->>'name' as nombre_A_queda, data->'products'->1->>'price' as precio_B_queda, stock('v1') as stock_v1_sigue_5, jsonb_array_length(data->'promoCodes') as promos_0 from store_data;
-- producto nuevo + borrar
select save_catalog(jsonb_set((select data from store_data),'{products}', (select data->'products' from store_data) || '[{"id":"p3","name":"Top","price":50,"variants":[{"id":"v9","size":"S","stock":4}]}]'), '{}', array['p3'], null, null);
select type, qty, stock_after from stock_movements where variant_id='v9';
select save_catalog(jsonb_set((select data from copia),'{products}', '[]'), '{}', array[]::text[], array['p2'], null);
select string_agg(p->>'id', ',') as quedan_p1_p3 from store_data, jsonb_array_elements(data->'products') p;
-- delta de stock desde el editor
select save_catalog((select data from store_data), '{"v9":-1}', array['p3'], null, null);
select stock('v9') as v9_3, (select type from stock_movements where variant_id='v9' order by id desc limit 1) as tipo;
-- llamada vieja (2 args) sigue funcionando
select save_catalog((select data from store_data), '{}'::jsonb) is null as compat_vieja;
-- caja cerrada ya no acepta movimientos
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select (current_cash('principal')->>'id') as cid \gset
select close_cash(:'cid', (current_cash('principal')->>'expectedCash')::numeric, '', 'MA01')->>'status' as cerrada;
select t_expect_error(format('select cash_move(%L,%L,10,%L,%L)', :'cid','salida','x','MA01'),'CAJA_CERRADA') as mover_en_cerrada;
select t_expect_error(format('select close_cash(%L,0,%L,%L)', :'cid','x','MA01'),'CAJA_CERRADA') as cerrar_dos_veces;
