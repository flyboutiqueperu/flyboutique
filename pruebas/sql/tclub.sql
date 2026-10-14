set client_min_messages = warning;
update store_data set data = jsonb_set(jsonb_set(data, '{products,0,variants,1,stock}', '20'), '{settings,clubEnabled}', 'false');
update customers set data = jsonb_set(data, '{points}', '500') where phone = '51999000111';
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"customerPhone":"51999000111"}')->>'earnedPoints' as club_off_gana_0;
select t_expect_error($q$ select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"customerPhone":"51999000111","pointsUsed":100,"discount":3}') $q$, 'CLUB_DESACTIVADO') as club_off_no_usa_caja;
select t_as('{"sub":"44444444-4444-4444-4444-444444444444","email":"a@x.com","app_metadata":{"provider":"google"}}');
select t_expect_error($q$ select place_order('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"deliveryMethod":"recojo","customerPhone":"51999000111","pointsUsed":100,"total":97}', 's') $q$, 'CLUB_DESACTIVADO') as club_off_no_usa_web;
select place_order('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"deliveryMethod":"recojo","customerPhone":"51999000111","total":100}', 's')->>'id' as pedido \gset
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select validate_online_payment(:'pedido')->>'earnedPoints' as validar_club_off_gana_0;
select pts('51999000111') as puntos_se_conservan_500;
update store_data set data = jsonb_set(data, '{settings,clubEnabled}', 'true');
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"customerPhone":"51999000111"}')->>'earnedPoints' as club_on_gana_100;
