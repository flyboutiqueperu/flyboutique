set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100) is not null as caja;
select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":2,"unitPrice":100}],"payments":[{"method":"Efectivo","amount":200}]}')->>'id' as sid \gset
select (return_sale(:'sid', '[{"variantId":"v2","qty":1}]', 'x', 'Vale'))->'returns'->0->>'valeCode' as code \gset
select round(extract(epoch from expires_at - created_at) / 86400) between 180 and 185 as vence_6_meses from store_credits where code = :'code';
update store_credits set expires_at = now() - interval '1 day' where code = :'code';
select credit_lookup(:'code')->>'status' as estado_vencido;
select t_expect_error(format($q$ select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":1,"unitPrice":100}],"payments":[{"method":"Vale","amount":100,"code":"%s"}]}') $q$, :'code'), 'VALE_VENCIDO') as vencido_no_sirve;
update store_data set data = jsonb_set(data, '{settings,creditMonths}', '0');
select (return_sale(:'sid', '[{"variantId":"v2","qty":1}]', 'x', 'Vale'))->'returns'->1->>'valeCode' as code2 \gset
select expires_at is null as cero_no_vence from store_credits where code = :'code2';
