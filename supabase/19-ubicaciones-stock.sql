-- =====================================================================
--  FLY BOUTIQUE — 19: STOCK POR SEDE (Larco / Almacén) Y GUÍAS DE TRASLADO
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Después, Merge del PR.
--  - Cada talla/color guarda cuántas unidades hay en cada lugar (stockBy). El total (stock) es la suma,
--    y es lo que vende la web. La caja de Larco descuenta de Larco.
--  - Si una prenda aún no tiene ubicaciones, todo su stock cuenta como Larco (no se toca nada de lo que hay).
--  - Guías de traslado: quien envía emite la guía (las prendas quedan EN CAMINO, no se venden);
--    la sede que recibe la confirma al llegar (quién y a qué hora). Si falta algo, queda anotado.
--  No borra datos. Para volver atrás: 19-ubicaciones-VOLVER-ATRAS.sql
-- =====================================================================

-- Sedes donde se guarda stock. 'principal' = Larco (tienda), 'almacen' = Almacén.
create or replace function public.stock_locations(d jsonb) returns text[]
language sql immutable as $$
  select coalesce((select array_agg(x->>'id') from jsonb_array_elements(case when jsonb_typeof(d->'settings'->'locations') = 'array' then d->'settings'->'locations' else '[]'::jsonb end) x where coalesce(x->>'id', '') <> ''),
                  array['principal', 'almacen'])
$$;

-- Unidades por lugar de una talla/color (si no tiene, todo está en Larco)
create or replace function public.variant_stock_by(v jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(v->'stockBy') = 'object' then v->'stockBy'
              else jsonb_build_object('principal', coalesce(public.fly_num(v->>'stock'), 0)::int) end
$$;

-- El "cuadre": si el total cambió (venta, entrada, devolución, editor…) se ajusta el lugar que corresponde,
-- para que la suma por lugar siempre sea igual al total. Nunca deja un lugar en negativo.
create or replace function public.reconcile_stock_locations() returns trigger
language plpgsql security definer set search_path = public as $$
declare ctx jsonb; locs text[]; pref text; r record; sb jsonb; total int; delta int; take int; l text; order_l text[]; d jsonb := NEW.data;
begin
  begin ctx := coalesce(nullif(current_setting('fly.mov', true), ''), '{}')::jsonb; exception when others then ctx := '{}'::jsonb; end;
  locs := public.stock_locations(d);
  pref := coalesce(case when ctx->>'location' = any(locs) then ctx->>'location' end, case when ctx->>'store' = any(locs) then ctx->>'store' end, 'principal');
  for r in
    select (p.ord - 1)::int pi, (v.ord - 1)::int vi, v.val
      from jsonb_array_elements(coalesce(d->'products', '[]'::jsonb)) with ordinality p(val, ord),
           jsonb_array_elements(coalesce(p.val->'variants', '[]'::jsonb)) with ordinality v(val, ord)
     where jsonb_typeof(v.val->'stockBy') = 'object'
  loop
    sb := r.val->'stockBy';
    total := coalesce(public.fly_num(r.val->>'stock'), 0)::int;
    select total - coalesce(sum(greatest(coalesce(public.fly_num(value), 0), 0)), 0)::int into delta from jsonb_each_text(sb);
    if delta = 0 then continue; end if;
    if delta > 0 then
      sb := sb || jsonb_build_object(pref, coalesce((sb->>pref)::int, 0) + delta);
    else
      delta := -delta;
      order_l := array[pref, 'principal'] || locs || array(select jsonb_object_keys(sb));
      foreach l in array order_l loop
        exit when delta <= 0;
        take := least(delta, greatest(coalesce((sb->>l)::int, 0), 0));
        if take > 0 then sb := sb || jsonb_build_object(l, (sb->>l)::int - take); delta := delta - take; end if;
      end loop;
    end if;
    d := jsonb_set(d, array['products', r.pi::text, 'variants', r.vi::text, 'stockBy'], sb);
  end loop;
  NEW.data := d;
  return NEW;
end $$;
drop trigger if exists trg_reconcile_locations on public.store_data;
create trigger trg_reconcile_locations before insert or update on public.store_data for each row execute function public.reconcile_stock_locations();

-- ---------- Guías de traslado entre sedes ----------
create table if not exists public.stock_transfers (
  id bigint generated always as identity primary key,
  code text unique,
  from_loc text not null, to_loc text not null,
  items jsonb not null,                      -- [{variantId, productId, name, size, color, sku, qty, received}]
  status text not null default 'en_camino' check (status in ('en_camino', 'recibido', 'anulado')),
  note text,
  created_at timestamptz not null default now(), created_by text, created_user uuid,
  received_at timestamptz, received_by text, received_user uuid, receive_note text,
  voided_at timestamptz, voided_by text, void_reason text
);
alter table public.stock_transfers enable row level security;
revoke all on public.stock_transfers from anon, authenticated;
grant select on public.stock_transfers to authenticated;
drop policy if exists "guias_ver" on public.stock_transfers;
create policy "guias_ver" on public.stock_transfers for select
  using (public.has_role('superadmin', 'administrador', 'almacen', 'cajero', 'vendedora_tienda'));

-- Emitir la guía: las prendas salen de la sede de origen y quedan EN CAMINO (no se venden en ningún lado)
create or replace function public.create_transfer(p_from text, p_to text, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; locs text[]; it jsonb; pidx int; vidx int; v jsonb; p jsonb; sb jsonb; st int; avail int; q int;
        lines jsonb := '[]'::jsonb; n int; code text; t jsonb; tid bigint; prices jsonb := '{}'::jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'almacen', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then raise exception 'GUIA_VACIA'; end if;
  select data into d from public.store_data where id = 'main' for update;
  locs := public.stock_locations(d);
  if p_from = p_to or not (p_from = any(locs)) or not (p_to = any(locs)) then raise exception 'UBICACION_INVALIDA'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    q := coalesce(public.fly_num(it->>'qty'), 0)::int;
    if q <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    pidx := null;
    select (pp.ord - 1)::int, (vv.ord - 1)::int, vv.val, pp.val into pidx, vidx, v, p
      from jsonb_array_elements(d->'products') with ordinality pp(val, ord), jsonb_array_elements(pp.val->'variants') with ordinality vv(val, ord)
     where vv.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then raise exception 'PRODUCTO_NO_EXISTE'; end if;
    st := coalesce(public.fly_num(v->>'stock'), 0)::int;
    sb := public.variant_stock_by(v);
    avail := coalesce((sb->>p_from)::int, 0);
    if q > avail then raise exception 'STOCK_INSUFICIENTE:%:%', coalesce(p->>'name', '') || ' ' || coalesce(v->>'size', ''), avail; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'], sb || jsonb_build_object(p_from, avail - q));
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - q));
    lines := lines || jsonb_build_array(jsonb_build_object('variantId', v->>'id', 'productId', p->>'id', 'name', p->>'name', 'size', v->>'size',
      'color', v->>'colorName', 'sku', v->>'sku', 'qty', q, 'received', null));
  end loop;
  insert into public.doc_counters (serie, next_number) values ('T001', 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = 'T001' returning next_number - 1 into n;
  code := 'T001-' || lpad(n::text, 6, '0');
  perform public.set_stock_context(jsonb_build_object('type', 'traslado enviado', 'doc', code, 'staff', public.my_staff_name(),
    'location', p_from, 'store', p_from, 'note', 'En camino a ' || p_to || coalesce(' · ' || nullif(trim(p_note), ''), '')));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  insert into public.stock_transfers (code, from_loc, to_loc, items, note, created_by, created_user)
  values (code, p_from, p_to, lines, nullif(trim(coalesce(p_note, '')), ''), public.my_staff_name(), auth.uid())
  returning to_jsonb(stock_transfers.*) into t;
  perform public.audit('guia_emitida', jsonb_build_object('guia', code, 'de', p_from, 'a', p_to));
  return t;
end $$;

-- Recibir la guía en destino: suma lo que llegó; si falta algo, queda anotado como faltante
create or replace function public.receive_transfer(p_id bigint, p_received jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr public.stock_transfers; d jsonb; it jsonb; pidx int; vidx int; v jsonb; sb jsonb; st int; q int; got int;
        lines jsonb := '[]'::jsonb; t jsonb; missing int := 0;
begin
  if not public.has_role('superadmin', 'administrador', 'almacen', 'cajero', 'vendedora_tienda') then raise exception 'SIN_PERMISO'; end if;
  select * into tr from public.stock_transfers where id = p_id for update;
  if tr.id is null then raise exception 'GUIA_NO_EXISTE'; end if;
  if tr.status <> 'en_camino' then raise exception 'GUIA_YA_CERRADA:%', tr.status; end if;
  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(tr.items) loop
    q := (it->>'qty')::int;
    got := least(q, greatest(0, coalesce(public.fly_num(coalesce(p_received, '{}'::jsonb)->>(it->>'variantId')), q)::int));
    missing := missing + (q - got);
    pidx := null;
    select (pp.ord - 1)::int, (vv.ord - 1)::int, vv.val into pidx, vidx, v
      from jsonb_array_elements(d->'products') with ordinality pp(val, ord), jsonb_array_elements(pp.val->'variants') with ordinality vv(val, ord)
     where vv.val->>'id' = it->>'variantId' limit 1;
    if pidx is not null and got > 0 then
      st := coalesce(public.fly_num(v->>'stock'), 0)::int;
      sb := public.variant_stock_by(v);
      d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'], sb || jsonb_build_object(tr.to_loc, coalesce((sb->>tr.to_loc)::int, 0) + got));
      d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st + got));
    end if;
    lines := lines || jsonb_build_array(it || jsonb_build_object('received', got));
  end loop;
  if missing > 0 and coalesce(trim(p_note), '') = '' then raise exception 'MOTIVO_FALTANTE'; end if;
  perform public.set_stock_context(jsonb_build_object('type', 'traslado recibido', 'doc', tr.code, 'staff', public.my_staff_name(),
    'location', tr.to_loc, 'store', tr.to_loc, 'note', 'Llegó de ' || tr.from_loc || case when missing > 0 then ' · faltaron ' || missing else '' end));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  update public.stock_transfers set status = 'recibido', items = lines, received_at = now(), received_by = public.my_staff_name(),
         received_user = auth.uid(), receive_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id returning to_jsonb(stock_transfers.*) into t;
  perform public.audit('guia_recibida', jsonb_build_object('guia', tr.code, 'faltantes', missing));
  return t;
end $$;

-- Anular una guía que aún no llegó (error al emitirla): las prendas vuelven a la sede de origen
create or replace function public.cancel_transfer(p_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr public.stock_transfers; d jsonb; it jsonb; pidx int; vidx int; v jsonb; sb jsonb; st int; q int; t jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'almacen', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into tr from public.stock_transfers where id = p_id for update;
  if tr.id is null then raise exception 'GUIA_NO_EXISTE'; end if;
  if tr.status <> 'en_camino' then raise exception 'GUIA_YA_CERRADA:%', tr.status; end if;
  -- solo quien la emitió o Administración
  if tr.created_user is distinct from auth.uid() and not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(tr.items) loop
    q := (it->>'qty')::int; pidx := null;
    select (pp.ord - 1)::int, (vv.ord - 1)::int, vv.val into pidx, vidx, v
      from jsonb_array_elements(d->'products') with ordinality pp(val, ord), jsonb_array_elements(pp.val->'variants') with ordinality vv(val, ord)
     where vv.val->>'id' = it->>'variantId' limit 1;
    if pidx is not null then
      st := coalesce(public.fly_num(v->>'stock'), 0)::int; sb := public.variant_stock_by(v);
      d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'], sb || jsonb_build_object(tr.from_loc, coalesce((sb->>tr.from_loc)::int, 0) + q));
      d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st + q));
    end if;
  end loop;
  perform public.set_stock_context(jsonb_build_object('type', 'traslado anulado', 'doc', tr.code, 'staff', public.my_staff_name(),
    'location', tr.from_loc, 'store', tr.from_loc, 'note', 'Guía anulada: ' || trim(p_reason)));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  update public.stock_transfers set status = 'anulado', voided_at = now(), voided_by = public.my_staff_name(), void_reason = trim(p_reason)
   where id = p_id returning to_jsonb(stock_transfers.*) into t;
  perform public.audit('guia_anulada', jsonb_build_object('guia', tr.code, 'motivo', p_reason));
  return t;
end $$;
revoke execute on function public.create_transfer(text, text, jsonb, text) from public, anon;
revoke execute on function public.receive_transfer(bigint, jsonb, text) from public, anon;
revoke execute on function public.cancel_transfer(bigint, text) from public, anon;
grant execute on function public.create_transfer(text, text, jsonb, text) to authenticated;
grant execute on function public.receive_transfer(bigint, jsonb, text) to authenticated;
grant execute on function public.cancel_transfer(bigint, text) to authenticated;

-- Entradas/salidas/conteos ahora pueden decir en qué lugar
drop function if exists public.move_stock(text, text, int, text, int);
create or replace function public.move_stock(p_variant text, p_type text, p_qty int, p_note text default null, p_expected int default null, p_location text default null) returns int
language plpgsql security definer set search_path = public as $$
declare d jsonb; pidx int; vidx int; st int; nst int; pname text; sb jsonb; loc text; here int;
begin
  if not public.has_role('superadmin', 'administrador', 'almacen') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(p_qty, -1) < 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  select data into d from public.store_data where id = 'main' for update;
  select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int, p.val->>'name' into pidx, vidx, st, pname
    from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
   where v.val->>'id' = p_variant limit 1;
  if pidx is null then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  loc := nullif(trim(coalesce(p_location, '')), '');
  if loc is not null and not (loc = any(public.stock_locations(d))) then raise exception 'UBICACION_INVALIDA'; end if;
  sb := public.variant_stock_by(d->'products'->pidx->'variants'->vidx);
  here := coalesce((sb->>coalesce(loc, 'principal'))::int, 0);
  if p_type in ('entrada', 'devolucion') then nst := st + p_qty;
  elsif p_type in ('salida', 'merma', 'regalo') then
    if p_qty > st then raise exception 'STOCK_INSUFICIENTE:%', st; end if;
    if loc is not null and p_qty > here then raise exception 'STOCK_INSUFICIENTE:%', here; end if;   -- en ese lugar
    nst := st - p_qty;
  elsif p_type = 'ajuste' and loc is not null then
    -- Conteo de UN lugar (ej. contaste lo que hay en Casa): cambia solo ese lugar
    if p_expected is not null and p_expected <> here then raise exception 'STOCK_CAMBIO:%', here; end if;
    nst := st - here + p_qty;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'], sb || jsonb_build_object(loc, p_qty));
  elsif p_type = 'ajuste' then
    if p_expected is not null and p_expected <> st then raise exception 'STOCK_CAMBIO:%', st; end if;
    nst := p_qty;
  else raise exception 'TIPO_INVALIDO'; end if;
  perform public.set_stock_context(jsonb_build_object('type', case p_type when 'devolucion' then 'devolución' when 'ajuste' then 'ajuste (conteo)' else p_type end,
    'staff', public.my_staff_name(), 'note', nullif(trim(coalesce(p_note, '')), ''), 'location', loc, 'store', loc));
  d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(nst));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  perform public.log_stock_movements(jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    'productName', pname, 'variantId', p_variant, 'type', p_type, 'qty', abs(nst - st), 'note', p_note, 'staffName', public.my_staff_name(),
    'createdAt', (extract(epoch from now()) * 1000)::bigint)));
  return nst;
end $$;
revoke execute on function public.move_stock(text, text, int, text, int, text) from public, anon;
grant execute on function public.move_stock(text, text, int, text, int, text) to authenticated;

-- Guardar catálogo: conserva dónde está cada unidad (lo decide el servidor)
create or replace function public.save_catalog(p_data jsonb, p_stock_deltas jsonb default '{}'::jsonb, p_changed text[] default null,
                                               p_deleted text[] default null, p_keys text[] default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb; stocks jsonb; sbmap jsonb; prods jsonb; base jsonb; k text; cur_by_id jsonb;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_data->'products') <> 'array' then raise exception 'CATALOGO_INVALIDO'; end if;
  select data into cur from public.store_data where id = 'main' for update;

  select coalesce(jsonb_object_agg(v->>'id', coalesce(public.fly_num(v->>'stock'), 0)), '{}'::jsonb) into stocks
    from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
   where v->>'id' is not null;
  -- Dónde está cada unidad (Larco / Almacén): lo manda el servidor, nunca la pantalla de quien guarda
  select coalesce(jsonb_object_agg(v->>'id', v->'stockBy'), '{}'::jsonb) into sbmap
    from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
   where v->>'id' is not null and jsonb_typeof(v->'stockBy') = 'object';
  select coalesce(jsonb_object_agg(p->>'id', p), '{}'::jsonb) into cur_by_id
    from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) p where p->>'id' is not null;

  -- Productos: los que esta persona cambió se toman de ella (respetando el stock real);
  -- los demás se dejan como están en el servidor (así no se pisan los cambios de otra persona).
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb) into prods from (
    select y.po as ord,
      case
        when p_changed is null or (y.p->>'id') = any(p_changed) or not (cur_by_id ? (y.p->>'id')) then
          case when jsonb_typeof(y.p->'variants') = 'array' then y.p || jsonb_build_object('variants', (
            select coalesce(jsonb_agg(case when v->>'id' is not null and stocks ? (v->>'id')
                     then (v - 'stockBy') || jsonb_build_object('stock', greatest(0, (stocks->>(v->>'id'))::numeric + coalesce(public.fly_num(coalesce(p_stock_deltas, '{}'::jsonb)->>(v->>'id')), 0))::int)
                          || case when sbmap ? (v->>'id') then jsonb_build_object('stockBy', sbmap->(v->>'id')) else '{}'::jsonb end
                     else v - 'stockBy' end order by vo), '[]'::jsonb)
              from jsonb_array_elements(y.p->'variants') with ordinality x(v, vo)))
          else y.p end
        else cur_by_id->(y.p->>'id')
      end as item
    from jsonb_array_elements(p_data->'products') with ordinality y(p, po)
    where p_changed is null or (y.p->>'id') = any(p_changed) or cur_by_id ? (y.p->>'id')
    union all
    -- productos que otra persona creó mientras tanto (no estaban en la pantalla de quien guarda)
    select 1000000 + c.ord, c.p from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) with ordinality c(p, ord)
     where p_changed is not null and not ((c.p->>'id') = any(coalesce(p_deleted, '{}')))
       and not exists (select 1 from jsonb_array_elements(p_data->'products') z where z->>'id' = c.p->>'id')
  ) t where item is not null;

  if p_changed is null then
    base := coalesce(cur, '{}'::jsonb) || p_data;            -- versión anterior de la app: guarda todo
  else
    base := coalesce(cur, '{}'::jsonb);                       -- solo las secciones que esta persona cambió
    foreach k in array coalesce(p_keys, '{}') loop
      if k <> 'products' and p_data ? k then base := jsonb_set(base, array[k], p_data->k, true); end if;
    end loop;
  end if;
  base := base || jsonb_build_object('products', prods);

  -- Candados contra errores de tipeo (los revisa el servidor, no solo la pantalla)
  if exists (select 1 from jsonb_array_elements(prods) p
              where p_changed is null or (p->>'id') = any(p_changed) or not (cur_by_id ? (p->>'id')))
     and exists (select 1 from jsonb_array_elements(prods) p
              where (p_changed is null or (p->>'id') = any(p_changed) or not (cur_by_id ? (p->>'id')))
                and (public.fly_num(p->>'price') is null or public.fly_num(p->>'price') < 0 or public.fly_num(p->>'price') > 100000
                     or coalesce(public.fly_num(p->>'compareAtPrice'), 0) < 0)) then
    raise exception 'PRECIO_INVALIDO';
  end if;
  select x.sku into k from (
    select upper(trim(v->>'sku')) sku, count(*) n, bool_or(p_changed is null or (p->>'id') = any(p_changed) or not (cur_by_id ? (p->>'id'))) mine
      from jsonb_array_elements(prods) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
     where coalesce(trim(v->>'sku'), '') <> ''
     group by 1) x
   where x.n > 1 and x.mine
     -- solo si el repetido es NUEVO (si ya estaba repetido de antes, no se bloquea editar otras cosas)
     and x.n > (select count(*) from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) cp, jsonb_array_elements(coalesce(cp->'variants', '[]'::jsonb)) cv
                 where upper(trim(cv->>'sku')) = x.sku)
   limit 1;
  if k is not null then raise exception 'CODIGO_REPETIDO:%', k; end if;

  perform public.set_stock_context(jsonb_build_object('type', 'catálogo', 'staff', public.my_staff_name(), 'note', coalesce(nullif(trim(p_note), ''), 'Cambio desde el editor de productos')));
  if cur is null then
    insert into public.store_data (id, data, updated_at) values ('main', base, now());
  else
    update public.store_data set data = base, updated_at = now() where id = 'main';
  end if;
end $$;
grant execute on function public.save_catalog(jsonb, jsonb, text[], text[], text[], text) to authenticated;
