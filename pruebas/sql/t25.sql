set client_min_messages = warning;
insert into staff_profiles (user_id, username, name, role) values
 ('44444444-4444-4444-4444-444444444444','alberto','Alberto','superadmin'),
 ('33333333-3333-3333-3333-333333333333','caja','Caja Larco','cajero'),
 ('55555555-5555-5555-5555-555555555555','alma','Almacén','almacen') on conflict do nothing;
-- Nubefact simulado (la base local no tiene la extensión http)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'http_header') then
    create type extensions.http_header as (field varchar, value varchar);
    create type extensions.http_request as (method text, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
  end if;
end $$;
create or replace function extensions.http_header(field varchar, value varchar) returns extensions.http_header language sql as $$ select row(field, value)::extensions.http_header $$;
create table if not exists t_nf (tipo int, serie text, numero int, anulado boolean default false, primary key (tipo, serie, numero));
create table if not exists t_nf_mode (mode text); delete from t_nf_mode; insert into t_nf_mode values ('ok');
create table if not exists t_nf_log (op text, auth text, body jsonb, at timestamptz default now());
create or replace function extensions.http(r extensions.http_request) returns table(status int, content text) language plpgsql as $$
declare b jsonb := r.content::jsonb; m text := (select mode from t_nf_mode limit 1); ok boolean;
begin
  insert into t_nf_log values (b->>'operacion', (r.headers[1]).value, b);
  if (r.headers[1]).value <> 'tok-ok' then return query select 401, '{"errors":"token invalido","codigo":10}'; return; end if;   -- solo acepta el token "a secas": prueba el segundo formato
  if m = 'caido' then raise exception 'timeout'; end if;
  if b->>'operacion' = 'generar_comprobante' then
    if m = 'rechaza' then return query select 400, '{"errors":"El campo cliente_denominacion es obligatorio","codigo":20}'; return; end if;
    if exists (select 1 from t_nf where tipo = (b->>'tipo_de_comprobante')::int and serie = b->>'serie' and numero = (b->>'numero')::int) then
      return query select 400, '{"errors":"Este documento ya existe en NubeFacT","codigo":23}'; return; end if;
    insert into t_nf values ((b->>'tipo_de_comprobante')::int, b->>'serie', (b->>'numero')::int);
    if m = 'corte-despues' then raise exception 'se cortó la conexión después de registrar'; end if;
    ok := (b->>'tipo_de_comprobante')::int = 1;   -- facturas: aceptadas al momento; boletas: van en resumen diario (pendiente)
    return query select 200, jsonb_build_object('tipo_de_comprobante', b->'tipo_de_comprobante', 'serie', b->'serie', 'numero', b->'numero',
      'enlace', 'https://nf.test/' || (b->>'serie') || '-' || (b->>'numero'), 'enlace_del_pdf', 'https://nf.test/' || (b->>'serie') || '-' || (b->>'numero') || '.pdf',
      'aceptada_por_sunat', ok, 'sunat_description', case when ok then 'La Factura numero ' || (b->>'serie') || '-' || (b->>'numero') || ', ha sido aceptada' end,
      'cadena_para_codigo_qr', '20600000001|0' || (b->>'tipo_de_comprobante') || '|' || (b->>'serie') || '|' || (b->>'numero'), 'codigo_hash', 'hash' || (b->>'numero'))::text;
  elsif b->>'operacion' = 'consultar_comprobante' then
    if exists (select 1 from t_nf where tipo = (b->>'tipo_de_comprobante')::int and serie = b->>'serie' and numero = (b->>'numero')::int) then
      return query select 200, jsonb_build_object('enlace', 'https://nf.test/' || (b->>'serie') || '-' || (b->>'numero'), 'enlace_del_pdf', 'https://nf.test/x.pdf', 'aceptada_por_sunat', true,
        'sunat_description', 'Aceptada', 'anulado', (select anulado from t_nf where tipo = (b->>'tipo_de_comprobante')::int and serie = b->>'serie' and numero = (b->>'numero')::int))::text;
    else return query select 400, '{"errors":"El documento no existe","codigo":24}'; end if;
  elsif b->>'operacion' = 'generar_anulacion' then
    return query select 200, '{"numero":1,"enlace":"https://nf.test/baja","sunat_ticket_numero":"123","aceptada_por_sunat":false}';
  elsif b->>'operacion' = 'consultar_anulacion' then
    update t_nf set anulado = true where tipo = (b->>'tipo_de_comprobante')::int and serie = b->>'serie' and numero = (b->>'numero')::int;
    return query select 200, '{"aceptada_por_sunat":true,"sunat_description":"Comunicacion de baja aceptada"}';
  end if;
  return query select 400, '{"errors":"operacion desconocida"}';
end $$;
-- Ventas de prueba
insert into sales (id, data) values
 ('v-boleta', '{"id":"v-boleta","tipo":"boleta","serie":"B001","numero":10,"customerName":"Lucía Torres","customerDoc":"45678912","customerDocType":"DNI","items":[{"name":"Blusa Seda","size":"M","colorName":"Negro","qty":2,"unitPrice":129,"variantId":"v1"},{"name":"Falda","qty":1,"unitPrice":99.9,"variantId":"v2"}],"subtotal":357.9,"discount":35.79,"total":322.11,"status":"emitido","createdAt":1760500000000}'),
 ('v-factura', '{"id":"v-factura","tipo":"factura","serie":"F001","numero":3,"customerName":"BANCO DE CREDITO DEL PERU","customerDoc":"20100047218","customerDocType":"RUC","customerAddress":"Calle Centenario 156","items":[{"name":"Vestido","qty":1,"unitPrice":219,"variantId":"v3"}],"subtotal":219,"discount":0,"total":234,"shipping":15,"status":"emitido","createdAt":1760500000000}'),
 ('v-anonima', '{"id":"v-anonima","tipo":"boleta","anonymous":true,"customerDoc":"00000000","items":[{"name":"Top","qty":1,"unitPrice":79,"variantId":"v4"}],"total":79,"status":"emitido"}'),
 ('v-grande', '{"id":"v-grande","tipo":"boleta","anonymous":true,"customerDoc":"00000000","items":[{"name":"Abrigo","qty":1,"unitPrice":750,"variantId":"v5"}],"total":750,"status":"emitido"}'),
 ('v-fact-sin-ruc', '{"id":"v-fact-sin-ruc","tipo":"factura","customerDoc":"45678912","items":[{"name":"Top","qty":1,"unitPrice":79,"variantId":"v4"}],"total":79,"status":"emitido"}'),
 ('v-web', '{"id":"v-web","tipo":"boleta","source":"web","paymentStatus":"pendiente","customerDoc":"45678912","items":[{"name":"Top","qty":1,"unitPrice":79}],"total":79,"status":"emitido"}'),
 ('v-corte', '{"id":"v-corte","tipo":"boleta","customerName":"Ana","customerDoc":"41234567","customerDocType":"DNI","items":[{"name":"Top","qty":1,"unitPrice":79}],"total":79,"status":"emitido"}');
\set ON_ERROR_STOP 1
\i supabase/25-facturacion-nubefact.sql
\set ON_ERROR_STOP 0
-- 1) Sin configurar: apagado
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select emit_einvoice('v-boleta')->>'reason' as sin_configurar, einvoice_status()->>'configured' as configurado_no;
select t_expect_error($q$ select set_einvoice_config('https://api.nubefact.com/api/v1/x', 'tok-ok') $q$, 'SIN_PERMISO') as cajero_no_configura;
-- 2) Super Admin configura (el token nunca vuelve)
select t_as('{"sub":"44444444-4444-4444-4444-444444444444","aal":"aal2"}');
select t_expect_error($q$ select set_einvoice_config('http://inseguro', 'tok-ok') $q$, 'RUTA_INVALIDA') as ruta_sin_https;
select t_expect_error($q$ select set_einvoice_config(null, null, 'X001') $q$, 'SERIE_INVALIDA') as serie_mala;
select set_einvoice_config('https://api.nubefact.com/api/v1/abc-123', 'tok-ok')::text not like '%tok-ok%' as token_no_se_devuelve;
select einvoice_status()->>'configured' as configurado_si, einvoice_status()->>'serieBoleta' as serie_b, einvoice_status()->>'nextBoleta' as siguiente_b;
-- 3) Cajero emite boleta con descuento: totales cuadran
select t_as('{"sub":"33333333-3333-3333-3333-333333333333","aal":"aal1"}');
select r->>'status' as boleta_estado, r->>'serie' || '-' || (r->>'numero') as boleta_numero, r->>'ok' as ok from (select emit_einvoice('v-boleta') r) x;
select (request->>'total')::numeric as total_322_11, (request->>'total_gravada')::numeric + (request->>'total_igv')::numeric = (request->>'total')::numeric as cuadra_gravada_mas_igv,
       (select sum((i->>'total')::numeric) from jsonb_array_elements(request->'items') i) = (request->>'total')::numeric as cuadran_items,
       request->>'cliente_tipo_de_documento' as tipo_doc_dni_1, request->>'fecha_de_emision' as fecha
  from einvoices where sale_id = 'v-boleta';
select count(*) as llamadas_con_formato_rechazado_solo_1 from t_nf_log where auth like 'Token token=%';
select data->'einvoice' as venta_marcada from sales where id = 'v-boleta';
-- 4) Repetir la emisión no duplica (devuelve el mismo)
select emit_einvoice('v-boleta')->>'numero' as mismo_numero, (select count(*) from t_nf where serie = 'B001') as en_nubefact_1;
-- 5) Factura con envío como servicio y RUC
select r->>'status' as factura_estado, r->>'serie' || '-' || (r->>'numero') as factura_numero from (select emit_einvoice('v-factura') r) x;
select jsonb_array_length(request->'items') as items_2, request->'items'->1->>'unidad_de_medida' as envio_zz, request->>'cliente_tipo_de_documento' as ruc_6 from einvoices where sale_id = 'v-factura';
-- 6) Boleta anónima menor a 700 (clientes varios) y mayor a 700 (no se permite)
select emit_einvoice('v-anonima')->>'status' as anonima_ok;
select request->>'cliente_denominacion' as varios, request->>'cliente_tipo_de_documento' as tipo_guion from einvoices where sale_id = 'v-anonima';
select t_expect_error($q$ select emit_einvoice('v-grande') $q$, 'BOLETA_700_SIN_DOCUMENTO') as grande_sin_dni, (select count(*) from einvoices where sale_id = 'v-grande') as no_gasta_numero;
select t_expect_error($q$ select emit_einvoice('v-fact-sin-ruc') $q$, 'FACTURA_SIN_RUC') as factura_sin_ruc;
select t_expect_error($q$ select emit_einvoice('v-web') $q$, 'PEDIDO_SIN_PAGO') as web_sin_pago;
-- 7) Corte DESPUÉS de que Nubefact lo registró: al reintentar se consulta y NO se duplica
update t_nf_mode set mode = 'corte-despues';
select emit_einvoice('v-corte')->>'status' as tras_corte_error;
update t_nf_mode set mode = 'ok';
select r->>'status' as reintento_estado, r->>'numero' as reintento_mismo_numero from (select emit_einvoice('v-corte') r) x;
select count(*) as veces_en_nubefact_1 from t_nf where serie = 'B001' and numero = (select numero from einvoices where sale_id = 'v-corte');
select count(*) filter (where op = 'generar_comprobante' and auth = 'tok-ok' and body->>'serie' = 'B001' and (body->>'numero')::int = (select numero from einvoices where sale_id = 'v-corte')) as generar_enviados_1 from t_nf_log;
-- 8) Rechazo por datos: no se marca aceptado; se reintenta con el mismo número
insert into sales (id, data) values ('v-rechazo', '{"id":"v-rechazo","tipo":"boleta","customerDoc":"41111111","customerDocType":"DNI","customerName":"X","items":[{"name":"Top","qty":1,"unitPrice":50}],"total":50,"status":"emitido"}');
update t_nf_mode set mode = 'rechaza';
select r->>'status' as rechazado, r->>'last_error' as motivo, r->>'numero' as num_reservado from (select emit_einvoice('v-rechazo') r) x;
update t_nf_mode set mode = 'ok';
select r->>'status' as tras_corregir, r->>'numero' as mismo_num from (select emit_einvoice('v-rechazo') r) x;
-- 9) Sin conexión: queda en error, nada aceptado
insert into sales (id, data) values ('v-caido', '{"id":"v-caido","tipo":"boleta","customerDoc":"42222222","customerDocType":"DNI","customerName":"Y","items":[{"name":"Top","qty":1,"unitPrice":50}],"total":50,"status":"emitido"}');
update t_nf_mode set mode = 'caido';
select r->>'status' as sin_conexion, left(r->>'last_error', 30) as error from (select emit_einvoice('v-caido') r) x;
update t_nf_mode set mode = 'ok';
-- 10) Refrescar boleta pendiente → aceptada
select refresh_einvoice('v-boleta')->>'status' as boleta_refrescada;
-- 11) Anular: cajero no; admin sí → pendiente → refrescar → anulado
select t_expect_error($q$ select void_einvoice('v-factura', 'error') $q$, 'SIN_PERMISO') as cajero_no_anula;
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select t_expect_error($q$ select void_einvoice('v-factura', '') $q$, 'MOTIVO_REQUERIDO') as sin_motivo;
select void_einvoice('v-factura', 'Datos del cliente equivocados')->>'status' as anulacion, refresh_einvoice('v-factura')->>'status' as tras_consultar;
-- 12) Almacén no emite; nadie lee la configuración secreta
select t_as('{"sub":"55555555-5555-5555-5555-555555555555","aal":"aal1"}');
select t_expect_error($q$ select emit_einvoice('v-anonima') $q$, 'SIN_PERMISO') as almacen_no;
set role authenticated;
select t_expect_error($q$ select * from app_secrets $q$, 'permission denied') as secretos_privados;
reset role;
-- 13) Se puede volver a correr el SQL
\set ON_ERROR_STOP 1
\i supabase/25-facturacion-nubefact.sql
select 'repetible' as ok;
