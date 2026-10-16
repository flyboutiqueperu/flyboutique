-- Prueba 30: INVENTARIO de punta a punta (stock total, stock por sede y historial) en cada operación.
-- Uso: bash pruebas/sql/build.sh inv30 && psql -h /var/lib/flypgtest -p 5499 -U postgres -d inv30 -f pruebas/sql/t30-inventario.sql
-- Cada línea: OK / FALLA. Al final: TODO OK o HAY FALLAS. Las líneas INFO solo informan (no cuentan).
\set ON_ERROR_STOP 1
\pset tuples_only on
\set QUIET on
\pset format unaligned
set client_min_messages = warning;
create extension if not exists dblink;

-- ---------- Ayudantes ----------
create temp table res (n serial, ok boolean, name text);
create temp table kv (k text primary key, v jsonb);
create or replace function chk(name text, cond boolean) returns text language plpgsql as $$
begin insert into res (ok, name) values (coalesce(cond, false), name);
  return case when coalesce(cond, false) then 'OK     ' else 'FALLA  ' end || name; end $$;
create or replace function info(name text, val text) returns text language sql as $$ select 'INFO   ' || name || ': ' || coalesce(val, '(nulo)') $$;
-- Ejecuta una llamada; si falla devuelve {"error": "..."} (cada llamada es atómica, como una RPC real)
create or replace function run(q text) returns jsonb language plpgsql as $$
declare t text; begin
  execute 'select ' || q into t;
  if t is null then return 'null'::jsonb; end if;
  begin return t::jsonb; exception when others then return to_jsonb(t); end;
exception when others then return jsonb_build_object('error', sqlerrm); end $$;
create or replace function err(j jsonb, frag text) returns boolean language sql as $$ select coalesce(j->>'error', '') like '%' || frag || '%' $$;
create or replace function okr(j jsonb) returns boolean language sql as $$ select j is not null and not (jsonb_typeof(j) = 'object' and j ? 'error') $$;
create or replace function sv(k text, v jsonb) returns jsonb language sql as $$ insert into kv values (k, v) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function gv(k text) returns jsonb language sql as $$ select v from kv where kv.k = gv.k $$;
-- Identidades
create or replace function as_admin() returns void language sql as $$ select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}') $$;
create or replace function as_vend() returns void language sql as $$ select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}') $$;
create or replace function as_caja() returns void language sql as $$ select t_as('{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}') $$;
create or replace function as_alm() returns void language sql as $$ select t_as('{"sub":"88888888-8888-8888-8888-888888888888","aal":"aal1"}') $$;
create or replace function as_web() returns void language sql as $$ select t_as('{}') $$;
-- Stock
create or replace function vrow(v text) returns jsonb language sql as $$
  select x from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x where store_data.id = 'main' and x->>'id' = v limit 1 $$;
create or replace function st(v text) returns int language sql as $$ select (vrow(v)->>'stock')::int $$;
create or replace function sbl(v text, loc text) returns int language sql as $$ select coalesce((variant_stock_by(vrow(v))->>loc)::int, 0) $$;
create or replace function raw_sb(v text) returns jsonb language sql as $$ select vrow(v)->'stockBy' $$;
-- Invariante: nada negativo y suma por sede = total
create or replace function inv_ok() returns boolean language sql as $$
  select not exists (
    select 1 from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x
     where store_data.id = 'main' and (
       coalesce((x->>'stock')::int, 0) < 0
       or (jsonb_typeof(x->'stockBy') = 'object' and (
            (select coalesce(sum(value::int), 0) from jsonb_each_text(x->'stockBy')) <> coalesce((x->>'stock')::int, 0)
            or exists (select 1 from jsonb_each_text(x->'stockBy') e where e.value::int < 0))))) $$;
-- Historial: marca y lo que pasó desde la marca
create or replace function mk() returns void language sql as $$ select sv('m', to_jsonb(coalesce((select max(id) from stock_movements), 0))) $$;
create or replace function mvq(v text) returns int language sql as $$
  select coalesce(sum(qty), 0)::int from stock_movements where variant_id = v and id > (gv('m'))::bigint $$;
create or replace function mvn(v text) returns int language sql as $$
  select count(*)::int from stock_movements where variant_id = v and id > (gv('m'))::bigint $$;
create or replace function mvlast(v text) returns jsonb language sql as $$
  select to_jsonb(m) from stock_movements m where variant_id = v and id > (gv('m'))::bigint order by id desc limit 1 $$;
create or replace function mvall() returns int language sql as $$ select count(*)::int from stock_movements where id > (gv('m'))::bigint $$;
-- Libro mayor: para cada talla/color, stock actual - stock inicial = suma del historial
create or replace function ledger_ok() returns boolean language sql as $$
  select not exists (
    select 1 from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x
     where store_data.id = 'main' and x->>'id' <> 'v8'
       and coalesce((x->>'stock')::int, 0) - coalesce((select (b.v)::int from kv b where b.k = 'b0:' || (x->>'id')), 0)
           <> (select coalesce(sum(qty), 0) from stock_movements m where m.variant_id = x->>'id' and m.id > (gv('m0'))::bigint)) $$;
-- Ventas
create or replace function itm(v text, q int) returns jsonb language sql as $$
  select jsonb_build_object('variantId', x->>'id', 'productId', p->>'id', 'name', p->>'name', 'size', x->>'size', 'colorName', x->>'colorName',
                            'qty', q, 'unitPrice', (p->>'price')::numeric)
    from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x where store_data.id = 'main' and x->>'id' = v limit 1 $$;
create or replace function tot(items jsonb) returns numeric language sql as $$
  select coalesce(sum((i->>'unitPrice')::numeric * (i->>'qty')::int), 0) from jsonb_array_elements(items) i $$;
create or replace function pos_payload(items jsonb, crid text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('items', items, 'sellerCode', 'MA01', 'discount', 0, 'clientRequestId', crid,
                            'payments', jsonb_build_array(jsonb_build_object('method', 'Efectivo', 'amount', tot(items)))) || extra $$;
create or replace function sell(items jsonb, crid text, extra jsonb default '{}') returns jsonb language sql as $$
  select run(format('pos_sale(%L::jsonb)', pos_payload(items, crid, extra))) $$;
create or replace function web_payload(items jsonb, crid text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('items', items, 'clientRequestId', crid, 'deliveryMethod', 'recojo', 'customerName', 'Cliente Web',
                            'customerPhone', '51988777666', 'total', tot(items)) || extra $$;
create or replace function web(items jsonb, crid text, extra jsonb default '{}') returns jsonb language sql as $$
  select run(format('place_order(%L::jsonb, %L)', web_payload(items, crid, extra), 'ses-' || crid)) $$;
create or replace function sale(id text) returns jsonb language sql as $$ select data from sales where sales.id = sale.id $$;

-- ---------- Datos de prueba ----------
insert into staff_profiles (user_id, username, name, role) values
 ('77777777-7777-7777-7777-777777777777','larco','Caja Larco','cajero'),
 ('88888888-8888-8888-8888-888888888888','alm','Rosa Almacén','almacen');
-- p9: prenda solo para revisar sedes en prendas que aún no tienen stock por sede
update store_data set data = jsonb_set(data, '{products}', data->'products' ||
  '[{"id":"p9","name":"Polo Sedes","price":50,"variants":[{"id":"v9","size":"U","colorName":"Blanco","stock":2}]}]'::jsonb) where id = 'main';
select mk() \g /dev/null
select sv('m0', gv('m')) \g /dev/null
select sv('b0:' || (x->>'id'), x->'stock') from store_data, jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') x where store_data.id = 'main' \g /dev/null
select as_admin() \g /dev/null
select upsert_seller('MA01', 'María Alvarado', 'principal', true) \g /dev/null
select sv('sup', (upsert_supplier(null, 'Gamarra Textil', '20123456789', '999', 'Rosa', null)->'id')) \g /dev/null
select as_caja() \g /dev/null
select chk('0. caja de Larco abierta por la cajera', okr(run($$open_cash('principal', 100, 'caja-1', 'MA01')$$)));
select chk('0. estado inicial: v1=2 v2=5 v3=1 v9=2', st('v1') = 2 and st('v2') = 5 and st('v3') = 1 and st('v9') = 2);

\echo ''
\echo '== A. Entradas, salidas y conteos (move_stock) con sede =='
select as_admin() \g /dev/null
select mk() \g /dev/null
select chk('A1. conteo en Larco (5, esperado 5): total 5 y Larco=5', run($$move_stock('v2','ajuste',5,'conteo inicial',5,'principal')$$) = '5' and st('v2') = 5 and (raw_sb('v2')->>'principal')::int = 5);
select chk('A1. conteo sin cambio no deja historial', mvn('v2') = 0);
select mk() \g /dev/null
select chk('A2. entrada 5 en Almacén → total 10 (Larco 5, Almacén 5)', run($$move_stock('v2','entrada',5,'llegó',null,'almacen')$$) = '10' and sbl('v2','principal') = 5 and sbl('v2','almacen') = 5);
select chk('A2. historial: entrada +5, Almacén, quién (admin)', mvn('v2') = 1 and mvq('v2') = 5 and mvlast('v2')->>'type' = 'entrada' and mvlast('v2')->>'store_id' = 'almacen'
            and mvlast('v2')->>'user_id' = '11111111-1111-1111-1111-111111111111' and mvlast('v2')->>'staff_name' = 'Admin Uno'
            and (mvlast('v2')->>'stock_before')::int = 5 and (mvlast('v2')->>'stock_after')::int = 10);
select mk() \g /dev/null
select chk('A3. salida 2 de Almacén → 8 (Larco 5, Almacén 3)', run($$move_stock('v2','salida',2,'muestra',null,'almacen')$$) = '8' and sbl('v2','principal') = 5 and sbl('v2','almacen') = 3 and mvq('v2') = -2);
select chk('A4. salida 4 de Almacén (hay 3) → STOCK_INSUFICIENTE:3 y nada cambia', err(run($$move_stock('v2','salida',4,'x',null,'almacen')$$), 'STOCK_INSUFICIENTE:3') and st('v2') = 8 and sbl('v2','almacen') = 3);
select chk('A5. salida 9 sin sede (hay 8) → STOCK_INSUFICIENTE:8', err(run($$move_stock('v2','salida',9,'x')$$), 'STOCK_INSUFICIENTE:8') and st('v2') = 8);
select chk('A6. conteo Almacén con esperado viejo (2, hay 3) → STOCK_CAMBIO:3 y nada cambia', err(run($$move_stock('v2','ajuste',4,'conteo',2,'almacen')$$), 'STOCK_CAMBIO:3') and st('v2') = 8);
select mk() \g /dev/null
select chk('A7. conteo Almacén 4 (esperado 3) → total 9, Larco 5, Almacén 4, historial +1', run($$move_stock('v2','ajuste',4,'conteo',3,'almacen')$$) = '9'
            and sbl('v2','principal') = 5 and sbl('v2','almacen') = 4 and mvq('v2') = 1 and mvlast('v2')->>'type' = 'ajuste (conteo)');
select mk() \g /dev/null
select chk('A8. conteo total 7 (esperado 9) → sale de Larco primero: Larco 3, Almacén 4', run($$move_stock('v2','ajuste',7,'conteo',9)$$) = '7' and sbl('v2','principal') = 3 and sbl('v2','almacen') = 4 and mvq('v2') = -2);
select chk('A9. conteo total con esperado viejo → STOCK_CAMBIO:7', err(run($$move_stock('v2','ajuste',1,'conteo',9)$$), 'STOCK_CAMBIO:7') and st('v2') = 7);
select chk('A10. cantidad negativa → CANTIDAD_INVALIDA', err(run($$move_stock('v2','entrada',-3)$$), 'CANTIDAD_INVALIDA') and st('v2') = 7);
select chk('A10. tipo inventado → TIPO_INVALIDO', err(run($$move_stock('v2','robo',1)$$), 'TIPO_INVALIDO') and st('v2') = 7);
select chk('A10. sede inventada → UBICACION_INVALIDA', err(run($$move_stock('v2','entrada',1,null,null,'marte')$$), 'UBICACION_INVALIDA') and st('v2') = 7);
select chk('A10. prenda que no existe → PRODUCTO_NO_EXISTE', err(run($$move_stock('vX','entrada',1)$$), 'PRODUCTO_NO_EXISTE'));
select mk() \g /dev/null
select chk('A11. merma 1 sin sede → 6 (sale de Larco: 2, Almacén 4)', run($$move_stock('v2','merma',1,'manchada')$$) = '6' and sbl('v2','principal') = 2 and sbl('v2','almacen') = 4 and mvq('v2') = -1 and mvlast('v2')->>'type' = 'merma');
select chk('A12. entrada 4 en Larco → 10 (Larco 6, Almacén 4)', run($$move_stock('v2','entrada',4,null,null,'principal')$$) = '10' and sbl('v2','principal') = 6 and sbl('v2','almacen') = 4);
select mk() \g /dev/null
-- Prenda SIN stock por sede todavía (como casi todo el catálogo): la entrada en Almacén debe quedar en Almacén
select chk('A13. v9 sin sedes: entrada 3 en Almacén → total 5', run($$move_stock('v9','entrada',3,'llegó',null,'almacen')$$) = '5');
select chk('A13. v9: esas 3 quedan en Almacén (no en Larco)', sbl('v9','almacen') = 3 and sbl('v9','principal') = 2);
select info('A13. v9 stockBy guardado', coalesce(raw_sb('v9')::text, '(sin stockBy → todo cuenta como Larco)'));
select chk('A14. v9: se puede enviar 1 desde Almacén', okr(run($$create_transfer('almacen','principal','[{"variantId":"v9","qty":1}]','prueba')$$)));
select chk('A. invariante (nada negativo, suma por sede = total)', inv_ok());

\echo ''
\echo '== B. Venta en caja (pos_sale) =='
select as_caja() \g /dev/null
select mk() \g /dev/null
select sv('s1', sell(jsonb_build_array(itm('v2',1), itm('v1',1)), 'pos-1')) \g /dev/null
select chk('B1. venta v2×1 + v1×1 guardada', okr(gv('s1')) and gv('s1')->>'id' like 'sale_%');
select chk('B1. v2 10→9 y sale de Larco (Larco 5, Almacén 4); v1 2→1', st('v2') = 9 and sbl('v2','principal') = 5 and sbl('v2','almacen') = 4 and st('v1') = 1);
select chk('B1. historial v2: venta -1, quién cobró, vendedora MA01, sede Larco, venta y comprobante',
            mvn('v2') = 1 and mvq('v2') = -1 and mvlast('v2')->>'type' = 'venta' and mvlast('v2')->>'user_id' = '77777777-7777-7777-7777-777777777777'
            and mvlast('v2')->>'staff_name' = 'Caja Larco' and mvlast('v2')->>'seller' like 'MA01%' and mvlast('v2')->>'store_id' = 'principal'
            and mvlast('v2')->>'sale_id' = gv('s1')->>'id' and mvlast('v2')->>'doc' like 'B001-%' and (mvlast('v2')->>'unit_price')::numeric = 100);
select chk('B1. historial v1: venta -1', mvq('v1') = -1);
select chk('B2. reintento con el mismo clientRequestId → duplicate, no descuenta otra vez',
            sell(jsonb_build_array(itm('v2',1), itm('v1',1)), 'pos-1')->>'duplicate' = 'true' and st('v2') = 9 and st('v1') = 1
            and (select count(*) from sales where data->>'clientRequestId' = 'pos-1') = 1 and mvq('v2') = -1);
select sv('nB', to_jsonb((select count(*) from sales))) \g /dev/null
select chk('B3. vender 2 de v3 (hay 1) → SIN_STOCK y nada cambia', err(sell(jsonb_build_array(itm('v3',2)), 'pos-x1'), 'SIN_STOCK') and st('v3') = 1 and mvn('v3') = 0);
select mk() \g /dev/null
select chk('B4. dos líneas de la misma talla (v2 ×2 + ×2) → descuenta 4: 9→5', okr(sell(jsonb_build_array(itm('v2',2), itm('v2',2)), 'pos-2')) and st('v2') = 5 and mvq('v2') = -4);
select chk('B4. sale de Larco (Larco 1, Almacén 4)', sbl('v2','principal') = 1 and sbl('v2','almacen') = 4);
select chk('B5. dos líneas que juntas superan el stock (v2 3+3, hay 5) → SIN_STOCK, nada cambia', err(sell(jsonb_build_array(itm('v2',3), itm('v2',3)), 'pos-x2'), 'SIN_STOCK') and st('v2') = 5);
select chk('B6. una línea válida + otra sin stock → no descuenta ninguna', err(sell(jsonb_build_array(itm('v1',1), itm('v3',5)), 'pos-x3'), 'SIN_STOCK') and st('v1') = 1 and st('v3') = 1);
select chk('B7. precio cambiado → PRECIO_CAMBIO, nada cambia', err(sell(jsonb_build_array(itm('v1',1) || '{"unitPrice":1}'), 'pos-x4', '{"payments":[{"method":"Efectivo","amount":1}]}'), 'PRECIO_CAMBIO') and st('v1') = 1);
select chk('B8. código de vendedora falso → VENDEDOR_INVALIDO, nada cambia', err(sell(jsonb_build_array(itm('v1',1)), 'pos-x5', '{"sellerCode":"ZZ99"}'), 'VENDEDOR_INVALIDO') and st('v1') = 1);
select chk('B9. cantidad 0 → CANTIDAD_INVALIDA', err(sell(jsonb_build_array(itm('v1',0)), 'pos-x6'), 'CANTIDAD_INVALIDA') and st('v1') = 1);
select chk('B10. venta en sede sin caja abierta (Almacén) → CAJA_CERRADA', err(sell(jsonb_build_array(itm('v2',1)), 'pos-x7', '{"storeId":"almacen"}'), 'CAJA_CERRADA') and st('v2') = 5);
select chk('B11. pago incompleto → PAGO_INCOMPLETO, nada cambia', err(sell(jsonb_build_array(itm('v1',1)), 'pos-x8', '{"payments":[{"method":"Efectivo","amount":10}]}'), 'PAGO_INCOMPLETO') and st('v1') = 1);
select chk('B12. ninguna venta fallida quedó guardada', (select count(*) from sales) = (gv('nB'))::int + 1 and not exists (select 1 from sales where data->>'clientRequestId' like 'pos-x%'));
-- Venta desde Larco cuando Larco no alcanza pero el total sí (hay 1 en Larco y 4 en Almacén)
select mk() \g /dev/null
select sv('sLarco', sell(jsonb_build_array(itm('v2',2)), 'pos-larco')) \g /dev/null
select info('B13. caja de Larco vende 2 con solo 1 en Larco (resultado)', case when okr(gv('sLarco')) then 'SE PERMITIÓ (Larco ' || sbl('v2','principal') || ', Almacén ' || sbl('v2','almacen') || ')' else gv('sLarco')->>'error' end);
select chk('B13. igual el total y las sedes cuadran (3 = Larco + Almacén)', st('v2') = 3 and inv_ok());
-- Mismo pedido enviado dos veces A LA VEZ (doble toque con internet lento): dos conexiones
select as_admin() \g /dev/null
select run($$move_stock('v2','ajuste',5,'para carrera',3)$$) \g /dev/null
select dblink_connect('a', format('host=/var/lib/flypgtest port=5499 user=postgres dbname=%s', current_database())) \g /dev/null
select dblink_connect('b', format('host=/var/lib/flypgtest port=5499 user=postgres dbname=%s', current_database())) \g /dev/null
select 1 from dblink('a', $$select set_config('request.jwt.claims','{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}',false)$$) as t(x text) \g /dev/null
select 1 from dblink('b', $$select set_config('request.jwt.claims','{"sub":"77777777-7777-7777-7777-777777777777","aal":"aal1"}',false)$$) as t(x text) \g /dev/null
select sv('q', to_jsonb(format('select pos_sale(%L::jsonb)::text', pos_payload(jsonb_build_array(itm('v2',1)), 'pos-doble')))) \g /dev/null
select dblink_exec('a', 'begin') \g /dev/null
select 1 from dblink('a', gv('q')#>>'{}') as t(r text) \g /dev/null
select dblink_send_query('b', gv('q')#>>'{}') \g /dev/null
select pg_sleep(0.5) \g /dev/null
select dblink_exec('a', 'commit') \g /dev/null
select sv('rb', coalesce((select to_jsonb(r) from dblink_get_result('b', false) as t(r text)), 'null')) \g /dev/null
select 1 from dblink_get_result('b', false) as t(r text) \g /dev/null
select sv('rbe', to_jsonb(dblink_error_message('b'))) \g /dev/null
select info('B14. segunda llamada simultánea respondió', split_part(coalesce(nullif(gv('rbe')#>>'{}', 'OK'), gv('rb')#>>'{}'), E'\n', 1));
select chk('B14. doble envío simultáneo: una sola venta y stock descontado una sola vez (5→4)',
            (select count(*) from sales where data->>'clientRequestId' = 'pos-doble') = 1 and st('v2') = 4);
select chk('B. invariante', inv_ok());

\echo ''
\echo '== C. Anular venta (void_sale) =='
select sv('v2c', to_jsonb(st('v2'))) \g /dev/null
select sv('v1c', to_jsonb(st('v1'))) \g /dev/null
select sv('v2cp', to_jsonb(sbl('v2','principal'))) \g /dev/null
select as_vend() \g /dev/null
select chk('C1. vendedora no anula → SIN_PERMISO', err(run(format('void_sale(%L, %L)', gv('s1')->>'id', 'x')), 'SIN_PERMISO') and st('v2') = (gv('v2c'))::int);
select as_caja() \g /dev/null
select chk('C1. cajera no anula → SIN_PERMISO', err(run(format('void_sale(%L, %L)', gv('s1')->>'id', 'x')), 'SIN_PERMISO') and st('v2') = (gv('v2c'))::int);
select as_admin() \g /dev/null
select mk() \g /dev/null
select chk('C2. sin motivo → MOTIVO_REQUERIDO', err(run(format('void_sale(%L, %L)', gv('s1')->>'id', '')), 'MOTIVO_REQUERIDO') and st('v2') = (gv('v2c'))::int);
select chk('C3. admin anula B1 → v2 +1 y v1 +1', okr(run(format('void_sale(%L, %L)', gv('s1')->>'id', 'error de cobro')))
            and st('v2') = (gv('v2c'))::int + 1 and st('v1') = (gv('v1c'))::int + 1 and sale(gv('s1')->>'id')->>'status' = 'anulado');
select chk('C3. historial: +1 en v2 y v1, anulación, sede Larco, quién (admin)', mvq('v2') = 1 and mvq('v1') = 1 and mvlast('v2')->>'type' = 'anulación / devolución'
            and mvlast('v2')->>'store_id' = 'principal' and mvlast('v2')->>'user_id' = '11111111-1111-1111-1111-111111111111');
select chk('C3. vuelve a Larco', sbl('v2','principal') = (gv('v2cp'))::int + 1);
select chk('C4. anular otra vez no devuelve stock de nuevo', okr(run(format('void_sale(%L, %L)', gv('s1')->>'id', 'otra vez'))) and st('v2') = (gv('v2c'))::int + 1 and st('v1') = (gv('v1c'))::int + 1 and mvn('v2') = 1);
select chk('C5. reintentar la venta anulada (mismo clientRequestId) no descuenta', (select (sell(jsonb_build_array(itm('v2',1), itm('v1',1)), 'pos-1')->>'duplicate')) = 'true' and st('v2') = (gv('v2c'))::int + 1);
select chk('C. invariante', inv_ok());

\echo ''
\echo '== D. Devoluciones y cambios (return_sale) =='
select as_caja() \g /dev/null
select sv('v2d', to_jsonb(st('v2'))) \g /dev/null
select sv('v3d', to_jsonb(st('v3'))) \g /dev/null
select sv('v1d', to_jsonb(st('v1'))) \g /dev/null
select sv('s2', sell(jsonb_build_array(itm('v2',2), itm('v3',1)), 'pos-3')) \g /dev/null
select chk('D0. venta v2×2 + v3×1', okr(gv('s2')) and st('v2') = (gv('v2d'))::int - 2 and st('v3') = (gv('v3d'))::int - 1);
select sv('v2d', to_jsonb(st('v2'))) \g /dev/null
select sv('v3d', to_jsonb(st('v3'))) \g /dev/null
select mk() \g /dev/null
select chk('D1. devuelve 1 de v2 (efectivo) → v2 +1', okr(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'No le quedó', 'Efectivo', '[]', null, 'r-1', 'MA01')$q$, gv('s2')->>'id')))
            and st('v2') = (gv('v2d'))::int + 1);
select chk('D1. historial: +1, devolución, cajera, sede Larco', mvq('v2') = 1 and mvlast('v2')->>'type' = 'anulación / devolución'
            and mvlast('v2')->>'user_id' = '77777777-7777-7777-7777-777777777777' and mvlast('v2')->>'store_id' = 'principal');
select chk('D2. reintento (mismo código r-1) → duplicate, no suma otra vez', run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'No le quedó', 'Efectivo', '[]', null, 'r-1', 'MA01')$q$, gv('s2')->>'id'))->>'duplicate' = 'true'
            and st('v2') = (gv('v2d'))::int + 1 and mvn('v2') = 1);
select chk('D3. devolver 2 más (queda 1) → YA_DEVUELTO:1, nada cambia', err(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":2}]', 'x', 'Efectivo', '[]', null, null, 'MA01')$q$, gv('s2')->>'id')), 'YA_DEVUELTO:1') and st('v2') = (gv('v2d'))::int + 1);
select chk('D4. prenda que no está en la venta → NO_ESTA_EN_LA_VENTA', err(run(format($q$return_sale(%L, '[{"variantId":"v1","qty":1}]', 'x', 'Efectivo', '[]', null, null, 'MA01')$q$, gv('s2')->>'id')), 'NO_ESTA_EN_LA_VENTA'));
select chk('D5. cambio cuya prenda nueva no tiene stock → SIN_STOCK y la devolución tampoco se guarda',
            err(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'cambio', 'Yape', '[{"variantId":"v1","qty":99}]', null, 'r-x', 'MA01')$q$, gv('s2')->>'id')), 'SIN_STOCK')
            and st('v2') = (gv('v2d'))::int + 1 and st('v1') = (gv('v1d'))::int and jsonb_array_length(sale(gv('s2')->>'id')->'returns') = 1);
select mk() \g /dev/null
select chk('D6. cambio: devuelve v3 y lleva v1 → v3 +1, v1 -1', okr(run(format($q$return_sale(%L, '[{"variantId":"v3","qty":1}]', 'Cambio de prenda', 'Yape', '[{"variantId":"v1","qty":1}]', null, 'r-2', 'MA01')$q$, gv('s2')->>'id')))
            and st('v3') = (gv('v3d'))::int + 1 and st('v1') = (gv('v1d'))::int - 1);
select chk('D6. historial: v3 +1 (devolución) y v1 -1 (venta)', mvq('v3') = 1 and mvq('v1') = -1 and mvlast('v1')->>'type' = 'venta');
select mk() \g /dev/null
select sv('v2a', to_jsonb(sbl('v2','almacen'))) \g /dev/null
select chk('D7. devuelve el último v2 a Almacén → v2 +1 en Almacén', okr(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'Va al almacén', 'Yape', '[]', 'almacen', 'r-3', 'MA01')$q$, gv('s2')->>'id')))
            and st('v2') = (gv('v2d'))::int + 2 and sbl('v2','almacen') = (gv('v2a'))::int + 1 and mvlast('v2')->>'store_id' = 'almacen');
select chk('D8. todo v2 ya devuelto → YA_DEVUELTO:0', err(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'x', 'Yape', '[]', null, null, 'MA01')$q$, gv('s2')->>'id')), 'YA_DEVUELTO:0'));
select as_admin() \g /dev/null
select chk('D9. anular una venta con devoluciones → TIENE_DEVOLUCIONES (no devuelve dos veces)', err(run(format('void_sale(%L, %L)', gv('s2')->>'id', 'x')), 'TIENE_DEVOLUCIONES') and st('v2') = (gv('v2d'))::int + 2);
select as_vend() \g /dev/null
select chk('D10. vendedora no hace devoluciones → SIN_PERMISO', err(run(format($q$return_sale(%L, '[{"variantId":"v3","qty":1}]', 'x')$q$, gv('s2')->>'id')), 'SIN_PERMISO'));
select as_caja() \g /dev/null
select chk('D11. devolución de una venta anulada → VENTA_ANULADA', err(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'x', 'Yape')$q$, gv('s1')->>'id')), 'VENTA_ANULADA'));
-- Prenda sin sedes (v9) vendida en Larco y devuelta a Almacén
select as_admin() \g /dev/null
select run($$move_stock('v9','ajuste',4,'base',null)$$) \g /dev/null
select as_caja() \g /dev/null
select sv('s9', sell(jsonb_build_array(itm('v9',1)), 'pos-9')) \g /dev/null
select sv('v9a', to_jsonb(sbl('v9','almacen'))) \g /dev/null
select chk('D12. v9: devolver 1 a Almacén → total +1', okr(run(format($q$return_sale(%L, '[{"variantId":"v9","qty":1}]', 'al almacén', 'Yape', '[]', 'almacen', 'r-9', 'MA01')$q$, gv('s9')->>'id'))) and st('v9') = 4);
select chk('D12. v9: esa unidad queda en Almacén', sbl('v9','almacen') = (gv('v9a'))::int + 1);
select chk('D. invariante', inv_ok());

\echo ''
\echo '== E. Pedidos web (place_order): se aparta al pedir, el pago no descuenta otra vez =='
select as_web() \g /dev/null
select mk() \g /dev/null
select sv('v2e', to_jsonb(st('v2'))) \g /dev/null
select sv('v2pe', to_jsonb(sbl('v2','principal'))) \g /dev/null
select sv('w1', web(jsonb_build_array(itm('v2',1)), 'web-1')) \g /dev/null
select chk('E1. pedido web v2×1 → descuenta al pedir (stockReserved, pago pendiente)', okr(gv('w1')) and st('v2') = (gv('v2e'))::int - 1
            and gv('w1')->>'stockReserved' = 'true' and gv('w1')->>'paymentStatus' = 'pendiente_validacion');
select chk('E1. historial: pedido web -1, canal online; sale de Larco', mvq('v2') = -1 and mvlast('v2')->>'type' = 'pedido web' and mvlast('v2')->>'channel' = 'online'
            and sbl('v2','principal') = (gv('v2pe'))::int - 1);
select chk('E2. reintento del mismo pedido → duplicate, no descuenta', web(jsonb_build_array(itm('v2',1)), 'web-1')->>'duplicate' = 'true' and st('v2') = (gv('v2e'))::int - 1 and mvn('v2') = 1);
select chk('E3. total manipulado → TOTAL_CAMBIO, nada cambia', err(web(jsonb_build_array(itm('v2',1)), 'web-x1', '{"total":1}'), 'TOTAL_CAMBIO') and st('v2') = (gv('v2e'))::int - 1);
select chk('E3. precio manipulado → PRECIO_CAMBIO, nada cambia', err(web(jsonb_build_array(itm('v2',1) || '{"unitPrice":1}'), 'web-x2'), 'PRECIO_CAMBIO') and st('v2') = (gv('v2e'))::int - 1);
select chk('E3. más de lo que hay → SIN_STOCK', err(web(jsonb_build_array(itm('v2',40)), 'web-x3'), 'SIN_STOCK') and st('v2') = (gv('v2e'))::int - 1);
select as_vend() \g /dev/null
select chk('E4. vendedora no valida pagos → SIN_PERMISO', err(run(format('validate_online_payment(%L)', gv('w1')->>'id')), 'SIN_PERMISO'));
select as_admin() \g /dev/null
select mk() \g /dev/null
select chk('E4. validar pago → confirmado y NO descuenta otra vez', run(format('validate_online_payment(%L)', gv('w1')->>'id'))->>'paymentStatus' = 'confirmado' and st('v2') = (gv('v2e'))::int - 1 and mvn('v2') = 0);
select chk('E5. validar otra vez → igual, sin cambios', okr(run(format('validate_online_payment(%L)', gv('w1')->>'id'))) and st('v2') = (gv('v2e'))::int - 1 and mvn('v2') = 0);
select as_vend() \g /dev/null
select chk('E6. cancelar un pedido YA pagado → SOLO_PEDIDOS_SIN_PAGO', err(run(format('cancel_unpaid_order(%L, %L)', gv('w1')->>'id', 'x')), 'SOLO_PEDIDOS_SIN_PAGO') and st('v2') = (gv('v2e'))::int - 1);
select as_admin() \g /dev/null
select chk('E7. anular el pedido pagado → vuelve 1 (una sola vez)', okr(run(format('void_sale(%L, %L)', gv('w1')->>'id', 'devolvió todo'))) and st('v2') = (gv('v2e'))::int and mvq('v2') = 1);
select chk('E7. anular otra vez → no suma', okr(run(format('void_sale(%L, %L)', gv('w1')->>'id', 'otra'))) and st('v2') = (gv('v2e'))::int and mvq('v2') = 1);
-- Pedido sin pago cancelado por la tienda
select as_web() \g /dev/null
select mk() \g /dev/null
select sv('w2', web(jsonb_build_array(itm('v2',2)), 'web-2')) \g /dev/null
select chk('E8. pedido web v2×2 → -2', okr(gv('w2')) and st('v2') = (gv('v2e'))::int - 2);
select as_vend() \g /dev/null
select chk('E9. vendedora cancela el pedido sin pago → vuelven 2', okr(run(format('cancel_unpaid_order(%L, %L)', gv('w2')->>'id', 'no pagó'))) and st('v2') = (gv('v2e'))::int and mvq('v2') = 0 and mvn('v2') = 2);
select chk('E9. historial: pedido cancelado +2', mvlast('v2')->>'type' = 'pedido cancelado' and (mvlast('v2')->>'qty')::int = 2);
select chk('E10. cancelar otra vez → no suma de nuevo', (run(format('cancel_unpaid_order(%L, %L)', gv('w2')->>'id', 'otra'))) is not null and st('v2') = (gv('v2e'))::int and mvn('v2') = 2);
select as_admin() \g /dev/null
select chk('E11. validar pago de un pedido anulado → PEDIDO_ANULADO, no descuenta', err(run(format('validate_online_payment(%L)', gv('w2')->>'id')), 'PEDIDO_ANULADO') and st('v2') = (gv('v2e'))::int);
select as_caja() \g /dev/null
select as_web() \g /dev/null
select chk('E12. pedido web-3 (sin pago)', okr(sv('w3', web(jsonb_build_array(itm('v2',1)), 'web-3'))));
select as_caja() \g /dev/null
select chk('E12. devolución de un pedido sin pago → PEDIDO_SIN_PAGO', err(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'x', 'Yape')$q$, gv('w3')->>'id')), 'PEDIDO_SIN_PAGO'));
-- Vencimiento automático (24 h por defecto)
select mk() \g /dev/null
update sales set created_at = now() - interval '25 hours' where id = gv('w3')->>'id';
select as_web() \g /dev/null
select chk('E13. pedido sin pago vencido → se anula solo y vuelve 1', run('expire_unpaid_orders()') = '1' and st('v2') = (gv('v2e'))::int and mvq('v2') = 1 and sale(gv('w3')->>'id')->>'status' = 'anulado');
select chk('E14. correr el vencimiento otra vez → 0 y no suma', run('expire_unpaid_orders()') = '0' and st('v2') = (gv('v2e'))::int and mvq('v2') = 1);
-- Pedido pagado viejo NO se vence
select sv('w4', web(jsonb_build_array(itm('v2',1)), 'web-4')) \g /dev/null
select as_admin() \g /dev/null
select run(format('validate_online_payment(%L)', gv('w4')->>'id')) \g /dev/null
update sales set created_at = now() - interval '30 hours' where id = gv('w4')->>'id';
select as_web() \g /dev/null
select chk('E15. pedido pagado y viejo no se vence (stock sigue descontado)', run('expire_unpaid_orders()') = '0' and st('v2') = (gv('v2e'))::int - 1 and sale(gv('w4')->>'id')->>'status' <> 'anulado');
select as_caja() \g /dev/null
select chk('E16. devolución de un pedido web pagado → vuelve 1 a Larco', okr(run(format($q$return_sale(%L, '[{"variantId":"v2","qty":1}]', 'no le quedó', 'Yape')$q$, gv('w4')->>'id'))) and st('v2') = (gv('v2e'))::int);
-- Pedido web que sale del Almacén (Larco vacío) y se cancela: debe volver al Almacén
select as_admin() \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s,%L)', 'v2', 'ajuste', 0, 'base E17', sbl('v2','principal'), 'principal')) \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s,%L)', 'v2', 'ajuste', 2, 'base E17', sbl('v2','almacen'), 'almacen')) \g /dev/null
select as_web() \g /dev/null
select sv('w5', web(jsonb_build_array(itm('v2',1)), 'web-5')) \g /dev/null
select chk('E17. Larco 0, Almacén 2: el pedido web aparta 1 del Almacén', okr(gv('w5')) and st('v2') = 1 and sbl('v2','principal') = 0 and sbl('v2','almacen') = 1);
select as_vend() \g /dev/null
select run(format('cancel_unpaid_order(%L, %L)', gv('w5')->>'id', 'no pagó')) \g /dev/null
select chk('E17. al cancelarlo, la unidad vuelve al Almacén (de donde salió), no a Larco', st('v2') = 2 and sbl('v2','almacen') = 2 and sbl('v2','principal') = 0);
select info('E17. sedes después de cancelar', raw_sb('v2')::text);
-- Carrera: Administración valida el pago (conexión a) mientras la tienda cancela el mismo pedido (conexión b)
select as_admin() \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s)', 'v2', 'ajuste', 5, 'base E18', st('v2'))) \g /dev/null
select as_web() \g /dev/null
select sv('w6', web(jsonb_build_array(itm('v2',1)), 'web-6')) \g /dev/null
select 1 from dblink('a', $$select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}',false)$$) as t(x text) \g /dev/null
select 1 from dblink('b', $$select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}',false)$$) as t(x text) \g /dev/null
select dblink_exec('a', 'begin') \g /dev/null
select 1 from dblink('a', format('select validate_online_payment(%L)::text', gv('w6')->>'id')) as t(r text) \g /dev/null
select dblink_send_query('b', format('select cancel_unpaid_order(%L, %L)::text', gv('w6')->>'id', 'no pagó')) \g /dev/null
select pg_sleep(0.5) \g /dev/null
select dblink_exec('a', 'commit') \g /dev/null
select sv('rb', coalesce((select to_jsonb(r) from dblink_get_result('b', false) as t(r text)), 'null')) \g /dev/null
select 1 from dblink_get_result('b', false) as t(r text) \g /dev/null
select sv('rbe', to_jsonb(dblink_error_message('b'))) \g /dev/null
select info('E18. cancelar mientras se valida el pago respondió', split_part(coalesce(nullif(gv('rbe')#>>'{}', 'OK'), 'respuesta: estado ' || ((gv('rb')#>>'{}')::jsonb->>'status')), E'\n', 1));
select chk('E18. pedido pagado a la vez que se cancela: queda pagado y NO anulado, stock sigue apartado (4)',
            sale(gv('w6')->>'id')->>'paymentStatus' = 'confirmado' and sale(gv('w6')->>'id')->>'status' <> 'anulado' and st('v2') = 4);
-- Carrera: validar el pago (a) mientras corre el vencimiento automático (b)
select as_web() \g /dev/null
select sv('w7', web(jsonb_build_array(itm('v2',1)), 'web-7')) \g /dev/null
update sales set created_at = now() - interval '25 hours' where id = gv('w7')->>'id' \g /dev/null
select 1 from dblink('b', $$select set_config('request.jwt.claims','{}',false)$$) as t(x text) \g /dev/null
select dblink_exec('a', 'begin') \g /dev/null
select 1 from dblink('a', format('select validate_online_payment(%L)::text', gv('w7')->>'id')) as t(r text) \g /dev/null
select dblink_send_query('b', 'select expire_unpaid_orders()::text') \g /dev/null
select pg_sleep(0.5) \g /dev/null
select dblink_exec('a', 'commit') \g /dev/null
select sv('rb', coalesce((select to_jsonb(r) from dblink_get_result('b', false) as t(r text)), 'null')) \g /dev/null
select 1 from dblink_get_result('b', false) as t(r text) \g /dev/null
select info('E19. vencimiento automático anuló', coalesce(gv('rb')#>>'{}', '?') || ' pedido(s)');
select chk('E19. pedido pagado mientras corría el vencimiento: queda pagado y NO anulado, stock apartado (3)',
            sale(gv('w7')->>'id')->>'paymentStatus' = 'confirmado' and sale(gv('w7')->>'id')->>'status' <> 'anulado' and st('v2') = 3);
select chk('E. invariante', inv_ok());

\echo ''
\echo '== F. La última unidad: dos compran a la vez =='
select as_admin() \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s)', 'v3', 'ajuste', 1, 'última', st('v3'))) \g /dev/null
select chk('F0. v3 = 1', st('v3') = 1);
select as_web() \g /dev/null
select sv('f1', web(jsonb_build_array(itm('v3',1)), 'web-f1')) \g /dev/null
select chk('F1. primer pedido web se lleva la última → 0', okr(gv('f1')) and st('v3') = 0);
select chk('F2. segundo pedido web → SIN_STOCK', err(web(jsonb_build_array(itm('v3',1)), 'web-f2'), 'SIN_STOCK') and st('v3') = 0);
select as_caja() \g /dev/null
select chk('F3. la caja tampoco la vende → SIN_STOCK', err(sell(jsonb_build_array(itm('v3',1)), 'pos-f3'), 'SIN_STOCK') and st('v3') = 0);
select as_vend() \g /dev/null
select run(format('cancel_unpaid_order(%L, %L)', gv('f1')->>'id', 'no pagó')) \g /dev/null
select chk('F4. al cancelar el pedido vuelve a 1', st('v3') = 1);
select as_caja() \g /dev/null
select chk('F5. la caja la vende → 0', okr(sell(jsonb_build_array(itm('v3',1)), 'pos-f5')) and st('v3') = 0);
select as_web() \g /dev/null
select chk('F6. la web ya no puede → SIN_STOCK', err(web(jsonb_build_array(itm('v3',1)), 'web-f6'), 'SIN_STOCK') and st('v3') = 0);
-- A la vez de verdad: caja (conexión a) y web (conexión b)
select as_admin() \g /dev/null
select run($$move_stock('v3','ajuste',1,'carrera',0)$$) \g /dev/null
select 1 from dblink('b', $$select set_config('request.jwt.claims','{}',false)$$) as t(x text) \g /dev/null
select dblink_exec('a', 'begin') \g /dev/null
select 1 from dblink('a', format('select pos_sale(%L::jsonb)::text', pos_payload(jsonb_build_array(itm('v3',1)), 'pos-race'))) as t(r text) \g /dev/null
select dblink_send_query('b', format('select place_order(%L::jsonb, %L)::text', web_payload(jsonb_build_array(itm('v3',1)), 'web-race'), 'ses-race')) \g /dev/null
select pg_sleep(0.5) \g /dev/null
select dblink_exec('a', 'commit') \g /dev/null
select sv('rb', coalesce((select to_jsonb(r) from dblink_get_result('b', false) as t(r text)), 'null')) \g /dev/null
select 1 from dblink_get_result('b', false) as t(r text) \g /dev/null
select sv('rbe', to_jsonb(dblink_error_message('b'))) \g /dev/null
select chk('F7. a la vez: la caja gana, la web recibe SIN_STOCK, stock 0 (no -1)', gv('rbe')#>>'{}' like '%SIN_STOCK%' and st('v3') = 0
            and not exists (select 1 from sales where data->>'clientRequestId' = 'web-race'));
-- A la vez: web (a) y web (b)
select as_admin() \g /dev/null
select run($$move_stock('v3','ajuste',1,'carrera 2',0)$$) \g /dev/null
select 1 from dblink('a', $$select set_config('request.jwt.claims','{}',false)$$) as t(x text) \g /dev/null
select dblink_exec('a', 'begin') \g /dev/null
select 1 from dblink('a', format('select place_order(%L::jsonb, %L)::text', web_payload(jsonb_build_array(itm('v3',1)), 'web-race-a'), 'ses-ra')) as t(r text) \g /dev/null
select dblink_send_query('b', format('select place_order(%L::jsonb, %L)::text', web_payload(jsonb_build_array(itm('v3',1)), 'web-race-b'), 'ses-rb')) \g /dev/null
select pg_sleep(0.5) \g /dev/null
select dblink_exec('a', 'commit') \g /dev/null
select sv('rb', coalesce((select to_jsonb(r) from dblink_get_result('b', false) as t(r text)), 'null')) \g /dev/null
select 1 from dblink_get_result('b', false) as t(r text) \g /dev/null
select sv('rbe', to_jsonb(dblink_error_message('b'))) \g /dev/null
select chk('F8. dos pedidos web a la vez por la última: uno gana, el otro SIN_STOCK, stock 0', gv('rbe')#>>'{}' like '%SIN_STOCK%' and st('v3') = 0
            and (select count(*) from sales where data->>'clientRequestId' in ('web-race-a','web-race-b')) = 1);
select chk('F. invariante', inv_ok());

\echo ''
\echo '== G. Guías de traslado (en camino no se vende; total igual al recibir) =='
select as_admin() \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s,%L)', 'v2', 'ajuste', 6, 'base G', sbl('v2','principal'), 'principal')) \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s,%L)', 'v2', 'ajuste', 4, 'base G', sbl('v2','almacen'), 'almacen')) \g /dev/null
select chk('G0. v2 = 10 (Larco 6, Almacén 4)', st('v2') = 10 and sbl('v2','principal') = 6 and sbl('v2','almacen') = 4);
select mk() \g /dev/null
select sv('t1', run($$create_transfer('principal','almacen','[{"variantId":"v2","qty":2}]','reponer')$$)) \g /dev/null
select chk('G1. enviar 2 Larco→Almacén: total 8 (2 en camino), Larco 4, Almacén 4', okr(gv('t1')) and st('v2') = 8 and sbl('v2','principal') = 4 and sbl('v2','almacen') = 4);
select chk('G1. historial: traslado enviado -2 desde Larco', mvq('v2') = -2 and mvlast('v2')->>'type' = 'traslado enviado' and mvlast('v2')->>'store_id' = 'principal' and mvlast('v2')->>'doc' = gv('t1')->>'code');
select chk('G2. enviar más de lo que hay en la sede (5 de Larco, hay 4) → STOCK_INSUFICIENTE, nada cambia', err(run($$create_transfer('principal','almacen','[{"variantId":"v2","qty":5}]')$$), 'STOCK_INSUFICIENTE') and st('v2') = 8 and sbl('v2','principal') = 4);
select chk('G2. misma sede o sede inventada → UBICACION_INVALIDA', err(run($$create_transfer('principal','principal','[{"variantId":"v2","qty":1}]')$$), 'UBICACION_INVALIDA') and err(run($$create_transfer('principal','marte','[{"variantId":"v2","qty":1}]')$$), 'UBICACION_INVALIDA'));
select chk('G2. una línea buena y otra sin stock → no sale nada', err(run($$create_transfer('principal','almacen','[{"variantId":"v2","qty":1},{"variantId":"v3","qty":9}]')$$), 'STOCK_INSUFICIENTE') and st('v2') = 8);
select as_alm() \g /dev/null
select mk() \g /dev/null
select chk('G3. Almacén recibe todo → total 10 otra vez, Larco 4, Almacén 6', okr(run(format('receive_transfer(%s)', gv('t1')->>'id'))) and st('v2') = 10 and sbl('v2','principal') = 4 and sbl('v2','almacen') = 6);
select chk('G3. historial: traslado recibido +2 en Almacén, quién (almacén)', mvq('v2') = 2 and mvlast('v2')->>'type' = 'traslado recibido' and mvlast('v2')->>'store_id' = 'almacen'
            and mvlast('v2')->>'user_id' = '88888888-8888-8888-8888-888888888888');
select chk('G4. recibir otra vez → GUIA_YA_CERRADA, no suma', err(run(format('receive_transfer(%s)', gv('t1')->>'id')), 'GUIA_YA_CERRADA') and st('v2') = 10);
select sv('t2', run($$create_transfer('almacen','principal','[{"variantId":"v2","qty":3}]','a tienda')$$)) \g /dev/null
select chk('G5. Almacén envía 3 a Larco → total 7, Almacén 3', okr(gv('t2')) and st('v2') = 7 and sbl('v2','almacen') = 3);
select as_vend() \g /dev/null
select chk('G6. llegan 2 de 3 sin motivo → MOTIVO_FALTANTE, nada cambia', err(run(format($q$receive_transfer(%s, '{"v2":2}')$q$, gv('t2')->>'id')), 'MOTIVO_FALTANTE') and st('v2') = 7);
select chk('G7. vendedora de Larco recibe 2 de 3 con motivo → total 9, Larco 6 (falta 1)', okr(run(format($q$receive_transfer(%s, '{"v2":2}', 'llegó una menos')$q$, gv('t2')->>'id'))) and st('v2') = 9 and sbl('v2','principal') = 6 and sbl('v2','almacen') = 3);
select chk('G7. la guía guarda lo recibido (2)', (select (items->0->>'received')::int from stock_transfers where id = (gv('t2')->>'id')::bigint) = 2);
select chk('G8. vendedora no emite guías → SIN_PERMISO', err(run($$create_transfer('principal','almacen','[{"variantId":"v2","qty":1}]')$$), 'SIN_PERMISO') and st('v2') = 9);
select as_alm() \g /dev/null
select sv('t3', run($$create_transfer('almacen','principal','[{"variantId":"v2","qty":1}]')$$)) \g /dev/null
select chk('G9. envía 1 → total 8, Almacén 2', okr(gv('t3')) and st('v2') = 8 and sbl('v2','almacen') = 2);
select as_vend() \g /dev/null
select chk('G10. vendedora no anula guías → SIN_PERMISO', err(run(format('cancel_transfer(%s, %L)', gv('t3')->>'id', 'x')), 'SIN_PERMISO') and st('v2') = 8);
select as_alm() \g /dev/null
select chk('G11. anular sin motivo → MOTIVO_REQUERIDO', err(run(format('cancel_transfer(%s, %L)', gv('t3')->>'id', '')), 'MOTIVO_REQUERIDO'));
select chk('G12. anular la guía → vuelve a Almacén (total 9, Almacén 3)', okr(run(format('cancel_transfer(%s, %L)', gv('t3')->>'id', 'me equivoqué'))) and st('v2') = 9 and sbl('v2','almacen') = 3 and sbl('v2','principal') = 6);
select chk('G13. anular otra vez → GUIA_YA_CERRADA, no suma', err(run(format('cancel_transfer(%s, %L)', gv('t3')->>'id', 'x')), 'GUIA_YA_CERRADA') and st('v2') = 9);
select chk('G13. recibir una guía anulada → GUIA_YA_CERRADA, no suma', err(run(format('receive_transfer(%s)', gv('t3')->>'id')), 'GUIA_YA_CERRADA') and st('v2') = 9);
-- Las unidades en camino no se venden en ningún lado
select as_admin() \g /dev/null
select run(format('move_stock(%L,%L,%s,%L,%s)', 'v3', 'ajuste', 1, 'base', st('v3'))) \g /dev/null
select sv('t4', run($$create_transfer('principal','almacen','[{"variantId":"v3","qty":1}]')$$)) \g /dev/null
select chk('G14. v3 en camino: total 0', okr(gv('t4')) and st('v3') = 0);
select as_web() \g /dev/null
select chk('G14. la web no vende lo que está en camino → SIN_STOCK', err(web(jsonb_build_array(itm('v3',1)), 'web-g14'), 'SIN_STOCK'));
select as_caja() \g /dev/null
select chk('G14. la caja tampoco → SIN_STOCK', err(sell(jsonb_build_array(itm('v3',1)), 'pos-g14'), 'SIN_STOCK') and st('v3') = 0);
select as_alm() \g /dev/null
select run(format('receive_transfer(%s)', gv('t4')->>'id')) \g /dev/null
select chk('G15. al recibir: v3 = 1 en Almacén', st('v3') = 1 and sbl('v3','almacen') = 1 and sbl('v3','principal') = 0);
-- Prenda sin sedes (v1): la guía la ordena sola
select as_admin() \g /dev/null
select sv('v1g', to_jsonb(st('v1'))) \g /dev/null
select chk('G16. v1 sin sedes: enviar 1 Larco→Almacén y recibir → total igual, Almacén 1',
            okr(sv('t5', run($$create_transfer('principal','almacen','[{"variantId":"v1","qty":1}]')$$))) and okr(run(format('receive_transfer(%s)', gv('t5')->>'id')))
            and st('v1') = (gv('v1g'))::int and sbl('v1','almacen') = 1 and sbl('v1','principal') = (gv('v1g'))::int - 1);
select chk('G. invariante', inv_ok());

\echo ''
\echo '== H. Compras a proveedores =='
select as_admin() \g /dev/null
select mk() \g /dev/null
select sv('v1h', to_jsonb(st('v1'))) \g /dev/null
select sv('v1ha', to_jsonb(sbl('v1','almacen'))) \g /dev/null
select sv('c1', run(format($q$register_purchase(%s, 'F001-77', 'almacen', '[{"variantId":"v1","qty":3,"unitCost":40}]', 'ok', true, 'req-c1')$q$, gv('sup')))) \g /dev/null
select chk('H1. compra 3 de v1 en Almacén → total +3, Almacén +3', okr(gv('c1')) and st('v1') = (gv('v1h'))::int + 3 and sbl('v1','almacen') = (gv('v1ha'))::int + 3);
select chk('H1. historial: compra +3 en Almacén', mvq('v1') = 3 and mvlast('v1')->>'type' = 'compra' and mvlast('v1')->>'store_id' = 'almacen' and mvlast('v1')->>'doc' = gv('c1')->>'code');
select chk('H2. reintento (req-c1) → duplicate, no suma', run(format($q$register_purchase(%s, 'F001-77', 'almacen', '[{"variantId":"v1","qty":3,"unitCost":40}]', 'ok', true, 'req-c1')$q$, gv('sup')))->>'duplicate' = 'true'
            and st('v1') = (gv('v1h'))::int + 3 and mvn('v1') = 1);
select chk('H3. una línea buena y otra de prenda inexistente → nada entra', err(run(format($q$register_purchase(%s, '', 'almacen', '[{"variantId":"v1","qty":1,"unitCost":5},{"variantId":"vX","qty":1,"unitCost":5}]')$q$, gv('sup'))), 'PRODUCTO_NO_EXISTE') and st('v1') = (gv('v1h'))::int + 3);
select chk('H4. sede inventada → UBICACION_INVALIDA', err(run(format($q$register_purchase(%s, '', 'marte', '[{"variantId":"v1","qty":1,"unitCost":5}]')$q$, gv('sup'))), 'UBICACION_INVALIDA'));
select mk() \g /dev/null
select chk('H5. anular la compra → v1 vuelve, Almacén vuelve', run(format('void_purchase(%s, %L)', gv('c1')->>'id', 'error'))->>'status' = 'anulada' and st('v1') = (gv('v1h'))::int and sbl('v1','almacen') = (gv('v1ha'))::int);
select chk('H5. historial: compra anulada -3', mvq('v1') = -3 and mvlast('v1')->>'type' = 'compra anulada');
select chk('H6. anular otra vez → no resta de nuevo', okr(run(format('void_purchase(%s, %L)', gv('c1')->>'id', 'otra'))) and st('v1') = (gv('v1h'))::int and mvn('v1') = 1);
-- Compra que ya se vendió en parte: no se puede anular (dejaría negativo)
select sv('c2', run(format($q$register_purchase(%s, '', 'almacen', '[{"variantId":"v3","qty":2,"unitCost":30}]', null, false, 'req-c2')$q$, gv('sup')))) \g /dev/null
select run($$move_stock('v3','salida',3,'se vendió aparte',null,'almacen')$$) \g /dev/null
select sv('v3h', to_jsonb(st('v3'))) \g /dev/null
select chk('H7. anular una compra cuyas prendas ya salieron → STOCK_INSUFICIENTE, nada cambia', err(run(format('void_purchase(%s, %L)', gv('c2')->>'id', 'x')), 'STOCK_INSUFICIENTE') and st('v3') = (gv('v3h'))::int);
select as_vend() \g /dev/null
select chk('H8. vendedora no registra compras → SIN_PERMISO', err(run(format($q$register_purchase(%s, '', 'almacen', '[{"variantId":"v1","qty":1,"unitCost":5}]')$q$, gv('sup'))), 'SIN_PERMISO') and st('v1') = (gv('v1h'))::int);
select chk('H8. vendedora no anula compras → SIN_PERMISO', err(run(format('void_purchase(%s, %L)', gv('c2')->>'id', 'x')), 'SIN_PERMISO'));
select chk('H. invariante', inv_ok());

\echo ''
\echo '== I. Editor del catálogo (save_catalog) =='
select as_admin() \g /dev/null
-- La «pantalla» de quien edita: una copia vieja del catálogo
select sv('snap', (select data from store_data where id = 'main')) \g /dev/null
select as_caja() \g /dev/null
select chk('I0. mientras tanto la caja vende 1 de v2', okr(sell(jsonb_build_array(itm('v2',1)), 'pos-i0')));
select sv('v2i', to_jsonb(st('v2'))) \g /dev/null
select sv('v2isb', raw_sb('v2')) \g /dev/null
select sv('v1i', to_jsonb(st('v1'))) \g /dev/null
select as_admin() \g /dev/null
select mk() \g /dev/null
select chk('I1. guardar la copia vieja con nombre y precio nuevos en p1', run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1'], null, array['products'], 'renombrar')$q$,
            jsonb_set(jsonb_set(gv('snap'), '{products,0,name}', '"Vestido Nuevo"'), '{products,0,price}', '120')))::text = '""');
select chk('I1. nombre y precio cambiaron', (select data->'products'->0->>'name' from store_data) = 'Vestido Nuevo' and (select (data->'products'->0->>'price')::numeric from store_data) = 120);
select chk('I1. el stock de la venta NO se pisó (v2 igual, sedes iguales, sin historial)', st('v2') = (gv('v2i'))::int and raw_sb('v2') = gv('v2isb') and st('v1') = (gv('v1i'))::int and mvall() = 0);
select chk('I2. stock en la pantalla falsificado (v2=999) se ignora', okr(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1'], null, array['products'])$q$,
            jsonb_set((select data from store_data where id = 'main'), '{products,0,variants,1,stock}', '999')))) and st('v2') = (gv('v2i'))::int);
select chk('I2. stockBy falsificado en la pantalla se ignora', okr(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1'], null, array['products'])$q$,
            jsonb_set((select data from store_data where id = 'main'), '{products,0,variants,1,stockBy}', '{"principal":500,"almacen":500}')))) and raw_sb('v2') = gv('v2isb'));
select mk() \g /dev/null
select chk('I3. p_stock_deltas {v1:+2} (con copia vieja) → v1 +2', okr(run(format($q$save_catalog(%L::jsonb, '{"v1":2}'::jsonb, array['p1'], null, array['products'])$q$,
            jsonb_set(gv('snap'), '{products,0,name}', '"Vestido Nuevo"')))) and st('v1') = (gv('v1i'))::int + 2 and mvq('v1') = 2 and mvlast('v1')->>'type' = 'catálogo');
select chk('I3. la copia vieja no deshizo el precio... (es lo que la persona guardó: 100)', (select (data->'products'->0->>'price')::numeric from store_data) = 100);
select chk('I4. delta negativo mayor que el stock → queda en 0, nunca negativo', okr(run(format($q$save_catalog(%L::jsonb, '{"v9":-100}'::jsonb, array['p9'], null, array['products'])$q$,
            (select data from store_data where id = 'main')))) and st('v9') = 0 and inv_ok());
-- Otra persona crea p3 mientras yo tengo la copia vieja
select mk() \g /dev/null
select chk('I5. crear p3 con talla nueva v4 (stock 3)', okr(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p3'], null, array['products'])$q$,
            jsonb_set((select data from store_data where id = 'main'), '{products}', (select data->'products' from store_data where id = 'main')
              || '[{"id":"p3","name":"Falda","price":70,"variants":[{"id":"v4","size":"S","colorName":"Rojo","stock":3,"stockBy":{"almacen":3}}]}]'::jsonb)))) and st('v4') = 3);
select chk('I5. historial: alta (nueva talla/color) +3', mvq('v4') = 3 and mvlast('v4')->>'type' = 'alta (nueva talla/color)');
select chk('I5. el stockBy que mandó la pantalla para la talla nueva se ignora (todo cuenta en Larco)', raw_sb('v4') is null and sbl('v4','principal') = 3);
select chk('I6. guardar p2 con mi copia vieja (sin p3) NO borra p3', okr(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p2'], null, array['products'])$q$, gv('snap'))))
            and st('v4') = 3 and st('v2') = (gv('v2i'))::int);
select chk('I7. borrar p3 (p_deleted) quita solo p3; las demás siguen con su stock', okr(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p2'], array['p3'], array['products'])$q$, gv('snap'))))
            and vrow('v4') is null and st('v2') = (gv('v2i'))::int and st('v1') = (gv('v1i'))::int + 2 and st('v3') is not null and st('v9') = 0);
select mk() \g /dev/null
select chk('I8. talla nueva v5 en p1 (stock 4) → v5 = 4, v1/v2 intactas', okr(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1'], null, array['products'])$q$,
            jsonb_set((select data from store_data where id = 'main'), '{products,0,variants}', (select data->'products'->0->'variants' from store_data where id = 'main') || '[{"id":"v5","size":"L","colorName":"Negro","stock":4}]'::jsonb))))
            and st('v5') = 4 and st('v2') = (gv('v2i'))::int and mvq('v5') = 4 and mvn('v2') = 0);
select chk('I9. código repetido en dos tallas → CODIGO_REPETIDO:ABC1 y nada cambia', err(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1','p2'], null, array['products'])$q$,
            jsonb_set(jsonb_set((select data from store_data where id = 'main'), '{products,0,variants,0,sku}', '"ABC1"'), '{products,1,variants,0,sku}', '"abc1"'))), 'CODIGO_REPETIDO:ABC1')
            and vrow('v1')->>'sku' is null);
select chk('I10. precio negativo → PRECIO_INVALIDO, nada cambia', err(run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1'], null, array['products'])$q$,
            jsonb_set((select data from store_data where id = 'main'), '{products,0,price}', '-5'))), 'PRECIO_INVALIDO') and (select (data->'products'->0->>'price')::numeric from store_data) = 100);
-- Una prenda borrada por otra persona y yo la «edito» con mi copia vieja (p8 con 2 unidades)
select run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p8'], null, array['products'])$q$,
            jsonb_set((select data from store_data where id = 'main'), '{products}', (select data->'products' from store_data where id = 'main')
              || '[{"id":"p8","name":"Top","price":40,"variants":[{"id":"v8","size":"S","colorName":"Negro","stock":2}]}]'::jsonb))) \g /dev/null
select sv('snap2', (select data from store_data where id = 'main')) \g /dev/null
select run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p1'], array['p8'], array['products'])$q$,
            jsonb_set(gv('snap2'), '{products}', (select jsonb_agg(p) from jsonb_array_elements(gv('snap2')->'products') p where p->>'id' <> 'p8')))) \g /dev/null
select chk('I11. p8 borrada', vrow('v8') is null);
select run(format($q$save_catalog(%L::jsonb, '{}'::jsonb, array['p8'], null, array['products'])$q$,
            jsonb_set(gv('snap2'), '{products}', (select jsonb_agg(case when p->>'id' = 'p8' then p || '{"name":"Top editado"}' else p end) from jsonb_array_elements(gv('snap2')->'products') p)))) \g /dev/null
select info('I11. editar con copia vieja una prenda que otra persona borró', case when vrow('v8') is null then 'no revive' else 'REVIVE con el stock de la pantalla: ' || st('v8') end);
select chk('I. invariante', inv_ok());

\echo ''
\echo '== J. Permisos: quién NO puede mover stock =='
select sv('snapJ', (select data from store_data where id = 'main')) \g /dev/null
select as_vend() \g /dev/null
select chk('J1. vendedora: move_stock → SIN_PERMISO', err(run($$move_stock('v2','entrada',5)$$), 'SIN_PERMISO'));
select chk('J1. vendedora: save_catalog → SIN_PERMISO', err(run(format($q$save_catalog(%L::jsonb, '{"v2":50}'::jsonb, array['p1'])$q$, gv('snapJ'))), 'SIN_PERMISO'));
select chk('J1. vendedora: void_sale → SIN_PERMISO', err(run(format('void_sale(%L, %L)', gv('s9')->>'id', 'x')), 'SIN_PERMISO'));
select as_caja() \g /dev/null
select chk('J2. cajera: move_stock → SIN_PERMISO', err(run($$move_stock('v2','entrada',5)$$), 'SIN_PERMISO'));
select chk('J2. cajera: save_catalog → SIN_PERMISO', err(run(format($q$save_catalog(%L::jsonb, '{"v2":50}'::jsonb, array['p1'])$q$, gv('snapJ'))), 'SIN_PERMISO'));
select chk('J2. cajera: register_purchase → SIN_PERMISO', err(run(format($q$register_purchase(%s, '', 'principal', '[{"variantId":"v2","qty":5,"unitCost":1}]')$q$, gv('sup'))), 'SIN_PERMISO'));
select as_alm() \g /dev/null
select chk('J3. almacén: pos_sale → SIN_PERMISO', err(sell(jsonb_build_array(itm('v2',1)), 'pos-j3'), 'SIN_PERMISO'));
select chk('J3. almacén: save_catalog → SIN_PERMISO', err(run(format($q$save_catalog(%L::jsonb, '{"v2":50}'::jsonb, array['p1'])$q$, gv('snapJ'))), 'SIN_PERMISO'));
select chk('J3. almacén: return_sale → SIN_PERMISO', err(run(format($q$return_sale(%L, '[{"variantId":"v9","qty":1}]', 'x')$q$, gv('s9')->>'id')), 'SIN_PERMISO'));
select as_web() \g /dev/null
select chk('J4. sin sesión: pos_sale → SIN_PERMISO', err(sell(jsonb_build_array(itm('v2',1)), 'pos-j4'), 'SIN_PERMISO'));
select chk('J4. sin sesión: move_stock / save_catalog / create_transfer → SIN_PERMISO', err(run($$move_stock('v2','entrada',5)$$), 'SIN_PERMISO')
            and err(run(format($q$save_catalog(%L::jsonb)$q$, gv('snapJ'))), 'SIN_PERMISO') and err(run($$create_transfer('principal','almacen','[{"variantId":"v2","qty":1}]')$$), 'SIN_PERMISO'));
set role anon;
select run($$move_stock('v2','entrada',5)$$)->>'error' as j5a, run($$(select count(*) from stock_movements)$$)->>'error' as j5b, run($$(select count(*) from stock_transfers)$$)->>'error' as j5c \gset
reset role;
select chk('J5. rol anon de la web: no puede llamar move_stock ni leer historial/guías', :'j5a' like '%permission denied%' and :'j5b' like '%permission denied%' and :'j5c' like '%permission denied%');
select chk('J6. nada de lo anterior cambió el catálogo', (select data from store_data where id = 'main') = gv('snapJ'));

\echo ''
\echo '== Final =='
select chk('Z1. invariante final (nada negativo, sedes = total)', inv_ok());
-- v8 se borró y revivió (I11): borrar una prenda no deja movimiento en el historial, por eso no entra en el libro mayor
select info('Z2. v8 (borrada y revivida): stock / suma del historial', st('v8') || ' / ' || (select coalesce(sum(qty), 0) from stock_movements where variant_id = 'v8'));
select chk('Z2. libro mayor: para cada talla, stock final - inicial = suma del historial', ledger_ok());
select chk('Z3. ninguna venta guardada con ítems sin talla', not exists (select 1 from sales, jsonb_array_elements(data->'items') i where coalesce(i->>'variantId', '') = ''));
select dblink_disconnect('a') \g /dev/null
select dblink_disconnect('b') \g /dev/null
select count(*) filter (where ok) || ' OK, ' || count(*) filter (where not ok) || ' FALLA' from res;
select case when count(*) filter (where not ok) = 0 then 'TODO OK' else 'HAY FALLAS' end from res;
