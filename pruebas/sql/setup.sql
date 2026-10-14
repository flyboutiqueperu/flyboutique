\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into store_data values ('main', '{"products":[
 {"id":"p1","name":"Vestido","price":100,"variants":[{"id":"v1","size":"S","colorName":"Negro","stock":2},{"id":"v2","size":"M","colorName":"Negro","stock":5}]},
 {"id":"p2","name":"Blusa","price":89.9,"variants":[{"id":"v3","size":"S","colorName":"Marfil","stock":1}]}],
 "promoCodes":[{"code":"FLY10","type":"percent","value":10,"active":true},{"code":"FIX20","type":"fixed","value":20,"active":true},{"code":"CLUB15","type":"percent","value":15,"active":true,"clubOnly":true},{"code":"OLD","type":"percent","value":50,"active":false}],
 "settings":{"loyalty":{"blockPoints":100,"blockValue":3}},"collections":[],"banners":[]}');
insert into customers values ('51999000111', '{"name":"Victima","phone":"51999000111","email":"a@x.com","points":250}'),
                             ('g:evil@x.com', '{"name":"Evil","email":"evil@x.com","points":10}');
insert into staff_profiles (user_id, username, name, role) values
 ('11111111-1111-1111-1111-111111111111','admin','Admin Uno','administrador'),
 ('22222222-2222-2222-2222-222222222222','ana','Ana','vendedora_tienda');
insert into doc_counters values ('B001', 1);

create or replace function t_as(claims text) returns void language sql as $$ select set_config('request.jwt.claims', claims, false) $$;
create or replace function t_expect_error(q text, frag text) returns text language plpgsql as $$
begin execute q; return 'FALLO: no dio error (esperaba ' || frag || ')';
exception when others then if sqlerrm like '%' || frag || '%' then return 'ok (' || frag || ')'; else return 'FALLO: ' || sqlerrm; end if; end $$;
create or replace function stock(v text) returns int language sql as $$
 select (x->>'stock')::int from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x where x->>'id' = v $$;
create or replace function pts(ph text) returns int language sql as $$ select (data->>'points')::int from customers where phone = ph $$;

