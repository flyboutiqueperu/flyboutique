set client_min_messages = warning;
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
select t_as('{}');
select place_order('{"items":[{"variantId":"v2","name":"V","qty":2,"unitPrice":100}],"deliveryMethod":"recojo","total":200}', 's')->>'id' as viejo \gset
select place_order('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"deliveryMethod":"recojo","total":100}', 's')->>'id' as nuevo \gset
select place_order('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"deliveryMethod":"recojo","total":100}', 's')->>'id' as pagado \gset
select stock('v2') as stock_tras_3_pedidos_6;
update sales set created_at = now() - interval '25 hours' where id in (:'viejo', :'pagado');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select validate_online_payment(:'pagado')->>'paymentStatus' as pagado_confirmado;
select t_as('{}');
select expire_unpaid_orders() as anon_cancela_1_vencido;
select (select data->>'status' from sales where id=:'viejo') as viejo_anulado, (select data->>'voidedBy' from sales where id=:'viejo') as por,
       (select data->>'status' from sales where id=:'nuevo') as nuevo_sigue, (select data->>'status' from sales where id=:'pagado') as pagado_sigue, stock('v2') as stock_vuelve_8;
update store_data set data = jsonb_set(data, '{settings,unpaidOrderHours}', '0');
update sales set created_at = now() - interval '30 hours' where id = :'nuevo';
select expire_unpaid_orders() as con_0_no_cancela;
select t_expect_error(format('select cancel_unpaid_order(%L)', :'nuevo'), 'SIN_PERMISO') as anon_no_puede;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error(format('select cancel_unpaid_order(%L)', :'pagado'), 'SOLO_PEDIDOS_SIN_PAGO') as pagado_no;
select cancel_unpaid_order(:'nuevo', 'La clienta desistió')->>'voidReason' as vendedora_cancela;
select stock('v2') as stock_9;
select t_expect_error(format('select void_sale(%L, %L)', :'pagado', 'x'), 'SIN_PERMISO') as vendedora_no_anula_pagado;
