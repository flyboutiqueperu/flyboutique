set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '10');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select upsert_seller('MA01','María Alvarado','principal',true);
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select open_cash('principal', 100, 'caja-1', 'MA01') is not null as caja;
-- Venta: 2 vestidos M (100 c/u) + 1 blusa (89.9) con cupón FLY10 → descuento 19 (aprox) y puntos
select pos_sale('{"items":[{"variantId":"v2","productId":"p1","name":"Vestido","size":"M","colorName":"Negro","qty":2,"unitPrice":100},{"variantId":"v3","productId":"p2","name":"Blusa","size":"S","colorName":"Marfil","qty":1,"unitPrice":89.9}],"sellerCode":"MA01","promoCode":"FLY10","discount":29,"customerPhone":"51999000111","payments":[{"method":"Efectivo","amount":260.9}]}') as s \gset
select (:'s'::jsonb)->>'id' as sid, (:'s'::jsonb)->>'total' as total, (:'s'::jsonb)->>'earnedPoints' as ganados \gset
select :'total' as total_venta, :'ganados' as puntos_ganados, (select data->>'points' from customers where phone='51999000111') as puntos_antes;
select data->'products'->0->'variants'->1->>'stock' as stock_m_antes from store_data;
-- vendedora no puede
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error(format($q$ select return_sale(%L, $j$[{"variantId":"v2","qty":1}]$j$, $m$x$m$) $q$, :'sid'), 'SIN_PERMISO') as vendedora_no;
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select t_expect_error(format($q$ select return_sale(%L, '[{"variantId":"v2","qty":1}]', '') $q$, :'sid'), 'MOTIVO_REQUERIDO') as sin_motivo;
select t_expect_error(format($q$ select return_sale(%L, '[{"variantId":"v2","qty":3}]', 'x', 'Efectivo', '[]', null, null, 'MA01') $q$, :'sid'), 'YA_DEVUELTO:2') as mas_de_lo_vendido;
select t_expect_error(format($q$ select return_sale(%L, '[{"variantId":"v1","qty":1}]', 'x', 'Efectivo', '[]', null, null, 'MA01') $q$, :'sid'), 'NO_ESTA_EN_LA_VENTA') as otra_prenda;
-- Devolución de 1 vestido en efectivo
select return_sale(:'sid', '[{"variantId":"v2","qty":1}]', 'No le quedó', 'Efectivo', '[]', null, 'op-1', 'MA01') as r1 \gset
select :'r1'::jsonb->'returns'->0->>'returnedAmount' as devuelto_90, :'r1'::jsonb->>'refundedTotal' as refunded, :'r1'::jsonb->>'returnStatus' as estado_parcial, :'r1'::jsonb->'returns'->0->>'pointsRemoved' as puntos_quitados;
select return_sale(:'sid', '[{"variantId":"v2","qty":1}]', 'No le quedó', 'Efectivo', '[]', null, 'op-1', 'MA01')->>'duplicate' as reintento_no_duplica;
select data->'products'->0->'variants'->1->>'stock' as stock_m_mas1 from store_data;
select (current_cash('principal')->>'salidas') as salida_caja, current_cash('principal')->>'expectedCash' as esperado;
select data->>'points' as puntos_despues from customers where phone='51999000111';
-- Cambio: blusa (89.9*0.9=80.91) por vestido S (100) → paga 19.09 con Yape
select return_sale(:'sid', '[{"variantId":"v3","qty":1}]', 'Cambio por vestido', 'Yape', '[{"variantId":"v1","qty":1}]', null, 'op-2', 'MA01') as r2 \gset
select :'r2'::jsonb->'returns'->1->>'difference' as diferencia_negativa, :'r2'::jsonb->>'refundedTotal' as refunded_total, :'r2'::jsonb->>'returnStatus' as estado;
select data->'products'->0->'variants'->0->>'stock' as stock_s_menos1, data->'products'->1->'variants'->0->>'stock' as blusa_mas1 from store_data;
select type, qty, doc, note from stock_movements order by id desc limit 3;
select t_expect_error(format($q$ select return_sale(%L, '[{"variantId":"v3","qty":1}]', 'x', 'Efectivo', '[]', null, null, 'MA01') $q$, :'sid'), 'YA_DEVUELTO:0') as blusa_ya_devuelta;
select action, details->>'diferencia' from audit_log where action in ('devolucion','cambio_prendas') order by id;
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select t_expect_error(format($q$ select void_sale(%L, 'x') $q$, :'sid'), 'TIENE_DEVOLUCIONES') as anular_bloqueado;
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select find_sale_for_return('b001-000001')->>'id' = :'sid' as busca_minusculas, find_sale_for_return('B001-1')->>'id' = :'sid' as busca_corto, find_sale_for_return('B001-999') is null as no_existe_nulo;
select t_expect_error($q$ select find_sale_for_return('hola') $q$, 'NUMERO_INVALIDO') as invalido;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error($q$ select find_sale_for_return('B001-1') $q$, 'SIN_PERMISO') as vendedora_no_busca;
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select return_sale(:'sid', '[{"variantId":"v2","qty":1}]', 'sin codigo', 'Yape')->>'returnStatus' as admin_sin_codigo_ok_devuelto;
