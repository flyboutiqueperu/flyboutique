set client_min_messages = warning;
create table if not exists product_costs (product_id text primary key, cost numeric, supplier text, updated_at timestamptz, updated_by text);
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select upsert_supplier(null, 'Gamarra Textil', '20123456789', '999', 'Rosa', null)->>'id' as sid \gset
select t_expect_error($q$ select upsert_supplier(null, 'Gamarra Textil', null, null, null, null) $q$, 'PROVEEDOR_REPETIDO') as repetido;
insert into product_costs (product_id, cost, supplier) values ('p1', 40, 'Viejo') on conflict (product_id) do update set cost = 40;
select data->'products'->0->'variants'->1->>'stock' as stock_m_antes from store_data;
select register_purchase(:sid, 'F001-77', 'almacen', '[{"variantId":"v2","qty":5,"unitCost":50}]', 'llegó ok', true, 'req-1') as p \gset
select (:'p'::jsonb)->>'code' as codigo, (:'p'::jsonb)->>'total' as total_250;
select register_purchase(:sid, 'F001-77', 'almacen', '[{"variantId":"v2","qty":5,"unitCost":50}]', 'llegó ok', true, 'req-1')->>'duplicate' as reintento_no_duplica;
select data->'products'->0->'variants'->1->>'stock' as stock_m_mas5, data->'products'->0->'variants'->1->'stockBy' as por_sede from store_data;
select cost as costo_promedio, supplier from product_costs where product_id = 'p1';
select type, qty, doc from stock_movements order by id desc limit 1;
select t_expect_error(format($q$ select register_purchase(%s, '', 'marte', '[{"variantId":"v2","qty":1,"unitCost":5}]') $q$, :sid), 'UBICACION_INVALIDA') as sede_mala;
select t_expect_error(format($q$ select register_purchase(%s, '', 'almacen', '[{"variantId":"v2","qty":0,"unitCost":5}]') $q$, :sid), 'CANTIDAD_INVALIDA') as cant_mala;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error(format($q$ select register_purchase(%s, '', 'almacen', '[{"variantId":"v2","qty":1,"unitCost":5}]') $q$, :sid), 'SIN_PERMISO') as vendedora_no;
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select void_purchase(((:'p')::jsonb->>'id')::bigint, 'error de registro')->>'status' as anulada;
select data->'products'->0->'variants'->1->>'stock' as stock_vuelve from store_data;
