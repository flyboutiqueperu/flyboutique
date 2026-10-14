set client_min_messages = warning;
create or replace function sb(v text) returns text language sql as $$ select coalesce(x->>'stockBy','(sin sedes)') || ' total=' || (x->>'stock') from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x where x->>'id' = v $$;
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero'),('88888888-8888-8888-8888-888888888888','alm','Rosa Almacén','almacen');
-- Almacén recibe mercadería y la envía a Larco con guía
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select 'traslado inicial Larco→Almacén 6: ' || (create_transfer('principal','almacen','[{"variantId":"v2","qty":6}]','Guardar temporada')->>'code');
select 'en camino: ' || sb('v2');
select t_as('{"sub":"88888888-8888-8888-8888-888888888888","aal":"aal1"}');
select 'almacén recibe: ' || (receive_transfer((select id from stock_transfers where code='T001-000001'))->>'received_by') || ' ' || sb('v2');
select t_expect_error($q$ select create_transfer('almacen','principal','[{"variantId":"v2","qty":9}]') $q$, 'STOCK_INSUFICIENTE') as no_enviar_mas;
select 'almacén envía 3 a Larco: ' || (create_transfer('almacen','principal','[{"variantId":"v2","qty":3},{"variantId":"v1","qty":0}]')->>'code') as x;
