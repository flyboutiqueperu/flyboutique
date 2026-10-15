-- Prueba del SQL 27: promociones automáticas en caja (el servidor recalcula el descuento permitido)
set client_min_messages = warning;
-- Blusa (p2, 89.9) a S/ 5 si lo demás suma ≥ 100; y «combo»: con el Vestido (p1) la Blusa a S/ 50
update store_data set data = jsonb_set(data, '{settings,posPromos}', '[{"id":"pr1","active":true,"name":"Blusa por S/5","kind":"monto","minAmount":100,"targetProductIds":["p2"],"price":5}]');
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '20');
update store_data set data = jsonb_set(data, '{products,1,variants,0,stock}', '20');
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select upsert_seller('MA01','María Alvarado','principal',true);
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100, 'caja-1', 'MA01') is not null as caja_abierta;
\echo '1. Monto alcanzado (Vestido 100 + Blusa): la blusa a S/5 → descuento 84.9 (más del 20% de tope de la cajera, pero es promo)'
select (s->>'autoPromoDiscount')::numeric as promo_84_9, (s->>'manualDiscount')::numeric as manual_0, (s->>'total')::numeric as total_105
  from (select pos_sale('{"items":[{"productId":"p1","variantId":"v2","name":"Vestido","qty":1,"unitPrice":100},{"productId":"p2","variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","discount":84.9,"autoPromoDiscount":84.9,"payments":[{"method":"Efectivo","amount":105}]}') s) x;
\echo '2. Sin llegar al monto: la caja no puede inventar la promo (cuenta como descuento manual y supera el tope)'
select t_expect_error($q$ select pos_sale('{"items":[{"productId":"p2","variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","discount":84.9,"autoPromoDiscount":84.9,"payments":[{"method":"Efectivo","amount":5}]}') $q$, 'DESCUENTO_EXCEDE') as sin_monto_no_hay_promo;
\echo '3. Pedir más promo de la permitida: solo se acepta lo calculado; el resto es manual (y supera el tope)'
select t_expect_error($q$ select pos_sale('{"items":[{"productId":"p1","variantId":"v2","name":"Vestido","qty":1,"unitPrice":100},{"productId":"p2","variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","discount":150,"autoPromoDiscount":150,"payments":[{"method":"Efectivo","amount":39.9}]}') $q$, 'DESCUENTO_EXCEDE') as promo_inflada_rechazada;
\echo '4. Promo por producto (combo) y descuento por prenda dentro del tope'
update store_data set data = jsonb_set(data, '{settings,posPromos}', '[{"id":"pr2","active":true,"name":"Combo","kind":"producto","triggerProductIds":["p1"],"targetProductIds":["p2"],"price":50}]');
select (s->>'autoPromoDiscount')::numeric as combo_39_9, (s->>'manualDiscount')::numeric as manual_10, (s->>'total')::numeric as total_140
  from (select pos_sale('{"items":[{"productId":"p1","variantId":"v2","name":"Vestido","qty":1,"unitPrice":100,"lineDiscount":10,"discountReason":"Prenda con falla"},{"productId":"p2","variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","discount":49.9,"autoPromoDiscount":39.9,"payments":[{"method":"Efectivo","amount":140}]}') s) x;
\echo '5. Promo apagada → no aplica'
update store_data set data = jsonb_set(data, '{settings,posPromos}', '[{"id":"pr2","active":false,"name":"Combo","kind":"producto","triggerProductIds":["p1"],"targetProductIds":["p2"],"price":50}]');
select (s->>'autoPromoDiscount')::numeric as apagada_0
  from (select pos_sale('{"items":[{"productId":"p1","variantId":"v2","name":"Vestido","qty":1,"unitPrice":100},{"productId":"p2","variantId":"v3","name":"Blusa","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","discount":0,"autoPromoDiscount":39.9,"payments":[{"method":"Efectivo","amount":189.9}]}') s) x;
