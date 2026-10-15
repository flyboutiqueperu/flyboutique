-- =====================================================================
--  FLY BOUTIQUE — 25: BOLETAS Y FACTURAS ELECTRÓNICAS CON NUBEFACT
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 24. Después, Merge del PR.
--  - Queda APAGADA hasta que Super Admin guarde la RUTA y el TOKEN de Nubefact en Más → Facturación electrónica.
--    El token se guarda en app_secrets (solo servidor): nunca vuelve al navegador ni va en el código.
--  - Cada venta tiene como máximo UN comprobante electrónico (tabla einvoices, clave = id de la venta).
--    Su número oficial (ej. B001-1) se asigna una sola vez; si se corta la conexión, al reintentar primero se
--    CONSULTA a Nubefact y solo se vuelve a enviar si no existe: nunca se duplica.
--  - Estados: preparado → enviado (registrado en Nubefact, SUNAT pendiente) → aceptado / rechazado;
--    error = no hubo respuesta (se puede reintentar); anulacion_pendiente → anulado.
--    Nada se marca «aceptado» sin la respuesta de Nubefact.
--  - Precios con IGV incluido (18 %). Los descuentos se reparten entre las prendas; el envío va como servicio.
--  - Solo staff de ventas emite; anular en SUNAT solo Super Admin y Administración. No borra datos.
--  Para volver atrás: 25-facturacion-nubefact-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.einvoices (
  sale_id text primary key,
  tipo int not null check (tipo in (1, 2)),               -- 1 factura, 2 boleta
  serie text not null, numero int not null,
  status text not null default 'preparado' check (status in ('preparado', 'enviado', 'aceptado', 'rechazado', 'error', 'anulacion_pendiente', 'anulado')),
  attempts int not null default 0,
  sunat_description text, pdf_url text, xml_url text, cdr_url text, link text, qr text, hash text,
  last_error text, request jsonb, response jsonb,
  void_reason text, void_response jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by text,
  unique (serie, numero)
);
alter table public.einvoices enable row level security;
revoke all on public.einvoices from anon, authenticated;
grant select on public.einvoices to authenticated;
drop policy if exists "comprobantes_ver" on public.einvoices;
create policy "comprobantes_ver" on public.einvoices for select
  using (public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online'));

-- Guarda un valor en app_secrets (igual que en el SQL 24; se repite por si este se corre solo)
create or replace function public.put_app_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.app_secrets set value = p_value where name = p_name;
  if not found then insert into public.app_secrets (name, value) values (p_name, p_value); end if;
end $$;
revoke execute on function public.put_app_secret(text, text) from public, anon, authenticated;

create or replace function public.einv_secret(p_name text) returns text
language sql stable security definer set search_path = public as $$ select value from public.app_secrets where name = p_name $$;
revoke execute on function public.einv_secret(text) from public, anon, authenticated;

-- Estado de la configuración (nunca devuelve el token)
create or replace function public.einvoice_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sb text := coalesce(nullif(public.einv_secret('nubefact_serie_boleta'), ''), 'B001');
        sf text := coalesce(nullif(public.einv_secret('nubefact_serie_factura'), ''), 'F001');
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  return jsonb_build_object(
    'configured', coalesce(public.einv_secret('nubefact_token'), '') <> '' and coalesce(public.einv_secret('nubefact_ruta'), '') <> '',
    'auto', coalesce(public.einv_secret('nubefact_auto'), '1') = '1',
    'ruta', case when public.has_role('superadmin') then public.einv_secret('nubefact_ruta') end,
    'serieBoleta', sb, 'serieFactura', sf,
    'nextBoleta', coalesce((select next_number from public.doc_counters where serie = 'NF-' || sb), 1),
    'nextFactura', coalesce((select next_number from public.doc_counters where serie = 'NF-' || sf), 1),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.einvoices group by status) x), '{}'::jsonb));
end $$;
revoke execute on function public.einvoice_status() from public, anon;
grant execute on function public.einvoice_status() to authenticated;

-- Guardar RUTA, TOKEN, series y números (solo Super Admin). Token vacío = no cambiarlo; '-' = borrarlo (apaga la emisión).
create or replace function public.set_einvoice_config(p_ruta text, p_token text, p_serie_boleta text default null, p_serie_factura text default null,
                                                      p_auto boolean default null, p_next_boleta int default null, p_next_factura int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sb text; sf text;
begin
  if not public.has_role('superadmin') then raise exception 'SIN_PERMISO'; end if;
  if p_ruta is not null and trim(p_ruta) <> '' then
    if trim(p_ruta) !~ '^https://[^ ]+$' then raise exception 'RUTA_INVALIDA'; end if;
    perform public.put_app_secret('nubefact_ruta', trim(p_ruta));
  end if;
  if coalesce(trim(p_token), '') = '-' then delete from public.app_secrets where name = 'nubefact_token';
  elsif coalesce(trim(p_token), '') <> '' then
    if length(trim(p_token)) > 400 then raise exception 'TOKEN_INVALIDO'; end if;
    perform public.put_app_secret('nubefact_token', trim(p_token));
  end if;
  if p_serie_boleta is not null then
    if upper(trim(p_serie_boleta)) !~ '^B[A-Z0-9]{3}$' then raise exception 'SERIE_INVALIDA'; end if;
    perform public.put_app_secret('nubefact_serie_boleta', upper(trim(p_serie_boleta)));
  end if;
  if p_serie_factura is not null then
    if upper(trim(p_serie_factura)) !~ '^F[A-Z0-9]{3}$' then raise exception 'SERIE_INVALIDA'; end if;
    perform public.put_app_secret('nubefact_serie_factura', upper(trim(p_serie_factura)));
  end if;
  if p_auto is not null then perform public.put_app_secret('nubefact_auto', case when p_auto then '1' else '0' end); end if;
  sb := coalesce(nullif(public.einv_secret('nubefact_serie_boleta'), ''), 'B001');
  sf := coalesce(nullif(public.einv_secret('nubefact_serie_factura'), ''), 'F001');
  -- Siguiente número (por si ya emitiste comprobantes desde la web de Nubefact): nunca menor a uno ya usado aquí
  if p_next_boleta is not null then
    if p_next_boleta < coalesce((select max(numero) + 1 from public.einvoices where serie = sb), 1) or p_next_boleta > 99999999 then raise exception 'NUMERO_INVALIDO'; end if;
    insert into public.doc_counters (serie, next_number) values ('NF-' || sb, p_next_boleta) on conflict (serie) do update set next_number = excluded.next_number;
  end if;
  if p_next_factura is not null then
    if p_next_factura < coalesce((select max(numero) + 1 from public.einvoices where serie = sf), 1) or p_next_factura > 99999999 then raise exception 'NUMERO_INVALIDO'; end if;
    insert into public.doc_counters (serie, next_number) values ('NF-' || sf, p_next_factura) on conflict (serie) do update set next_number = excluded.next_number;
  end if;
  perform public.audit('facturacion_config', jsonb_build_object('token', case when coalesce(trim(p_token), '') = '-' then 'borrado' when coalesce(trim(p_token), '') <> '' then 'cambiado' else 'sin cambio' end,
    'serieBoleta', sb, 'serieFactura', sf));
  return public.einvoice_status();
end $$;
revoke execute on function public.set_einvoice_config(text, text, text, text, boolean, int, int) from public, anon;
grant execute on function public.set_einvoice_config(text, text, text, text, boolean, int, int) to authenticated;

-- Llamada a Nubefact (POST a la RUTA). Devuelve la respuesta + _status. Prueba los dos formatos de cabecera conocidos.
create or replace function public.nubefact_call(p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ruta text := public.einv_secret('nubefact_ruta'); tok text := public.einv_secret('nubefact_token');
        st int; body text; j jsonb; hdr text; i int; fmt int := coalesce(nullif(public.einv_secret('nubefact_auth_fmt'), ''), '1')::int; used int;
begin
  if coalesce(ruta, '') = '' or coalesce(tok, '') = '' then return jsonb_build_object('_status', 0, '_error', 'NO_CONFIGURADO'); end if;
  -- Primero el formato que funcionó la última vez; si Nubefact lo rechaza, el otro (y se recuerda el que sirvió)
  for i in 1..2 loop
    used := case when i = 1 then fmt else 3 - fmt end;
    hdr := case when used = 1 then 'Token token="' || tok || '"' else tok end;
    begin
      begin perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25'); exception when others then null; end;
      select r.status, r.content into st, body
        from extensions.http(('POST', ruta, array[extensions.http_header('Authorization', hdr)], 'application/json', p_body::text)::extensions.http_request) r;
    exception when others then
      return jsonb_build_object('_status', 0, '_error', 'SIN_CONEXION: ' || left(sqlerrm, 150));
    end;
    if st not in (401, 403) then
      if used <> fmt then perform public.put_app_secret('nubefact_auth_fmt', used::text); end if;
      exit;
    end if;
  end loop;
  begin j := body::jsonb; exception when others then j := jsonb_build_object('_raw', left(coalesce(body, ''), 500)); end;
  if jsonb_typeof(j) <> 'object' then j := jsonb_build_object('_raw', left(coalesce(body, ''), 500)); end if;
  return j || jsonb_build_object('_status', st);
end $$;
revoke execute on function public.nubefact_call(jsonb) from public, anon, authenticated;

-- Arma el JSON de Nubefact a partir de la venta (precios con IGV incluido)
create or replace function public.einvoice_payload(s jsonb, p_tipo int, p_serie text, p_numero int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare it jsonb; items jsonb := '[]'::jsonb; lines jsonb := '[]'::jsonb; n int; i int := 0;
        total numeric := round(coalesce(public.fly_num(s->>'total'), 0), 2); ship numeric := round(coalesce(public.fly_num(s->>'shipping'), 0), 2);
        merch numeric; gross numeric; ratio numeric; acc numeric := 0; lt numeric; sub numeric; igv numeric; q numeric;
        tg numeric := 0; ti numeric := 0; doc text := regexp_replace(coalesce(s->>'customerDoc', ''), '\s', '', 'g');
        dtype text; dnum text; cname text; created timestamptz;
begin
  merch := total - ship;
  select coalesce(sum(coalesce(public.fly_num(x->>'unitPrice'), 0) * coalesce((x->>'qty')::numeric, 0)), 0) into gross from jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) x;
  if gross <= 0 or merch <= 0 then raise exception 'VENTA_SIN_IMPORTE'; end if;
  ratio := merch / gross;
  n := (select count(*) from jsonb_array_elements(s->'items') x where coalesce((x->>'qty')::numeric, 0) > 0);
  for it in select x from jsonb_array_elements(s->'items') x where coalesce((x->>'qty')::numeric, 0) > 0 loop
    i := i + 1; q := (it->>'qty')::numeric;
    lt := case when i = n then merch - acc else round(coalesce(public.fly_num(it->>'unitPrice'), 0) * q * ratio, 2) end;   -- el último cuadra los céntimos
    acc := acc + lt;
    if lt <= 0 then raise exception 'ITEM_SIN_IMPORTE:%', it->>'name'; end if;
    lines := lines || jsonb_build_array(jsonb_build_object('u', 'NIU', 'c', coalesce(nullif(it->>'sku', ''), it->>'variantId', ''),
      'd', left(trim(concat_ws(' ', it->>'name', nullif(concat_ws(' / ', nullif(it->>'size', ''), nullif(it->>'colorName', '')), ''))), 250), 'q', q, 't', lt));
  end loop;
  if ship > 0 then lines := lines || jsonb_build_array(jsonb_build_object('u', 'ZZ', 'c', 'ENVIO', 'd', 'Servicio de envío', 'q', 1, 't', ship)); end if;
  for it in select x from jsonb_array_elements(lines) x loop
    lt := (it->>'t')::numeric; q := (it->>'q')::numeric;
    sub := round(lt / 1.18, 2); igv := lt - sub; tg := tg + sub; ti := ti + igv;
    items := items || jsonb_build_array(jsonb_build_object(
      'unidad_de_medida', it->>'u', 'codigo', it->>'c', 'descripcion', it->>'d', 'cantidad', q,
      'valor_unitario', round(sub / q, 10), 'precio_unitario', round(lt / q, 10), 'descuento', '',
      'subtotal', sub, 'tipo_de_igv', 1, 'igv', igv, 'total', lt, 'anticipo_regularizacion', false));
  end loop;

  -- Cliente
  if p_tipo = 1 then
    if not public.ruc_valido(doc) then raise exception 'FACTURA_SIN_RUC'; end if;
    dtype := '6'; dnum := doc; cname := coalesce(nullif(trim(s->>'customerName'), ''), '-');
  elsif coalesce((s->>'anonymous')::boolean, false) or doc = '' or doc = '00000000' then
    if total >= 700 then raise exception 'BOLETA_700_SIN_DOCUMENTO'; end if;   -- SUNAT pide identificar al cliente desde S/ 700
    dtype := '-'; dnum := '-'; cname := 'CLIENTES VARIOS';
  else
    dtype := case upper(coalesce(s->>'customerDocType', '')) when 'RUC' then '6' when 'DNI' then '1' when 'CE' then '4' when 'PAS' then '7'
                  else case when doc ~ '^[0-9]{8}$' then '1' when doc ~ '^[0-9]{11}$' then '6' else '-' end end;
    dnum := doc; cname := coalesce(nullif(trim(s->>'customerName'), ''), 'CLIENTES VARIOS');
  end if;
  created := coalesce(to_timestamp(public.fly_num(s->>'createdAt') / 1000), now());

  return jsonb_build_object(
    'operacion', 'generar_comprobante', 'tipo_de_comprobante', p_tipo, 'serie', p_serie, 'numero', p_numero,
    'sunat_transaction', 1, 'cliente_tipo_de_documento', dtype, 'cliente_numero_de_documento', dnum,
    'cliente_denominacion', left(cname, 100), 'cliente_direccion', left(coalesce(s->>'customerAddress', ''), 100),
    'cliente_email', coalesce(nullif(case when coalesce(s->>'customerEmail', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and s->>'customerEmail' !~ 'sincorreo@' then s->>'customerEmail' end, ''), ''),
    'cliente_email_1', '', 'cliente_email_2', '',
    'fecha_de_emision', to_char(created at time zone 'America/Lima', 'DD-MM-YYYY'), 'fecha_de_vencimiento', '',
    'moneda', 1, 'tipo_de_cambio', '', 'porcentaje_de_igv', 18.00,
    'descuento_global', '', 'total_descuento', '', 'total_anticipo', '',
    'total_gravada', tg, 'total_inafecta', '', 'total_exonerada', '', 'total_igv', ti, 'total_gratuita', '', 'total_otros_cargos', '',
    'total', tg + ti, 'percepcion_tipo', '', 'percepcion_base_imponible', '', 'total_percepcion', '', 'total_incluido_percepcion', '',
    'detraccion', false, 'observaciones', left(coalesce('Venta interna ' || (s->>'serie') || '-' || (s->>'numero'), ''), 250),
    'documento_que_se_modifica_tipo', '', 'documento_que_se_modifica_serie', '', 'documento_que_se_modifica_numero', '',
    'tipo_de_nota_de_credito', '', 'tipo_de_nota_de_debito', '',
    'enviar_automaticamente_a_la_sunat', true, 'enviar_automaticamente_al_cliente', coalesce(s->>'customerEmail', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and s->>'customerEmail' !~ 'sincorreo@',
    'codigo_unico', '', 'condiciones_de_pago', '', 'medio_de_pago', '', 'placa_vehiculo', '', 'orden_compra_servicio', '',
    'formato_de_pdf', '', 'items', items);
end $$;
revoke execute on function public.einvoice_payload(jsonb, int, text, int) from public, anon, authenticated;

-- Guarda lo que respondió Nubefact y decide el estado (nunca «aceptado» sin aceptada_por_sunat = true)
create or replace function public.einvoice_apply(p_sale text, r jsonb, p_req jsonb) returns public.einvoices
language plpgsql security definer set search_path = public as $$
declare e public.einvoices; st text; err text;
begin
  err := coalesce(r->>'errors', r->>'_error');
  st := case
    when coalesce((r->>'aceptada_por_sunat')::boolean, false) then 'aceptado'
    when r ? 'errors' and coalesce((r->>'_status')::int, 0) between 200 and 499 then 'rechazado'   -- Nubefact no lo aceptó (datos): se corrige y se reintenta con el mismo número
    when coalesce(r->>'enlace', r->>'enlace_del_pdf', '') <> '' then 'enviado'                    -- existe en Nubefact; SUNAT aún no confirma (boletas van en resumen diario)
    else 'error' end;
  update public.einvoices set status = st, attempts = attempts + case when p_req is not null then 1 else 0 end, updated_at = now(),
         request = coalesce(p_req, request), response = r - '_status',
         sunat_description = coalesce(r->>'sunat_description', sunat_description),
         pdf_url = coalesce(nullif(r->>'enlace_del_pdf', ''), pdf_url), xml_url = coalesce(nullif(r->>'enlace_del_xml', ''), xml_url),
         cdr_url = coalesce(nullif(r->>'enlace_del_cdr', ''), cdr_url), link = coalesce(nullif(r->>'enlace', ''), link),
         qr = coalesce(nullif(r->>'cadena_para_codigo_qr', ''), qr), hash = coalesce(nullif(r->>'codigo_hash', ''), hash),
         last_error = case when st in ('rechazado', 'error') then left(coalesce(err, 'HTTP ' || (r->>'_status')), 300) else null end
   where sale_id = p_sale returning * into e;
  return e;
end $$;
revoke execute on function public.einvoice_apply(text, jsonb, jsonb) from public, anon, authenticated;

-- Emitir (o reintentar) el comprobante electrónico de una venta. Seguro de llamar varias veces.
create or replace function public.emit_einvoice(p_sale_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; e public.einvoices; v_tipo int; v_serie text; v_num int; req jsonb; r jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(public.einv_secret('nubefact_token'), '') = '' or coalesce(public.einv_secret('nubefact_ruta'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'NO_CONFIGURADO');
  end if;
  select data into s from public.sales where id = p_sale_id for update;   -- candado: una sola emisión a la vez por venta
  if s is null then raise exception 'VENTA_NO_EXISTE'; end if;
  select * into e from public.einvoices where sale_id = p_sale_id for update;

  if e.sale_id is not null then
    if e.status in ('aceptado', 'anulacion_pendiente', 'anulado') then return to_jsonb(e) || jsonb_build_object('ok', true); end if;
    -- Antes de volver a enviar, se pregunta a Nubefact si ya lo tiene (evita duplicados tras un corte)
    if e.attempts > 0 then
      r := public.nubefact_call(jsonb_build_object('operacion', 'consultar_comprobante', 'tipo_de_comprobante', e.tipo, 'serie', e.serie, 'numero', e.numero));
      if coalesce(r->>'enlace', r->>'enlace_del_pdf', '') <> '' and not (r ? 'errors') then
        e := public.einvoice_apply(p_sale_id, r, null);   -- ya existe en Nubefact: no se vuelve a enviar
        update public.sales set data = data || jsonb_build_object('einvoice', jsonb_build_object('serie', e.serie, 'numero', e.numero, 'tipo', e.tipo, 'status', e.status)) where id = p_sale_id;
        return to_jsonb(e) || jsonb_build_object('ok', true);
      end if;
    end if;
    v_tipo := e.tipo; v_serie := e.serie; v_num := e.numero;
  else
    if s->>'status' = 'anulado' then raise exception 'VENTA_ANULADA'; end if;
    if s->>'source' = 'web' and coalesce(s->>'paymentStatus', '') <> 'confirmado' then raise exception 'PEDIDO_SIN_PAGO'; end if;
    if coalesce((select data->'settings'->'company'->>'taxRegime' from public.store_data where id = 'main'), '') = 'nrus' then raise exception 'REGIMEN_NRUS'; end if;
    v_tipo := case when s->>'tipo' = 'factura' then 1 else 2 end;
    v_serie := case when v_tipo = 1 then coalesce(nullif(public.einv_secret('nubefact_serie_factura'), ''), 'F001') else coalesce(nullif(public.einv_secret('nubefact_serie_boleta'), ''), 'B001') end;
    perform public.einvoice_payload(s, v_tipo, v_serie, 1);   -- valida los datos ANTES de gastar un número
    insert into public.doc_counters (serie, next_number) values ('NF-' || v_serie, 1) on conflict (serie) do nothing;
    update public.doc_counters set next_number = next_number + 1 where doc_counters.serie = 'NF-' || v_serie returning next_number - 1 into v_num;
    insert into public.einvoices (sale_id, tipo, serie, numero, created_by) values (p_sale_id, v_tipo, v_serie, v_num, public.my_staff_name()) returning * into e;
  end if;

  req := public.einvoice_payload(s, v_tipo, v_serie, v_num);
  r := public.nubefact_call(req);
  e := public.einvoice_apply(p_sale_id, r, req);
  if e.status = 'aceptado' or e.status = 'enviado' then
    update public.sales set data = data || jsonb_build_object('einvoice', jsonb_build_object('serie', e.serie, 'numero', e.numero, 'tipo', e.tipo, 'status', e.status)) where id = p_sale_id;
  end if;
  perform public.audit('comprobante_' || e.status, jsonb_build_object('venta', p_sale_id, 'comprobante', e.serie || '-' || e.numero, 'detalle', coalesce(e.last_error, e.sunat_description)));
  return to_jsonb(e) || jsonb_build_object('ok', e.status in ('aceptado', 'enviado'));
end $$;
revoke execute on function public.emit_einvoice(text) from public, anon;
grant execute on function public.emit_einvoice(text) to authenticated;

-- Volver a consultar el estado en SUNAT (para «enviado» y anulaciones pendientes)
create or replace function public.refresh_einvoice(p_sale_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.einvoices; r jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  select * into e from public.einvoices where sale_id = p_sale_id for update;
  if e.sale_id is null then raise exception 'SIN_COMPROBANTE'; end if;
  if e.status = 'anulacion_pendiente' then
    r := public.nubefact_call(jsonb_build_object('operacion', 'consultar_anulacion', 'tipo_de_comprobante', e.tipo, 'serie', e.serie, 'numero', e.numero));
    if coalesce((r->>'aceptada_por_sunat')::boolean, false) then
      update public.einvoices set status = 'anulado', void_response = r, updated_at = now() where sale_id = p_sale_id returning * into e;
    else update public.einvoices set void_response = r, updated_at = now() where sale_id = p_sale_id returning * into e; end if;
    return to_jsonb(e);
  end if;
  if e.status not in ('enviado', 'error', 'aceptado') then return to_jsonb(e); end if;
  r := public.nubefact_call(jsonb_build_object('operacion', 'consultar_comprobante', 'tipo_de_comprobante', e.tipo, 'serie', e.serie, 'numero', e.numero));
  if coalesce(r->>'enlace', r->>'enlace_del_pdf', '') <> '' and not (r ? 'errors') then
    e := public.einvoice_apply(p_sale_id, r, null);
    if coalesce((r->>'anulado')::boolean, false) then update public.einvoices set status = 'anulado' where sale_id = p_sale_id returning * into e; end if;
    update public.sales set data = data || jsonb_build_object('einvoice', jsonb_build_object('serie', e.serie, 'numero', e.numero, 'tipo', e.tipo, 'status', e.status)) where id = p_sale_id;
  end if;
  return to_jsonb(e);
end $$;
revoke execute on function public.refresh_einvoice(text) from public, anon;
grant execute on function public.refresh_einvoice(text) to authenticated;

-- Anular en SUNAT (comunicación de baja). Solo Super Admin y Administración, con motivo.
create or replace function public.void_einvoice(p_sale_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.einvoices; r jsonb;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into e from public.einvoices where sale_id = p_sale_id for update;
  if e.sale_id is null then raise exception 'SIN_COMPROBANTE'; end if;
  if e.status in ('anulado', 'anulacion_pendiente') then return to_jsonb(e); end if;
  if e.status not in ('aceptado', 'enviado') then raise exception 'NO_SE_PUEDE_ANULAR:%', e.status; end if;
  r := public.nubefact_call(jsonb_build_object('operacion', 'generar_anulacion', 'tipo_de_comprobante', e.tipo, 'serie', e.serie, 'numero', e.numero,
                                               'motivo', left(trim(p_reason), 100), 'codigo_unico', ''));
  if r ? 'errors' or coalesce((r->>'_status')::int, 0) = 0 then
    update public.einvoices set last_error = left(coalesce(r->>'errors', r->>'_error'), 300), void_response = r, updated_at = now() where sale_id = p_sale_id;
    raise exception 'ANULACION_RECHAZADA:%', left(coalesce(r->>'errors', r->>'_error', ''), 200);
  end if;
  update public.einvoices set status = case when coalesce((r->>'aceptada_por_sunat')::boolean, false) then 'anulado' else 'anulacion_pendiente' end,
         void_reason = trim(p_reason), void_response = r, updated_at = now(), last_error = null
   where sale_id = p_sale_id returning * into e;
  perform public.audit('comprobante_anulado', jsonb_build_object('venta', p_sale_id, 'comprobante', e.serie || '-' || e.numero, 'motivo', p_reason));
  return to_jsonb(e);
end $$;
revoke execute on function public.void_einvoice(text, text) from public, anon;
grant execute on function public.void_einvoice(text, text) to authenticated;
