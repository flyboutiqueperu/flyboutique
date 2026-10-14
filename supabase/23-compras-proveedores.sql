-- =====================================================================
--  FLY BOUTIQUE — 23: COMPRAS A PROVEEDORES
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 22. Después, Merge del PR.
--  - suppliers: lista de proveedores (nombre, RUC, celular, contacto).
--  - purchases: cada compra (C001-000001) con proveedor, N.° de su factura, sede donde entra, prendas, cantidades y costo.
--  - Registrar una compra suma el stock en la sede elegida (queda en el historial como «compra») y,
--    si se marca, actualiza el costo de la prenda con el promedio ponderado (lo que ya había + lo que llegó).
--  - Anular una compra saca esas prendas del stock (solo si todavía están en esa sede). No cambia el costo ya calculado.
--  Solo Super Admin y Administración (los costos son privados). No borra datos.
--  Para volver atrás: 23-compras-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(name) between 2 and 120),
  ruc text check (ruc is null or ruc ~ '^[0-9]{8,11}$'),
  phone text check (char_length(phone) <= 20), contact text check (char_length(contact) <= 80), note text check (char_length(note) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by text
);
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  code text unique, request_id text unique,
  supplier_id bigint references public.suppliers(id), supplier_name text,
  doc_ref text, location text not null, items jsonb not null, total numeric not null default 0,
  note text, update_cost boolean not null default true,
  status text not null default 'recibida' check (status in ('recibida', 'anulada')),
  created_at timestamptz not null default now(), created_by text,
  voided_at timestamptz, voided_by text, void_reason text
);
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
revoke all on public.suppliers from anon, authenticated;
revoke all on public.purchases from anon, authenticated;
grant select on public.suppliers to authenticated;
grant select on public.purchases to authenticated;
drop policy if exists "proveedores_ver" on public.suppliers;
drop policy if exists "compras_ver" on public.purchases;
create policy "proveedores_ver" on public.suppliers for select using (public.has_role('superadmin', 'administrador'));
create policy "compras_ver" on public.purchases for select using (public.has_role('superadmin', 'administrador'));

-- Crear o editar un proveedor
create or replace function public.upsert_supplier(p_id bigint, p_name text, p_ruc text, p_phone text, p_contact text, p_note text, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.suppliers;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_id is null then
    insert into public.suppliers (name, ruc, phone, contact, note, active, created_by)
    values (trim(p_name), nullif(trim(coalesce(p_ruc, '')), ''), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_contact, '')), ''), nullif(trim(coalesce(p_note, '')), ''), coalesce(p_active, true), public.my_staff_name())
    returning * into r;
  else
    update public.suppliers set name = trim(p_name), ruc = nullif(trim(coalesce(p_ruc, '')), ''), phone = nullif(trim(coalesce(p_phone, '')), ''),
           contact = nullif(trim(coalesce(p_contact, '')), ''), note = nullif(trim(coalesce(p_note, '')), ''), active = coalesce(p_active, true)
     where id = p_id returning * into r;
    if r.id is null then raise exception 'PROVEEDOR_NO_EXISTE'; end if;
  end if;
  return to_jsonb(r);
exception when unique_violation then raise exception 'PROVEEDOR_REPETIDO';
end $$;
revoke execute on function public.upsert_supplier(bigint, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.upsert_supplier(bigint, text, text, text, text, text, boolean) to authenticated;

-- Registrar una compra: suma stock en la sede y (opcional) actualiza el costo promedio
create or replace function public.register_purchase(p_supplier_id bigint, p_doc_ref text, p_location text, p_items jsonb, p_note text default null,
                                                    p_update_cost boolean default true, p_request_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; it jsonb; pidx int; vidx int; v jsonb; p jsonb; sb jsonb; st int; q int; c numeric; lines jsonb := '[]'::jsonb; tot numeric := 0;
        sup public.suppliers; n int; code text; t jsonb; prev jsonb; loc text := trim(coalesce(p_location, '')); prod record;
        old_cost numeric; old_stock int; add_q int; add_cost numeric; movs jsonb := '[]'::jsonb;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(p_request_id, '') <> '' then
    select to_jsonb(x.*) into prev from public.purchases x where request_id = p_request_id;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 300 then raise exception 'COMPRA_VACIA'; end if;
  select * into sup from public.suppliers where id = p_supplier_id;
  if sup.id is null then raise exception 'PROVEEDOR_NO_EXISTE'; end if;
  select data into d from public.store_data where id = 'main' for update;
  if not (loc = any(public.stock_locations(d))) then raise exception 'UBICACION_INVALIDA'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    q := coalesce(public.fly_num(it->>'qty'), 0)::int;
    c := round(coalesce(public.fly_num(it->>'unitCost'), -1), 2);
    if q <= 0 or q > 10000 then raise exception 'CANTIDAD_INVALIDA'; end if;
    if c < 0 or c >= 100000 then raise exception 'COSTO_INVALIDO'; end if;
    pidx := null;
    select (pp.ord - 1)::int, (vv.ord - 1)::int, vv.val, pp.val into pidx, vidx, v, p
      from jsonb_array_elements(d->'products') with ordinality pp(val, ord), jsonb_array_elements(pp.val->'variants') with ordinality vv(val, ord)
     where vv.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then raise exception 'PRODUCTO_NO_EXISTE'; end if;
    st := coalesce(public.fly_num(v->>'stock'), 0)::int;
    sb := public.variant_stock_by(v);   -- se anota en qué sede entra (si no tenía, lo que había cuenta como Larco)
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'], sb || jsonb_build_object(loc, coalesce((sb->>loc)::int, 0) + q));
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st + q));
    lines := lines || jsonb_build_array(jsonb_build_object('variantId', v->>'id', 'productId', p->>'id', 'name', p->>'name', 'size', v->>'size',
      'color', v->>'colorName', 'sku', v->>'sku', 'qty', q, 'unitCost', c, 'stockBefore', st));
    movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
      'productId', p->>'id', 'productName', p->>'name', 'variantId', v->>'id', 'size', v->>'size', 'colorName', v->>'colorName',
      'type', 'entrada', 'qty', q, 'note', 'Compra a ' || sup.name, 'staffName', public.my_staff_name(), 'createdAt', (extract(epoch from now()) * 1000)::bigint));
    tot := tot + q * c;
  end loop;

  insert into public.doc_counters (serie, next_number) values ('C001', 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = 'C001' returning next_number - 1 into n;
  code := 'C001-' || lpad(n::text, 6, '0');

  -- Costo promedio ponderado por prenda (con el stock que había ANTES de esta compra)
  if coalesce(p_update_cost, true) then
    for prod in select x->>'productId' pid, sum((x->>'qty')::int) q, sum((x->>'qty')::int * (x->>'unitCost')::numeric) cst,
                       min(x->>'name') nm
                  from jsonb_array_elements(lines) x group by 1 loop
      select cost into old_cost from public.product_costs where product_id = prod.pid;
      select coalesce(sum(coalesce(public.fly_num(vv->>'stock'), 0)), 0)::int into old_stock
        from jsonb_array_elements(d->'products') pp, jsonb_array_elements(pp->'variants') vv where pp->>'id' = prod.pid;
      old_stock := greatest(old_stock - prod.q, 0);   -- d ya tiene sumada la compra
      add_q := prod.q; add_cost := prod.cst;
      insert into public.product_costs (product_id, cost, supplier)
      values (prod.pid, round(case when old_cost is null or old_stock = 0 then add_cost / add_q
                                   else (old_cost * old_stock + add_cost) / (old_stock + add_q) end, 2), sup.name)
      on conflict (product_id) do update set cost = excluded.cost, supplier = excluded.supplier;
    end loop;
  end if;

  perform public.set_stock_context(jsonb_build_object('type', 'compra', 'doc', code, 'staff', public.my_staff_name(), 'location', loc, 'store', loc,
    'note', 'Compra a ' || sup.name || coalesce(' · factura ' || nullif(trim(p_doc_ref), ''), '')));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  perform public.log_stock_movements(movs);
  insert into public.purchases (code, request_id, supplier_id, supplier_name, doc_ref, location, items, total, note, update_cost, created_by)
  values (code, nullif(p_request_id, ''), sup.id, sup.name, nullif(trim(coalesce(p_doc_ref, '')), ''), loc, lines, round(tot, 2),
          nullif(trim(coalesce(p_note, '')), ''), coalesce(p_update_cost, true), public.my_staff_name())
  returning to_jsonb(purchases.*) into t;
  perform public.audit('compra_registrada', jsonb_build_object('compra', code, 'proveedor', sup.name, 'total', round(tot, 2)));
  return t;
end $$;
revoke execute on function public.register_purchase(bigint, text, text, jsonb, text, boolean, text) from public, anon;
grant execute on function public.register_purchase(bigint, text, text, jsonb, text, boolean, text) to authenticated;

-- Anular una compra (ej. se registró por error): saca las prendas de esa sede si todavía están
create or replace function public.void_purchase(p_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pu public.purchases; d jsonb; it jsonb; pidx int; vidx int; v jsonb; sb jsonb; st int; q int; here int; t jsonb;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into pu from public.purchases where id = p_id for update;
  if pu.id is null then raise exception 'COMPRA_NO_EXISTE'; end if;
  if pu.status = 'anulada' then return to_jsonb(pu); end if;
  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(pu.items) loop
    q := (it->>'qty')::int; pidx := null;
    select (pp.ord - 1)::int, (vv.ord - 1)::int, vv.val into pidx, vidx, v
      from jsonb_array_elements(d->'products') with ordinality pp(val, ord), jsonb_array_elements(pp.val->'variants') with ordinality vv(val, ord)
     where vv.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then continue; end if;
    st := coalesce(public.fly_num(v->>'stock'), 0)::int;
    sb := public.variant_stock_by(v);
    here := coalesce((sb->>pu.location)::int, 0);
    if q > here or q > st then raise exception 'STOCK_INSUFICIENTE:%:%', coalesce(it->>'name', '') || ' ' || coalesce(it->>'size', ''), least(here, st); end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stockBy'], sb || jsonb_build_object(pu.location, here - q));
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - q));
  end loop;
  perform public.set_stock_context(jsonb_build_object('type', 'compra anulada', 'doc', pu.code, 'staff', public.my_staff_name(),
    'location', pu.location, 'store', pu.location, 'note', 'Compra anulada: ' || trim(p_reason)));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  update public.purchases set status = 'anulada', voided_at = now(), voided_by = public.my_staff_name(), void_reason = trim(p_reason)
   where id = p_id returning to_jsonb(purchases.*) into t;
  perform public.audit('compra_anulada', jsonb_build_object('compra', pu.code, 'motivo', p_reason));
  return t;
end $$;
revoke execute on function public.void_purchase(bigint, text) from public, anon;
grant execute on function public.void_purchase(bigint, text) to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select count(*) from public.suppliers; select count(*) from public.purchases;
-- =====================================================================
