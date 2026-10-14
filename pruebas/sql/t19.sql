set client_min_messages = warning;
create or replace function sb(v text) returns text language sql as $$ select coalesce(x->>'stockBy','(sin ubicaciones)') || ' total=' || (x->>'stock') from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x where x->>'id' = v $$;
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select 'inicio v2: ' || sb('v2');
select 'traslado 4 a casa: ' || transfer_stock('v2','principal','casa',4,'Guardar en casa')::text;
select 'v2: ' || sb('v2');
select t_expect_error($q$ select transfer_stock('v2','casa','principal',9) $q$, 'STOCK_INSUFICIENTE:4') as no_mover_mas_de_lo_que_hay;
select 'entrada 3 en casa → ' || move_stock('v2','entrada',3,'Llegó a casa',null,'casa') || ' ' || sb('v2');
select t_expect_error($q$ select move_stock('v2','merma',8,'x',null,'casa') $q$, 'STOCK_INSUFICIENTE:7') as merma_mas_que_casa;
select 'conteo casa=5 → ' || move_stock('v2','ajuste',5,'Conté casa',7,'casa') || ' ' || sb('v2');
-- venta en caja Larco: sale de principal
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
select upsert_seller('MA01','María','principal',true);
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100, 'caja-1', 'MA01') is not null as caja;
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":2,"unitPrice":100}],"sellerCode":"MA01","payments":[{"method":"Efectivo","amount":200}]}')->>'total' as venta;
select 'tras venta Larco: ' || sb('v2');
-- web vende 5: primero Larco (4) luego casa (1)
select t_as('{}');
select place_order('{"items":[{"variantId":"v2","name":"V","qty":5,"unitPrice":100}],"deliveryMethod":"recojo","total":500}', 'w1')->>'total' as web;
select 'tras web 5: ' || sb('v2');
-- editor del catálogo con copia vieja que dice stockBy falso: el servidor conserva el suyo
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select save_catalog(jsonb_set((select data from store_data), '{products,0,variants,1,stockBy}', '{"principal":99}'), '{"v2":2}', array['p1'], null, null);
select 'editor +2 (stockBy falso ignorado): ' || sb('v2');
select type, qty, stock_before, stock_after, store_id, note from stock_movements where variant_id='v2' order by id;
