set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100) is not null as caja;
select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":2,"unitPrice":100}],"customerName":"Lucía","payments":[{"method":"Efectivo","amount":200}]}')->>'id' as sid \gset
-- Devolución con vale de 1 vestido (100)
select return_sale(:'sid', '[{"variantId":"v2","qty":1}]', 'No le quedó', 'Vale') as r \gset
select (:'r'::jsonb)->'returns'->0->>'valeCode' as code \gset
select :'code' ~ '^V[A-Z2-9]{6}$' as codigo_ok, balance as saldo_100, status from store_credits where code = :'code';
select current_cash('principal')->>'salidas' as caja_sin_salida_0;
select credit_lookup(lower(:'code'))->>'balance' as lookup_minusculas;
-- Pagar 60 con vale + 40 efectivo
select pos_sale(format('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":1,"unitPrice":100}],"payments":[{"method":"Vale","amount":60,"code":"%s"},{"method":"Efectivo","amount":40}]}', :'code')::jsonb)->>'id' as sid2 \gset
select balance as saldo_40, status, jsonb_array_length(history) as movimientos from store_credits where code = :'code';
-- Intentar usar 50 (solo quedan 40): no se guarda la venta ni se descuenta stock
select data->'products'->0->'variants'->1->>'stock' as stock_antes from store_data;
select t_expect_error(format($q$ select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":1,"unitPrice":100}],"payments":[{"method":"Vale","amount":50,"code":"%s"},{"method":"Efectivo","amount":50}]}') $q$, :'code'), 'VALE_SIN_SALDO:40') as sin_saldo;
select data->'products'->0->'variants'->1->>'stock' as stock_igual from store_data;
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":1,"unitPrice":100}],"payments":[{"method":"Vale","amount":100,"code":"VNOEXIS"}]}') $q$, 'VALE_NO_EXISTE') as no_existe;
-- Anular la venta pagada con vale: vuelve el saldo
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select void_sale(:'sid2'::text, 'error')->>'status' as anulada;
select balance as saldo_100_de_nuevo, status from store_credits where code = :'code';
-- upsert de la misma venta no descuenta otra vez
insert into sales (id, data) select id, data from sales where id = :'sid2'::text on conflict (id) do update set data = excluded.data;
select balance as sigue_100 from store_credits where code = :'code';
-- anular vale
select t_expect_error(format($q$ select void_credit(%L, '') $q$, :'code'), 'MOTIVO_REQUERIDO') as motivo;
select void_credit(:'code', 'Entregado por error')->>'status' as vale_anulado;
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select t_expect_error(format($q$ select void_credit(%L, 'x') $q$, :'code'), 'SIN_PERMISO') as cajero_no_anula_vale;
select t_expect_error(format($q$ select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":1,"unitPrice":100}],"payments":[{"method":"Vale","amount":100,"code":"%s"}]}') $q$, :'code'), 'VALE_SIN_SALDO') as vale_anulado_no_sirve;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select count(*) as vendedora_no_ve_tabla from store_credits;
