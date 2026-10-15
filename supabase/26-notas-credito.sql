-- =====================================================================
--  FLY BOUTIQUE — 26: NOTAS DE CRÉDITO ELECTRÓNICAS (DEVOLUCIONES) CON NUBEFACT
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 25. Después, Merge del PR.
--  - Cuando se devuelven prendas de una venta que ya tiene boleta o factura electrónica, se emite una nota de
--    crédito por lo devuelto (devolución total = tipo 6, por ítem = tipo 7 del catálogo SUNAT).
--  - Una nota por devolución (tabla einvoice_notes, clave = venta + devolución). Número asignado una sola vez;
--    al reintentar primero se consulta a Nubefact: nunca se duplica. Nada «aceptado» sin la respuesta.
--  - Series de notas: empiezan con B (para boletas) o F (para facturas). Por defecto BC01 y FC01 (configurables).
--  - En un cambio, la nota cubre lo que vuelve; lo que se lleva sigue cubierto por la venta original.
--  No borra datos. Para volver atrás: 26-notas-credito-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.einvoice_notes (
  sale_id text not null, return_id text not null,
  tipo_nota int not null default 3, serie text not null, numero int not null,
  ref_tipo int not null, ref_serie text not null, ref_numero int not null,
  motivo_codigo int not null, motivo text, total numeric not null default 0,
  status text not null default 'preparado' check (status in ('preparado', 'enviado', 'aceptado', 'rechazado', 'error')),
  attempts int not null default 0,
  sunat_description text, pdf_url text, link text, qr text, hash text, last_error text, request jsonb, response jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by text,
  primary key (sale_id, return_id), unique (serie, numero)
);
alter table public.einvoice_notes enable row level security;
revoke all on public.einvoice_notes from anon, authenticated;
grant select on public.einvoice_notes to authenticated;
drop policy if exists "notas_ver" on public.einvoice_notes;
create policy "notas_ver" on public.einvoice_notes for select using (public.has_role('superadmin', 'administrador', 'cajero'));

-- Series de notas (solo Super Admin)
create or replace function public.set_credit_note_series(p_boleta text, p_factura text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin') then raise exception 'SIN_PERMISO'; end if;
  if p_boleta is not null then
    if upper(trim(p_boleta)) !~ '^B[A-Z0-9]{3}$' then raise exception 'SERIE_INVALIDA'; end if;
    perform public.put_app_secret('nubefact_serie_nc_boleta', upper(trim(p_boleta)));
  end if;
  if p_factura is not null then
    if upper(trim(p_factura)) !~ '^F[A-Z0-9]{3}$' then raise exception 'SERIE_INVALIDA'; end if;
    perform public.put_app_secret('nubefact_serie_nc_factura', upper(trim(p_factura)));
  end if;
  return jsonb_build_object('boleta', coalesce(nullif(public.einv_secret('nubefact_serie_nc_boleta'), ''), 'BC01'),
                            'factura', coalesce(nullif(public.einv_secret('nubefact_serie_nc_factura'), ''), 'FC01'));
end $$;
revoke execute on function public.set_credit_note_series(text, text) from public, anon;
grant execute on function public.set_credit_note_series(text, text) to authenticated;

-- Aplica la respuesta de Nubefact a la nota
create or replace function public.credit_note_apply(p_sale text, p_ret text, r jsonb, p_req jsonb) returns public.einvoice_notes
language plpgsql security definer set search_path = public as $$
declare n public.einvoice_notes; st text;
begin
  st := case
    when coalesce((r->>'aceptada_por_sunat')::boolean, false) then 'aceptado'
    when r ? 'errors' and coalesce((r->>'_status')::int, 0) between 200 and 499 then 'rechazado'
    when coalesce(r->>'enlace', r->>'enlace_del_pdf', '') <> '' then 'enviado'
    else 'error' end;
  update public.einvoice_notes set status = st, attempts = attempts + case when p_req is not null then 1 else 0 end, updated_at = now(),
         request = coalesce(p_req, request), response = r - '_status', sunat_description = coalesce(r->>'sunat_description', sunat_description),
         pdf_url = coalesce(nullif(r->>'enlace_del_pdf', ''), pdf_url), link = coalesce(nullif(r->>'enlace', ''), link),
         qr = coalesce(nullif(r->>'cadena_para_codigo_qr', ''), qr), hash = coalesce(nullif(r->>'codigo_hash', ''), hash),
         last_error = case when st in ('rechazado', 'error') then left(coalesce(r->>'errors', r->>'_error', 'HTTP ' || (r->>'_status')), 300) end
   where sale_id = p_sale and return_id = p_ret returning * into n;
  return n;
end $$;
revoke execute on function public.credit_note_apply(text, text, jsonb, jsonb) from public, anon, authenticated;

-- Emitir (o reintentar) la nota de crédito de una devolución. Seguro de llamar varias veces.
create or replace function public.emit_credit_note(p_sale_id text, p_return_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; e public.einvoices; n public.einvoice_notes; ret jsonb; it jsonb; items jsonb := '[]'::jsonb;
        lt numeric; sub numeric; igv numeric; q numeric; tg numeric := 0; ti numeric := 0; v_serie text; v_num int; code int;
        sold numeric; returned numeric; req jsonb; r jsonb; base jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(public.einv_secret('nubefact_token'), '') = '' or coalesce(public.einv_secret('nubefact_ruta'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'NO_CONFIGURADO');
  end if;
  select data into s from public.sales where id = p_sale_id for update;
  if s is null then raise exception 'VENTA_NO_EXISTE'; end if;
  select x into ret from jsonb_array_elements(coalesce(s->'returns', '[]'::jsonb)) x where x->>'id' = p_return_id;
  if ret is null then raise exception 'DEVOLUCION_NO_EXISTE'; end if;
  select * into e from public.einvoices where sale_id = p_sale_id;
  if e.sale_id is null or e.status not in ('enviado', 'aceptado') then return jsonb_build_object('ok', false, 'reason', 'VENTA_SIN_COMPROBANTE'); end if;
  select * into n from public.einvoice_notes where sale_id = p_sale_id and return_id = p_return_id for update;

  if n.sale_id is not null then
    if n.status = 'aceptado' then return to_jsonb(n) || jsonb_build_object('ok', true); end if;
    if n.attempts > 0 then   -- ¿Nubefact ya la tiene? (evita duplicados tras un corte)
      r := public.nubefact_call(jsonb_build_object('operacion', 'consultar_comprobante', 'tipo_de_comprobante', 3, 'serie', n.serie, 'numero', n.numero));
      if coalesce(r->>'enlace', r->>'enlace_del_pdf', '') <> '' and not (r ? 'errors') then
        n := public.credit_note_apply(p_sale_id, p_return_id, r, null);
        return to_jsonb(n) || jsonb_build_object('ok', true);
      end if;
    end if;
    v_serie := n.serie; v_num := n.numero;
  else
    v_serie := case when e.tipo = 1 then coalesce(nullif(public.einv_secret('nubefact_serie_nc_factura'), ''), 'FC01')
                    else coalesce(nullif(public.einv_secret('nubefact_serie_nc_boleta'), ''), 'BC01') end;
    v_num := null;
  end if;

  -- Ítems de la nota: lo que vuelve, al precio que realmente se cobró (ya con el descuento repartido)
  for it in select x from jsonb_array_elements(coalesce(ret->'lines', '[]'::jsonb)) x where coalesce((x->>'qty')::numeric, 0) > 0 loop
    q := (it->>'qty')::numeric; lt := round(coalesce(public.fly_num(it->>'unitPrice'), 0) * q, 2);
    if lt <= 0 then continue; end if;
    sub := round(lt / 1.18, 2); igv := lt - sub; tg := tg + sub; ti := ti + igv;
    items := items || jsonb_build_array(jsonb_build_object('unidad_de_medida', 'NIU', 'codigo', coalesce(it->>'variantId', ''),
      'descripcion', left(trim(concat_ws(' ', it->>'name', nullif(concat_ws(' / ', nullif(it->>'size', ''), nullif(it->>'colorName', '')), ''))), 250),
      'cantidad', q, 'valor_unitario', round(sub / q, 10), 'precio_unitario', round(lt / q, 10), 'descuento', '',
      'subtotal', sub, 'tipo_de_igv', 1, 'igv', igv, 'total', lt, 'anticipo_regularizacion', false));
  end loop;
  if jsonb_array_length(items) = 0 then raise exception 'DEVOLUCION_SIN_IMPORTE'; end if;
  -- ¿Devolución total? (todas las prendas vendidas ya volvieron y no hay cambio)
  select coalesce(sum((x->>'qty')::numeric), 0) into sold from jsonb_array_elements(s->'items') x;
  select coalesce(sum((y->>'qty')::numeric), 0) into returned from jsonb_array_elements(s->'returns') r2, jsonb_array_elements(r2->'lines') y;
  code := case when returned >= sold and jsonb_array_length(coalesce(ret->'newItems', '[]'::jsonb)) = 0 and jsonb_array_length(s->'returns') = 1 then 6 else 7 end;

  if v_num is null then
    insert into public.doc_counters (serie, next_number) values ('NF-' || v_serie, 1) on conflict (serie) do nothing;
    update public.doc_counters set next_number = next_number + 1 where doc_counters.serie = 'NF-' || v_serie returning next_number - 1 into v_num;
    insert into public.einvoice_notes (sale_id, return_id, serie, numero, ref_tipo, ref_serie, ref_numero, motivo_codigo, motivo, total, created_by)
    values (p_sale_id, p_return_id, v_serie, v_num, e.tipo, e.serie, e.numero, code, left(coalesce(ret->>'reason', 'Devolución'), 250), tg + ti, public.my_staff_name())
    returning * into n;
  end if;

  -- Misma cabecera que el comprobante original (cliente, fecha de hoy), con la referencia a lo que se modifica
  base := coalesce(e.request, '{}'::jsonb);
  req := jsonb_build_object(
    'operacion', 'generar_comprobante', 'tipo_de_comprobante', 3, 'serie', v_serie, 'numero', v_num, 'sunat_transaction', 1,
    'cliente_tipo_de_documento', coalesce(base->>'cliente_tipo_de_documento', '-'), 'cliente_numero_de_documento', coalesce(base->>'cliente_numero_de_documento', '-'),
    'cliente_denominacion', coalesce(base->>'cliente_denominacion', 'CLIENTES VARIOS'), 'cliente_direccion', coalesce(base->>'cliente_direccion', ''),
    'cliente_email', coalesce(base->>'cliente_email', ''), 'cliente_email_1', '', 'cliente_email_2', '',
    'fecha_de_emision', to_char(now() at time zone 'America/Lima', 'DD-MM-YYYY'), 'fecha_de_vencimiento', '',
    'moneda', 1, 'tipo_de_cambio', '', 'porcentaje_de_igv', 18.00, 'descuento_global', '', 'total_descuento', '', 'total_anticipo', '',
    'total_gravada', tg, 'total_inafecta', '', 'total_exonerada', '', 'total_igv', ti, 'total_gratuita', '', 'total_otros_cargos', '', 'total', tg + ti,
    'percepcion_tipo', '', 'percepcion_base_imponible', '', 'total_percepcion', '', 'total_incluido_percepcion', '', 'detraccion', false,
    'observaciones', left('Devolución: ' || coalesce(ret->>'reason', ''), 250),
    'documento_que_se_modifica_tipo', e.tipo, 'documento_que_se_modifica_serie', e.serie, 'documento_que_se_modifica_numero', e.numero,
    'tipo_de_nota_de_credito', code, 'tipo_de_nota_de_debito', '',
    'enviar_automaticamente_a_la_sunat', true, 'enviar_automaticamente_al_cliente', coalesce(base->>'cliente_email', '') <> '',
    'codigo_unico', '', 'condiciones_de_pago', '', 'medio_de_pago', '', 'placa_vehiculo', '', 'orden_compra_servicio', '', 'formato_de_pdf', '', 'items', items);
  r := public.nubefact_call(req);
  n := public.credit_note_apply(p_sale_id, p_return_id, r, req);
  perform public.audit('nota_credito_' || n.status, jsonb_build_object('venta', p_sale_id, 'nota', n.serie || '-' || n.numero, 'modifica', e.serie || '-' || e.numero, 'total', n.total));
  return to_jsonb(n) || jsonb_build_object('ok', n.status in ('aceptado', 'enviado'));
end $$;
revoke execute on function public.emit_credit_note(text, text) from public, anon;
grant execute on function public.emit_credit_note(text, text) to authenticated;
