set client_min_messages = warning;
-- p2 (Blusa 89.9) pasa a Outlet; p1 Vestido 100 normal
update store_data set data = jsonb_set(jsonb_set(data, '{products,1,outlet}', 'true'), '{products,1,variants,0,stock}', '5');
update store_data set data = jsonb_set(data, '{settings,localShipping}', '{"price":12,"freeFrom":150}');
update store_data set data = jsonb_set(data, '{settings,loyalty}', '{"enabled":true,"solesPerStep":1,"pointsPerStep":1,"blockPoints":100,"blockValue":3}');
select t_as('{}');
-- web: 1 normal (100) + 1 outlet (89.9) = 189.9; FLY10 = 10% de 100 = 10; envío: 100 < 150 → 12; total 191.9
select (o->>'discount')::numeric as cupon_solo_normal_10, (o->>'shipping')::numeric as envio_12_outlet_no_cuenta, (o->>'total')::numeric as total_191_9, (o->>'outletSubtotal')::numeric as outlet_89_9
  from (select place_order('{"items":[{"variantId":"v1","name":"Vestido","qty":1,"unitPrice":100},{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"promoCode":"FLY10","deliveryMethod":"delivery","customerName":"Web","customerPhone":"51988777666","total":191.9}', 's1') o) x;
select t_expect_error($q$ select place_order('{"items":[{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"promoCode":"FLY10","deliveryMethod":"recojo","total":80.9}', 's2') $q$, 'TOTAL_CAMBIO') as cupon_no_baja_outlet;
select (place_order('{"items":[{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"promoCode":"FLY10","deliveryMethod":"recojo","total":89.9}', 's3')->>'total')::numeric as solo_outlet_cupon_0;
-- puntos: la clienta 51999000111 tiene 250 (necesita Google/código para usar puntos web: se prueba en caja)
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select (validate_online_payment((select id from sales where data->>'customerPhone'='51988777666' limit 1))->>'earnedPoints')::int as puntos_solo_normal_90;
-- caja
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
select upsert_seller('MA01','María Alvarado','principal',true);
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100, 'caja-1', 'MA01') is not null;
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","customerPhone":"51999000111","pointsUsed":100,"discount":3,"payments":[{"method":"Efectivo","amount":86.9}]}') $q$, 'PUNTOS_INVALIDOS') as puntos_no_pagan_outlet;
select (s->>'earnedPoints')::int as puntos_caja_solo_normal_100, (s->>'outletSubtotal')::numeric as outlet
  from (select pos_sale('{"items":[{"variantId":"v2","name":"Vestido","qty":1,"unitPrice":100},{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","customerPhone":"51999000111","payments":[{"method":"Efectivo","amount":189.9}]}') s) x;
select (s->>'discount')::numeric as cupon_caja_10
  from (select pos_sale('{"items":[{"variantId":"v2","name":"Vestido","qty":1,"unitPrice":100},{"variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","promoCode":"FLY10","discount":10,"payments":[{"method":"Efectivo","amount":179.9}]}') s) x;
