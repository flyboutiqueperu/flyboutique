set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero');
update store_data set data = jsonb_set(data, '{products,0,variants,1,stock}', '50');
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select upsert_seller('MA01','María Alvarado','principal',true); select upsert_seller('LU01','Lucía Torres','principal',true);
select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}');
select t_expect_error($q$ select open_cash('principal', 100) $q$, 'VENDEDOR_INVALIDO') as abrir_sin_codigo;
select open_cash('principal', 100, 'caja-1', 'ma01')->>'opened_seller' as abrio;
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"sellerCode":"MA01","payments":[{"method":"Efectivo","amount":100}]}')->>'total' as v1;
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":2,"unitPrice":100}],"sellerCode":"LU01","payments":[{"method":"Yape","amount":150},{"method":"Efectivo","amount":50}]}')->>'total' as v2;
select pos_sale('{"items":[{"variantId":"v2","name":"V","qty":1,"unitPrice":100}],"sellerCode":"LU01","payments":[{"method":"Efectivo","amount":100}]}')->>'total' as v3;
select (current_cash('principal')->>'id') as sid \gset
select cash_move(:'sid', 'salida', 30, 'Taxi de envío', 'LU01');
select jsonb_pretty(current_cash('principal')->'bySeller') as quien_cobro_que;
select current_cash('principal')->>'expectedCash' as esperado_100_mas_250_menos_30_320, (current_cash('principal')->'movements'->0->>'seller') as salida_hecha_por;
select t_expect_error(format('select shift_change(%L, 320, %L, 400, %L, %L)', :'sid', '', 'MA01', 'LU01'), 'FONDO_MAYOR_QUE_CONTADO') as fondo_mayor;
select r->'closed'->>'status' as turno1, r->'closed'->>'closed_seller' as cerro, r->'opened'->>'opening_amount' as fondo_turno2, r->'opened'->>'opened_seller' as abrio_turno2
  from (select shift_change(:'sid', 320, '', 120, 'MA01', 'LU01') r) x;
select notes from cash_sessions where id = :'sid';
select (totals->'bySeller') ? 'LU01 · Lucía Torres' as informe_guarda_por_vendedora from cash_sessions where id = :'sid';
select current_cash('principal')->>'opening_amount' as caja_nueva_abierta_con_120, current_cash('principal')->>'salesCount' as ventas_0;
