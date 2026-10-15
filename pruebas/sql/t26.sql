-- Correr DESPUÉS de t25.sql en la misma base (usa su Nubefact simulado y sus ventas)
set client_min_messages = warning;
\set ON_ERROR_STOP 1
\i supabase/26-notas-credito.sql
\set ON_ERROR_STOP 0
update t_nf_mode set mode = 'ok';
-- Devolución parcial de la boleta v-boleta (2 blusas a 129 con 10 % de descuento → vuelve 1 a 116.10)
update sales set data = data || '{"returns":[{"id":"dev-1","reason":"Talla equivocada","lines":[{"variantId":"v1","name":"Blusa Seda","size":"M","colorName":"Negro","qty":1,"unitPrice":116.1}],"newItems":[]}]}' where id = 'v-boleta';
select t_as('{"sub":"55555555-5555-5555-5555-555555555555","aal":"aal1"}');
select t_expect_error($q$ select emit_credit_note('v-boleta', 'dev-1') $q$, 'SIN_PERMISO') as almacen_no;
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select r->>'status' as nota_estado, r->>'serie' || '-' || (r->>'numero') as nota_numero, r->>'total' as total_116_10 from (select emit_credit_note('v-boleta', 'dev-1') r) x;
select request->>'tipo_de_nota_de_credito' as tipo_7_por_item, request->>'documento_que_se_modifica_serie' || '-' || (request->>'documento_que_se_modifica_numero') as modifica,
       request->>'cliente_numero_de_documento' as dni, (request->>'total_gravada')::numeric + (request->>'total_igv')::numeric = (request->>'total')::numeric as cuadra
  from einvoice_notes where sale_id = 'v-boleta';
select emit_credit_note('v-boleta', 'dev-1')->>'numero' as repetir_mismo_numero, (select count(*) from t_nf where tipo = 3) as notas_en_nubefact_1;
-- Devolución total de la factura (tipo 6) con corte después de registrar → reintento sin duplicar
update sales set data = data || '{"returns":[{"id":"dev-f","reason":"No le quedó","lines":[{"variantId":"v3","name":"Vestido","qty":1,"unitPrice":219}],"newItems":[]}]}' where id = 'v-factura';
update einvoices set status = 'aceptado' where sale_id = 'v-factura';
update t_nf_mode set mode = 'corte-despues';
select emit_credit_note('v-factura', 'dev-f')->>'status' as tras_corte;
update t_nf_mode set mode = 'ok';
select r->>'status' as reintento, r->>'serie' as serie_fc01 from (select emit_credit_note('v-factura', 'dev-f') r) x;
select request->>'tipo_de_nota_de_credito' as tipo_6_total from einvoice_notes where sale_id = 'v-factura';
select count(*) as nota_factura_en_nubefact_1 from t_nf where tipo = 3 and serie = 'FC01';
-- Venta sin comprobante electrónico: no se emite nota
update sales set data = data || '{"returns":[{"id":"dev-x","reason":"x","lines":[{"variantId":"v5","name":"Abrigo","qty":1,"unitPrice":750}]}]}' where id = 'v-grande';
select emit_credit_note('v-grande', 'dev-x')->>'reason' as sin_comprobante;
select t_expect_error($q$ select emit_credit_note('v-boleta', 'no-existe') $q$, 'DEVOLUCION_NO_EXISTE') as devolucion_inexistente;
-- Series: solo Super Admin, con B/F
select t_expect_error($q$ select set_credit_note_series('BC02', null) $q$, 'SIN_PERMISO') as cajero_no_cambia_series;
select t_as('{"sub":"44444444-4444-4444-4444-444444444444","aal":"aal2"}');
select t_expect_error($q$ select set_credit_note_series('XC01', null) $q$, 'SERIE_INVALIDA') as serie_mala, set_credit_note_series('BC02', null)->>'boleta' as serie_nueva;
\set ON_ERROR_STOP 1
\i supabase/26-notas-credito.sql
select 'repetible' as ok;
