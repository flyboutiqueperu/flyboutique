-- =====================================================================
--  FLY BOUTIQUE — 14: HISTORIAL DE CADA PRENDA Y "QUE NADIE PISE A NADIE"
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Después, Merge del PR.
--  - Historial automático: cada cambio de stock queda registrado (antes/después, precio, comprobante,
--    clienta, vendedora, quién lo hizo, cuándo). Lo registra la base de datos: no se escapa nada.
--  - Catálogo: se guarda producto por producto (dos personas editando no se pisan).
--  - Stock: entradas/salidas suman o restan; el conteo avisa si alguien vendió mientras contabas.
--  - Caja: se bloquea mientras alguien la cierra o mueve dinero.
--  No borra datos. Copia el historial anterior al nuevo. Para volver atrás: 14-historial-VOLVER-ATRAS.sql
-- =====================================================================

-- ---------- Tabla del historial (solo se escribe desde el servidor) ----------
create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  product_id text, product_name text, variant_id text, size text, color text, sku text,
  type text not null, qty int not null, stock_before int, stock_after int,
  unit_price numeric, doc text, sale_id text, customer text, seller text, staff_name text, user_id uuid,
  store_id text, channel text, note text, source text not null default 'sistema'
);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);
alter table public.stock_movements enable row level security;
drop policy if exists "historial_ver" on public.stock_movements;
create policy "historial_ver" on public.stock_movements for select using (public.has_role('superadmin', 'administrador', 'almacen'));
revoke all on public.stock_movements from anon, authenticated;
grant select on public.stock_movements to authenticated;

-- Contexto del cambio (lo ponen las funciones antes de tocar el stock; dura solo esa operación)
create or replace function public.set_stock_context(p_ctx jsonb) returns void
language sql as $$ select set_config('fly.mov', p_ctx::text, true) $$;
revoke execute on function public.set_stock_context(jsonb) from public, anon, authenticated;

-- ---------- El "vigilante": anota cada variante cuyo stock cambió ----------
create or replace function public.track_stock_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare ctx jsonb; old_map jsonb; r record;
begin
  begin ctx := coalesce(nullif(current_setting('fly.mov', true), ''), '{}')::jsonb; exception when others then ctx := '{}'::jsonb; end;
  select coalesce(jsonb_object_agg(v->>'id', coalesce(public.fly_num(v->>'stock'), 0)), '{}'::jsonb) into old_map
    from jsonb_array_elements(coalesce(OLD.data->'products', '[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
   where v->>'id' is not null;
  for r in
    select p->>'id' pid, p->>'name' pname, v->>'id' vid, v->>'size' sz, v->>'colorName' col, v->>'sku' sku,
           public.fly_num(p->>'price') price, coalesce(public.fly_num(v->>'stock'), 0)::int after_s,
           case when old_map ? (v->>'id') then (old_map->>(v->>'id'))::numeric::int end before_s
      from jsonb_array_elements(coalesce(NEW.data->'products', '[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
     where v->>'id' is not null
  loop
    if r.before_s is null and r.after_s = 0 then continue; end if;
    if r.before_s is not null and r.before_s = r.after_s then continue; end if;
    insert into public.stock_movements (product_id, product_name, variant_id, size, color, sku, type, qty, stock_before, stock_after,
      unit_price, doc, sale_id, customer, seller, staff_name, user_id, store_id, channel, note, source)
    values (r.pid, r.pname, r.vid, r.sz, r.col, r.sku,
      case when r.before_s is null then 'alta (nueva talla/color)' else coalesce(ctx->>'type', 'ajuste') end,
      r.after_s - coalesce(r.before_s, 0), r.before_s, r.after_s,
      coalesce(public.fly_num(ctx->'prices'->>r.vid), r.price), ctx->>'doc', ctx->>'saleId', ctx->>'customer', ctx->>'seller',
      coalesce(ctx->>'staff', public.my_staff_name()), auth.uid(), ctx->>'store', ctx->>'channel', ctx->>'note', coalesce(ctx->>'source', 'sistema'));
  end loop;
  return NEW;
end $$;
drop trigger if exists trg_stock_changes on public.store_data;
create trigger trg_stock_changes after update on public.store_data for each row execute function public.track_stock_changes();

-- ---------- Copiar el historial que ya existía (una sola vez) ----------
insert into public.stock_movements (created_at, product_id, product_name, variant_id, size, color, type, qty, staff_name, store_id, note, source)
select coalesce(to_timestamp((m->>'createdAt')::numeric / 1000), now()), m->>'productId', m->>'productName', m->>'variantId', m->>'size', m->>'colorName',
       coalesce(m->>'type', 'movimiento'),
       case when m->>'type' in ('venta', 'salida', 'merma') then -abs(coalesce(public.fly_num(m->>'qty'), 0))::int else coalesce(public.fly_num(m->>'qty'), 0)::int end,
       m->>'staffName', m->>'storeId', m->>'note', 'historial anterior'
  from public.store_private sp, jsonb_array_elements(coalesce(sp.data->'stockMovements', '[]'::jsonb)) m
 where sp.id = 'main' and not exists (select 1 from public.stock_movements where source = 'historial anterior');

-- ---------- Mover stock sumando o restando (no con el total que se ve en pantalla) ----------
-- entrada/devolución: suma · salida/merma (dañada, no vendible)/regalo: resta · ajuste (conteo): pone el número contado, pero si el stock
-- cambió mientras contabas (alguien vendió), avisa en vez de pisarlo.
create or replace function public.move_stock(p_variant text, p_type text, p_qty int, p_note text default null, p_expected int default null) returns int
language plpgsql security definer set search_path = public as $$
declare d jsonb; pidx int; vidx int; st int; nst int; pname text;
begin
  if not public.has_role('superadmin', 'administrador', 'almacen') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(p_qty, -1) < 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
  select data into d from public.store_data where id = 'main' for update;
  select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int, p.val->>'name' into pidx, vidx, st, pname
    from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
   where v.val->>'id' = p_variant limit 1;
  if pidx is null then raise exception 'PRODUCTO_NO_EXISTE'; end if;
  if p_type in ('entrada', 'devolucion') then nst := st + p_qty;
  elsif p_type in ('salida', 'merma', 'regalo') then
    if p_qty > st then raise exception 'STOCK_INSUFICIENTE:%', st; end if;
    nst := st - p_qty;
  elsif p_type = 'ajuste' then
    if p_expected is not null and p_expected <> st then raise exception 'STOCK_CAMBIO:%', st; end if;
    nst := p_qty;
  else raise exception 'TIPO_INVALIDO'; end if;
  perform public.set_stock_context(jsonb_build_object('type', case p_type when 'devolucion' then 'devolución' when 'ajuste' then 'ajuste (conteo)' else p_type end,
    'staff', public.my_staff_name(), 'note', nullif(trim(coalesce(p_note, '')), '')));
  d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(nst));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  perform public.log_stock_movements(jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
    'productName', pname, 'variantId', p_variant, 'type', p_type, 'qty', abs(nst - st), 'note', p_note, 'staffName', public.my_staff_name(),
    'createdAt', (extract(epoch from now()) * 1000)::bigint)));
  return nst;
end $$;
revoke execute on function public.move_stock(text, text, int, text, int) from public, anon;
grant execute on function public.move_stock(text, text, int, text, int) to authenticated;

-- ---------- Funciones que mueven stock: ahora dicen qué operación es (para el historial) ----------
create or replace function public.pos_sale(p_sale jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int;
  sub numeric := 0; disc numeric; tot numeric; v_serie text; n int; sid text; sale jsonb; prev jsonb;
  movs jsonb := '[]'::jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  ph text; earned int := 0; l jsonb; sps numeric; pps numeric; paid numeric; v_seller text; v_cashier text;
  promo jsonb; promo_disc numeric := 0; used int; bp numeric; bv numeric; pdisc numeric := 0; cpts int; manual numeric; cap numeric;
  is_store boolean := coalesce(p_sale->>'channel', 'tienda') <> 'online'; v_store text; cash_id uuid; seller record; v_seller_code text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'VENTA_VACIA'; end if;

  -- Reintento de la misma venta: se devuelve la ya guardada, no se duplica
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data ? 'clientRequestId' and data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  v_cashier := public.my_staff_name();
  v_store := coalesce(nullif(trim(p_sale->>'storeId'), ''), 'principal');
  if is_store then
    -- Venta en tienda: tiene que haber una caja abierta en esa sede
    select id into cash_id from public.cash_sessions where store_id = v_store and status = 'abierta' order by opened_at desc limit 1;
    if cash_id is null then raise exception 'CAJA_CERRADA'; end if;
    -- Quién vendió: su código (ej. MA01). El código identifica a la vendedora, no da permisos.
    select * into seller from public.sellers where code = upper(trim(coalesce(p_sale->>'sellerCode', ''))) and active;
    if seller.code is not null then
      v_seller := seller.name; v_seller_code := seller.code;
    elsif exists (select 1 from public.sellers where active) then
      raise exception 'VENDEDOR_INVALIDO';
    end if;
  end if;
  if v_seller is null then
    -- Sin códigos creados todavía (o venta online): la vendedora elegida debe ser del staff activo; si no, quien cobra
    v_seller := p_sale->>'staffName';
    if v_seller is null or not exists (select 1 from public.staff_profiles where name = v_seller and coalesce(active, true)) then
      v_seller := v_cashier;
    end if;
  end if;

  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    pidx := null; vidx := null; st := null; pr := null;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0), (p.val->>'price')::numeric
      into pidx, vidx, st, pr
      from jsonb_array_elements(d->'products') with ordinality p(val, ord),
           jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null then raise exception 'PRODUCTO_NO_EXISTE:%', it->>'name'; end if;
    if st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from (it->>'unitPrice')::numeric then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
    movs := movs || jsonb_build_array(jsonb_build_object(
      'id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
      'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId',
      'size', it->'size', 'colorName', it->'colorName', 'type', 'venta', 'qty', qty,
      'staffName', v_seller, 'storeId', p_sale->'storeId', 'createdAt', now_ms));
  end loop;

  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');

  -- Código promocional: lo calcula el servidor
  if coalesce(trim(p_sale->>'promoCode'), '') <> '' then
    select x into promo from jsonb_array_elements(coalesce(d->'promoCodes', '[]'::jsonb)) x
     where coalesce((x->>'active')::boolean, false) and lower(x->>'code') = lower(trim(p_sale->>'promoCode')) limit 1;
    if promo is null then raise exception 'PROMO_INVALIDA'; end if;
    if promo->>'type' = 'percent' then
      promo_disc := floor(sub::float8 * (coalesce(public.fly_num(promo->>'value'), 0)::float8 / 100) + 0.5)::numeric;
    else
      promo_disc := least(coalesce(public.fly_num(promo->>'value'), 0), sub);
    end if;
  end if;

  -- Puntos usados en tienda (la clienta está presente): se revisan y se descuentan ya
  used := coalesce(public.fly_num(p_sale->>'pointsUsed'), 0)::int;
  if used > 0 and not public.club_enabled(d) then raise exception 'CLUB_DESACTIVADO'; end if;
  if used > 0 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    bp := greatest(1, coalesce(nullif(public.fly_num(l->>'blockPoints'), 0), 100));
    bv := case when l ? 'blockValue' then coalesce(public.fly_num(l->>'blockValue'), 0) else 3 end;
    if bv <= 0 or used % bp::int <> 0 or length(ph) < 7 then raise exception 'PUNTOS_INVALIDOS'; end if;
    pdisc := (used / bp::int) * bv;
    if pdisc > sub - promo_disc then raise exception 'PUNTOS_INVALIDOS'; end if;
    select coalesce((data->>'points')::int, 0) into cpts from public.customers where phone = ph for update;
    if cpts is null or cpts < used then raise exception 'PUNTOS_INSUFICIENTES'; end if;
    update public.customers set data = jsonb_set(data, '{points}', to_jsonb(cpts - used)) where phone = ph;
  end if;

  disc := least(greatest(coalesce((p_sale->>'discount')::numeric, 0), 0), sub);
  if disc + 0.01 < promo_disc + pdisc then raise exception 'DESCUENTO_INVALIDO'; end if;
  -- Descuento manual: las vendedoras tienen un tope (Panel → ajustes; 20% si no se configuró). Administración no tiene tope.
  manual := disc - promo_disc - pdisc;
  if manual > 0 and not public.has_role('superadmin', 'administrador') then
    cap := coalesce(public.fly_num(d->'settings'->>'posMaxDiscountPct'), 20);
    if manual > round(sub * cap / 100, 2) + 0.01 then raise exception 'DESCUENTO_EXCEDE:%', cap; end if;
  end if;
  tot := round(sub - disc, 2);
  if p_sale ? 'payments' and jsonb_typeof(p_sale->'payments') = 'array' and jsonb_array_length(p_sale->'payments') > 0 then
    select coalesce(sum((x->>'amount')::numeric), 0) into paid from jsonb_array_elements(p_sale->'payments') x;
    if abs(paid - tot) > 0.01 then raise exception 'PAGO_INCOMPLETO'; end if;
  end if;

  v_serie := case when p_sale->>'tipo' = 'factura' then 'F001' else 'B001' end;
  insert into public.doc_counters (serie, next_number) values (v_serie, 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = v_serie returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);

  -- Historial de stock: qué venta es, a quién, quién vendió y a qué precio
  perform public.set_stock_context(jsonb_build_object('type', 'venta', 'doc', v_serie || '-' || lpad(n::text, 6, '0'), 'saleId', sid,
    'customer', nullif(trim(coalesce(p_sale->>'customerName', '') || ' ' || coalesce(p_sale->>'customerDoc', '')), ''),
    'seller', case when v_seller_code is not null then v_seller_code || ' · ' || v_seller else v_seller end, 'staff', v_cashier,
    'store', case when is_store then v_store else 'web' end, 'channel', coalesce(p_sale->>'channel', 'tienda'),
    'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(p_sale->'items') x)));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  sale := p_sale || jsonb_build_object('id', sid, 'serie', v_serie, 'numero', n, 'subtotal', sub, 'discount', disc, 'total', tot,
           'status', 'emitido', 'source', 'pos', 'staffUserId', auth.uid()::text, 'staffName', v_seller, 'cashierName', v_cashier,
           'pointsUsed', used, 'pointsDiscount', pdisc, 'pointsDeducted', used > 0, 'manualDiscount', greatest(manual, 0),
           'cashSessionId', cash_id, 'sellerCode', v_seller_code, 'storeId', case when is_store then v_store else p_sale->'storeId' #>> '{}' end,
           'createdAt', now_ms);
  insert into public.sales (id, data) values (sid, sale);

  perform public.log_stock_movements((select coalesce(jsonb_agg(m || jsonb_build_object('note', 'Venta ' || v_serie || '-' || lpad(n::text, 6, '0'))), '[]'::jsonb) from jsonb_array_elements(movs) m));

  -- Clienta y puntos (si dio su celular)
  if length(ph) >= 7 and not coalesce((p_sale->>'anonymous')::boolean, false) then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    earned := case when public.club_enabled(d) then (floor(greatest(tot, 0) / sps) * pps)::int else 0 end;
    if exists (select 1 from public.customers where phone = ph) then
      update public.customers
         set data = data || jsonb_build_object('points', coalesce((data->>'points')::int, 0) + earned)
                  || case when coalesce(data->>'doc', '') = '' then jsonb_build_object('doc', coalesce(p_sale->>'customerDoc', '')) else '{}'::jsonb end
                  || case when coalesce(data->>'email', '') = '' then jsonb_build_object('email', coalesce(p_sale->>'customerEmail', '')) else '{}'::jsonb end
       where phone = ph;
    else
      insert into public.customers (phone, data) values (ph, jsonb_build_object(
        'id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', coalesce(p_sale->>'customerName', ''), 'phone', ph,
        'doc', coalesce(p_sale->>'customerDoc', ''), 'email', coalesce(p_sale->>'customerEmail', ''),
        'points', earned, 'via', 'tienda', 'createdAt', now_ms));
    end if;
  end if;
  sale := sale || jsonb_build_object('earnedPoints', earned);
  update public.sales set data = sale where id = sid;
  return sale;
end $$;


-- ---------- 5. Cambiar el nombre de usuario del staff sin borrar la cuenta (solo Super Admin) ----------
-- El usuario es la primera parte del correo interno con el que entra (usuario@staff.flyboutique.pe).
-- Se cambia en los dos sitios a la vez; la contraseña y la verificación en dos pasos no cambian.
create or replace function public.staff_set_username(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare u text := lower(trim(coalesce(p_username, ''))); em text;
begin
  if not public.has_role('superadmin') then raise exception 'SIN_PERMISO'; end if;
  if u !~ '^[a-z0-9._-]{3,30}$' then raise exception 'USUARIO_INVALIDO'; end if;
  if not exists (select 1 from public.staff_profiles where user_id = p_user) then raise exception 'USUARIO_NO_EXISTE'; end if;
  em := u || '@staff.flyboutique.pe';
  if exists (select 1 from auth.users where lower(email) = em and id <> p_user)
     or exists (select 1 from public.staff_profiles where lower(username) = u and user_id <> p_user) then
    raise exception 'USUARIO_EXISTE';
  end if;
  update auth.users set email = em, updated_at = now() where id = p_user;
  update auth.identities set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', em), updated_at = now()
   where user_id = p_user and provider = 'email';
  update public.staff_profiles set username = u where user_id = p_user;
  perform public.audit('usuario_renombrado', jsonb_build_object('user', p_user, 'username', u));
end $$;
revoke execute on function public.staff_set_username(uuid, text) from public, anon;
grant execute on function public.staff_set_username(uuid, text) to authenticated;


create or replace function public.place_order(p_sale jsonb, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; it jsonb; pidx int; vidx int; st int; pr numeric; qty int; n int; sale jsonb; sid text; prev jsonb;
  em text; gkey text; ph text; gpts int; crow jsonb; is_google boolean;
  sub numeric := 0; disc numeric := 0; ship numeric := 0; pdisc numeric := 0; tot numeric; client_tot numeric;
  promo jsonb; l jsonb; bp numeric; bv numeric; used int; cpts int; dm text; dep text;
begin
  if pg_column_size(p_sale) > 60000 then raise exception 'PEDIDO_INVALIDO'; end if;
  if jsonb_typeof(p_sale->'items') <> 'array' or jsonb_array_length(p_sale->'items') = 0 then raise exception 'PEDIDO_VACIO'; end if;

  -- Reintento del mismo pedido (se cortó internet): se devuelve el ya guardado
  if coalesce(p_sale->>'clientRequestId', '') <> '' then
    select data into prev from public.sales where data ? 'clientRequestId' and data->>'clientRequestId' = p_sale->>'clientRequestId' limit 1;
    if prev is not null then return prev || jsonb_build_object('duplicate', true); end if;
  end if;

  em := lower(coalesce(auth.jwt()->>'email', ''));
  is_google := public.google_email() <> '';   -- cuenta confirmada (Google; desde el SQL 15 también código al correo)
  ph := regexp_replace(coalesce(p_sale->>'customerPhone', ''), '\D', '', 'g');

  -- Stock y precios reales (bloqueando el catálogo para que nadie compre la misma unidad a la vez)
  select data into d from public.store_data where id = 'main' for update;
  for it in select * from jsonb_array_elements(p_sale->'items') loop
    qty := coalesce((it->>'qty')::int, 0);
    if qty <= 0 or qty > 50 then raise exception 'PEDIDO_INVALIDO'; end if;
    pidx := null; vidx := null; st := null; pr := null;
    select (p.ord - 1)::int, (v.ord - 1)::int, coalesce(public.fly_num(v.val->>'stock'), 0)::int, public.fly_num(p.val->>'price')
      into pidx, vidx, st, pr
      from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
     where v.val->>'id' = it->>'variantId' limit 1;
    if pidx is null or st < qty then raise exception 'SIN_STOCK:%', it->>'name'; end if;
    if pr is distinct from public.fly_num(it->>'unitPrice') then raise exception 'PRECIO_CAMBIO:%', it->>'name'; end if;
    d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st - qty));
    sub := sub + pr * qty;
  end loop;

  -- Código promocional (se revisa en el servidor, no se confía en el navegador)
  if coalesce(trim(p_sale->>'promoCode'), '') <> '' then
    select x into promo from jsonb_array_elements(coalesce(d->'promoCodes', '[]'::jsonb)) x
     where coalesce((x->>'active')::boolean, false) and lower(x->>'code') = lower(trim(p_sale->>'promoCode')) limit 1;
    if promo is null then raise exception 'PROMO_INVALIDA'; end if;
    if coalesce((promo->>'clubOnly')::boolean, false)
       and not exists (select 1 from public.customers where phone = ph)
       and not (is_google and exists (select 1 from public.customers where phone = 'g:' || em)) then
      raise exception 'PROMO_SOLO_CLUB';
    end if;
    if promo->>'type' = 'percent' then
      -- igual que Math.round() de la tienda (mismo cálculo en coma flotante), para que el total coincida al céntimo
      disc := floor(sub::float8 * (coalesce(public.fly_num(promo->>'value'), 0)::float8 / 100) + 0.5)::numeric;
    else
      disc := least(coalesce(public.fly_num(promo->>'value'), 0), sub);
    end if;
  end if;

  -- Envío
  dm := coalesce(p_sale->>'deliveryMethod', 'recojo');
  dep := coalesce(p_sale->'deliveryDetails'->>'department', '');
  if dm = 'recojo' then ship := 0;
  elsif dm = 'provincia' then
    -- Tarifa del departamento configurada en Panel → Envíos; si no hay, la tarifa por defecto
    ship := coalesce(public.fly_num(d->'settings'->'provinceRates'->>dep), case
      when dep in ('La Libertad', 'Lambayeque', 'Piura', 'Tumbes', 'Cajamarca', 'Áncash', 'Amazonas', 'San Martín') then 12
      when dep in ('Lima', 'Callao', 'Ica', 'Junín', 'Pasco', 'Huánuco', 'Huancavelica', 'Ayacucho') then 15
      when dep in ('Arequipa', 'Moquegua', 'Tacna', 'Cusco', 'Puno', 'Apurímac') then 18
      when dep in ('Loreto', 'Ucayali', 'Madre de Dios') then 22
      else 15 end);
  elsif dm = 'internacional' then ship := greatest(coalesce(public.fly_num(p_sale->>'shipping'), 0), 0); -- se cotiza y confirma aparte
  else -- delivery local en Trujillo (precio y monto para envío gratis configurables)
    ship := case when sub >= coalesce(public.fly_num(d->'settings'->'localShipping'->>'freeFrom'), 200) then 0
                 else coalesce(public.fly_num(d->'settings'->'localShipping'->>'price'), 12) end;
  end if;

  -- Puntos del Club usados como descuento: se revisan y se descuentan YA (no se pueden usar dos veces)
  used := coalesce(public.fly_num(p_sale->>'pointsUsed'), 0)::int;
  if used > 0 and not public.club_enabled(d) then raise exception 'CLUB_DESACTIVADO'; end if;
  if used > 0 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    bp := greatest(1, coalesce(nullif(public.fly_num(l->>'blockPoints'), 0), 100));
    bv := case when l ? 'blockValue' then coalesce(public.fly_num(l->>'blockValue'), 0) else 3 end;
    if bv <= 0 or used % bp::int <> 0 then raise exception 'PUNTOS_INVALIDOS'; end if;
    pdisc := (used / bp::int) * bv;
    if pdisc > sub - disc then raise exception 'PUNTOS_INVALIDOS'; end if;
    -- Usar puntos online solo con la cuenta de Google de la dueña de esos puntos
    if not public.owns_customer(ph) then raise exception 'PUNTOS_SOLO_GOOGLE'; end if;
    select coalesce((data->>'points')::int, 0) into cpts from public.customers where phone = ph for update;
    if cpts is null or cpts < used then raise exception 'PUNTOS_INSUFICIENTES'; end if;
    update public.customers set data = jsonb_set(data, '{points}', to_jsonb(cpts - used)) where phone = ph;
  end if;

  tot := round(greatest(sub + ship - disc - pdisc, 0), 2);
  client_tot := public.fly_num(p_sale->>'total');
  if client_tot is null or abs(client_tot - tot) > 0.05 then raise exception 'TOTAL_CAMBIO'; end if;

  insert into public.doc_counters (serie, next_number) values ('B001', 1) on conflict (serie) do nothing;
  update public.doc_counters set next_number = next_number + 1 where serie = 'B001' returning next_number - 1 into n;
  sid := 'sale_' || substr(md5(random()::text || clock_timestamp()::text), 1, 14);

  perform public.set_stock_context(jsonb_build_object('type', 'pedido web', 'doc', 'B001-' || lpad(n::text, 6, '0'), 'saleId', sid,
    'customer', nullif(trim(coalesce(p_sale->>'customerName', '') || ' ' || coalesce(p_sale->>'customerPhone', '')), ''),
    'seller', 'Tienda online', 'staff', 'Web', 'store', 'web', 'channel', 'online', 'note', 'Apartado hasta confirmar el pago',
    'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(p_sale->'items') x)));
  update public.store_data set data = d, updated_at = now() where id = 'main';
  sale := p_sale || jsonb_build_object(
    'id', sid, 'tipo', 'boleta', 'serie', 'B001', 'numero', n,
    'channel', 'online', 'source', 'web', 'status', 'emitido',
    'paymentStatus', 'pendiente_validacion', 'fulfillment', 'pendiente',
    'staffName', 'Tienda Online (autoservicio web)',
    'subtotal', sub, 'discount', disc, 'shipping', ship, 'pointsUsed', used, 'pointsDiscount', pdisc, 'total', tot,
    'stockReserved', true, 'pointsDeducted', used > 0,
    'buyerEmail', case when is_google then em else null end,
    'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.sales (id, data) values (sid, sale);
  delete from public.reservations where session_id = p_session;

  -- Vincular la cuenta de Google con el celular del pedido.
  -- Solo si ese celular aún no es clienta, o si es de la misma persona (mismo correo).
  -- Antes se podía "adueñar" del celular de otra clienta cambiándole el correo.
  if is_google and length(ph) >= 7 then
    gkey := 'g:' || em;
    select coalesce((data->>'points')::int, 0) into gpts from public.customers where phone = gkey for update;
    if found then
      select data into crow from public.customers where phone = ph for update;
      if crow is null then
        update public.customers set phone = ph, data = data || jsonb_build_object('phone', ph, 'googleEmail', em) where phone = gkey;
      elsif lower(coalesce(crow->>'email', '')) = em then
        update public.customers set data = jsonb_set(data, '{points}', to_jsonb(coalesce((data->>'points')::int, 0) + gpts)) || jsonb_build_object('googleEmail', em) where phone = ph;
        delete from public.customers where phone = gkey;
      end if;
    end if;
  end if;
  return sale;
end $$;



create or replace function public.validate_online_payment(p_sale_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; it jsonb; pidx int; vidx int; st int; earned int := 0; used int; l jsonb; sps numeric; pps numeric; ph text;
        movs jsonb := '[]'::jsonb; label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  select data into s from public.sales where id = p_sale_id for update;
  if s is null then raise exception 'PEDIDO_NO_EXISTE'; end if;
  if s->>'paymentStatus' = 'confirmado' then return s; end if;
  if s->>'status' = 'anulado' then raise exception 'PEDIDO_ANULADO'; end if;
  label := coalesce(s->>'serie', '') || '-' || lpad(coalesce(s->>'numero', '0'), 6, '0');
  select data into d from public.store_data where id = 'main' for update;

  -- Pedidos antiguos (antes de este parche): el stock aún no se había descontado
  if not coalesce((s->>'stockReserved')::boolean, false) then
    for it in select * from jsonb_array_elements(s->'items') loop
      pidx := null;
      select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0) into pidx, vidx, st
        from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
       where v.val->>'id' = it->>'variantId'
          or (coalesce(it->>'variantId', '') = '' and p.val->>'id' = it->>'productId' and v.val->>'size' = it->>'size' and v.val->>'colorName' = it->>'colorName')
       limit 1;
      if pidx is not null then
        d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(greatest(st - (it->>'qty')::int, 0)));
        movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId', 'size', it->'size', 'colorName', it->'colorName',
          'type', 'venta', 'qty', (it->>'qty')::int, 'note', 'Pago validado — pedido web ' || label, 'staffName', public.my_staff_name(), 'createdAt', now_ms));
      end if;
    end loop;
    perform public.set_stock_context(jsonb_build_object('type', 'venta web', 'doc', label, 'saleId', p_sale_id,
      'customer', s->>'customerName', 'seller', 'Tienda online', 'staff', public.my_staff_name(), 'store', 'web', 'channel', 'online', 'note', 'Pago validado (pedido antiguo)'));
    update public.store_data set data = d, updated_at = now() where id = 'main';
    perform public.log_stock_movements(movs);
  end if;

  ph := regexp_replace(coalesce(s->>'customerPhone', ''), '\D', '', 'g');
  if length(ph) >= 7 then
    l := coalesce(d->'settings'->'loyalty', '{}'::jsonb);
    if l ? 'solesPerStep' then sps := greatest(0.01, coalesce((l->>'solesPerStep')::numeric, 1)); pps := coalesce((l->>'pointsPerStep')::numeric, 1);
    else sps := 1; pps := coalesce((l->>'pointsPerSol')::numeric, 1); end if;
    earned := case when not public.club_enabled(d) then 0 else (floor(greatest(coalesce((s->>'subtotal')::numeric, 0) - coalesce((s->>'discount')::numeric, 0) - coalesce((s->>'pointsDiscount')::numeric, 0), 0) / sps) * pps)::int end;
    -- Los puntos usados ya se descontaron al hacer el pedido (pedidos nuevos); en los antiguos se descuentan ahora
    used := case when coalesce((s->>'pointsDeducted')::boolean, false) then 0 else coalesce((s->>'pointsUsed')::int, 0) end;
    update public.customers set data = data || jsonb_build_object('points', greatest(coalesce((data->>'points')::int, 0) + earned - used, 0)) where phone = ph;
  end if;

  update public.sales set data = data || jsonb_build_object('paymentStatus', 'confirmado', 'stockReserved', true, 'earnedPoints', earned,
         'pointsDeducted', true, 'validatedBy', public.my_staff_name(), 'validatedAt', now_ms)
   where id = p_sale_id returning data into s;
  perform public.audit('pago_validado', jsonb_build_object('sale', p_sale_id, 'total', s->'total'));
  return s;
end $$;


create or replace function public.void_sale_core(p_sale_id text, p_reason text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; it jsonb; pidx int; vidx int; st int; ph text; returned boolean; used int;
        movs jsonb := '[]'::jsonb; label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  select data into s from public.sales where id = p_sale_id for update;
  if s is null then raise exception 'VENTA_NO_EXISTE'; end if;
  if s->>'status' = 'anulado' then return s; end if;
  label := coalesce(s->>'serie', '') || '-' || lpad(coalesce(s->>'numero', '0'), 6, '0');

  -- Solo se devuelve el stock si de verdad se había descontado
  returned := coalesce((s->>'stockReserved')::boolean, false) or s->>'source' = 'pos' or s->>'paymentStatus' = 'confirmado';
  if returned then
    select data into d from public.store_data where id = 'main' for update;
    for it in select * from jsonb_array_elements(s->'items') loop
      pidx := null;
      select (p.ord - 1)::int, (v.ord - 1)::int, coalesce((v.val->>'stock')::int, 0) into pidx, vidx, st
        from jsonb_array_elements(d->'products') with ordinality p(val, ord), jsonb_array_elements(p.val->'variants') with ordinality v(val, ord)
       where v.val->>'id' = it->>'variantId'
          or (coalesce(it->>'variantId', '') = '' and p.val->>'id' = it->>'productId' and v.val->>'size' = it->>'size' and v.val->>'colorName' = it->>'colorName')
       limit 1;
      if pidx is not null then
        d := jsonb_set(d, array['products', pidx::text, 'variants', vidx::text, 'stock'], to_jsonb(st + (it->>'qty')::int));
        movs := movs || jsonb_build_array(jsonb_build_object('id', 'mov_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12),
          'productId', it->'productId', 'productName', it->'name', 'variantId', it->'variantId', 'size', it->'size', 'colorName', it->'colorName',
          'type', 'ajuste', 'qty', (it->>'qty')::int, 'note', 'Anulación de ' || label || ': ' || trim(p_reason), 'staffName', p_by, 'createdAt', now_ms));
      end if;
    end loop;
    perform public.set_stock_context(jsonb_build_object('type', case when s->>'source' = 'web' and coalesce(s->>'paymentStatus', '') <> 'confirmado' then 'pedido cancelado' else 'anulación / devolución' end,
      'doc', label, 'saleId', p_sale_id, 'customer', nullif(trim(coalesce(s->>'customerName', '') || ' ' || coalesce(s->>'customerDoc', s->>'customerPhone', '')), ''),
      'seller', s->>'staffName', 'staff', p_by, 'store', coalesce(s->>'storeId', 'web'), 'channel', s->>'channel', 'note', trim(p_reason),
      'prices', (select jsonb_object_agg(x->>'variantId', x->'unitPrice') from jsonb_array_elements(s->'items') x)));
    update public.store_data set data = d, updated_at = now() where id = 'main';
    perform public.log_stock_movements(movs);
  end if;

  -- Puntos: se quitan los ganados y se devuelven los usados (solo si se habían descontado)
  ph := regexp_replace(coalesce(s->>'customerPhone', ''), '\D', '', 'g');
  used := case when coalesce((s->>'pointsDeducted')::boolean, false) or s->>'paymentStatus' = 'confirmado' then coalesce((s->>'pointsUsed')::int, 0) else 0 end;
  if length(ph) >= 7 and (coalesce((s->>'earnedPoints')::int, 0) > 0 or used > 0) then
    update public.customers set data = data || jsonb_build_object('points', greatest(coalesce((data->>'points')::int, 0) - coalesce((s->>'earnedPoints')::int, 0) + used, 0)) where phone = ph;
  end if;

  update public.sales set data = data || jsonb_build_object('status', 'anulado', 'voidReason', trim(p_reason), 'voidedBy', p_by,
         'voidedAt', now_ms, 'stockReturned', returned) where id = p_sale_id returning data into s;
  perform public.audit('venta_anulada', jsonb_build_object('sale', p_sale_id, 'motivo', p_reason, 'total', s->'total', 'por', p_by));
  return s;
end $$;


-- ---------- Guardar el catálogo producto por producto ----------
drop function if exists public.save_catalog(jsonb, jsonb);
create or replace function public.save_catalog(p_data jsonb, p_stock_deltas jsonb default '{}'::jsonb, p_changed text[] default null,
                                               p_deleted text[] default null, p_keys text[] default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb; stocks jsonb; prods jsonb; base jsonb; k text; cur_by_id jsonb;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if jsonb_typeof(p_data->'products') <> 'array' then raise exception 'CATALOGO_INVALIDO'; end if;
  select data into cur from public.store_data where id = 'main' for update;

  select coalesce(jsonb_object_agg(v->>'id', coalesce(public.fly_num(v->>'stock'), 0)), '{}'::jsonb) into stocks
    from jsonb_array_elements(coalesce(cur->'products', '[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) v
   where v->>'id' is not null;
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
                     then v || jsonb_build_object('stock', greatest(0, (stocks->>(v->>'id'))::numeric + coalesce(public.fly_num(coalesce(p_stock_deltas, '{}'::jsonb)->>(v->>'id')), 0))::int)
                     else v end order by vo), '[]'::jsonb)
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

-- ---------- Caja: bloqueada mientras alguien la cierra o mueve dinero ----------
drop function if exists public.cash_move(uuid, text, numeric, text);
create or replace function public.cash_move(p_session uuid, p_type text, p_amount numeric, p_reason text, p_seller text default null) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  perform 1 from public.cash_sessions where id = p_session and status = 'abierta' for update; -- bloquea la caja mientras se guarda
  if not found then raise exception 'CAJA_CERRADA'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  who := public.seller_tag(p_seller);
  insert into public.cash_movements (session_id, type, amount, reason, created_by, created_by_name, seller)
  values (p_session, p_type, p_amount, trim(p_reason), auth.uid(), public.my_staff_name(), who);
  perform public.audit('caja_' || p_type, jsonb_build_object('session', p_session, 'monto', p_amount, 'motivo', p_reason, 'vendedora', who));
end $$;


drop function if exists public.close_cash(uuid, numeric, text);
create or replace function public.close_cash(p_session uuid, p_counted numeric, p_notes text, p_seller text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sm jsonb; diff numeric; who text;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  perform 1 from public.cash_sessions where id = p_session and status = 'abierta' for update; -- si dos personas cierran a la vez, la segunda espera y ve la caja ya cerrada
  if not found then raise exception 'CAJA_CERRADA'; end if;
  who := public.seller_tag(p_seller);
  sm := public.cash_summary(p_session);
  diff := round(coalesce(p_counted, 0) - (sm->>'expectedCash')::numeric, 2);
  if diff <> 0 and coalesce(trim(p_notes), '') = '' then raise exception 'MOTIVO_DIFERENCIA'; end if;
  update public.cash_sessions set status = 'cerrada', closed_by = auth.uid(), closed_by_name = public.my_staff_name(), closed_at = now(), closed_seller = who,
         expected_cash = (sm->>'expectedCash')::numeric, counted_cash = p_counted, difference = diff, notes = p_notes,
         totals = jsonb_build_object('byMethod', sm->'byMethod', 'bySeller', sm->'bySeller', 'salesCount', sm->'salesCount', 'entradas', sm->'entradas', 'salidas', sm->'salidas', 'cashSales', sm->'cashSales')
   where id = p_session;
  perform public.audit('caja_cerrada', jsonb_build_object('session', p_session, 'esperado', sm->'expectedCash', 'contado', p_counted, 'diferencia', diff, 'vendedora', who));
  return public.cash_summary(p_session);
end $$;


create or replace function public.shift_change(p_session uuid, p_counted numeric, p_notes text, p_next_amount numeric,
                                               p_seller_out text default null, p_seller_in text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; closed jsonb; opened jsonb; nxt numeric;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  select * into s from public.cash_sessions where id = p_session for update;
  if s.id is null or s.status <> 'abierta' then raise exception 'CAJA_CERRADA'; end if;
  nxt := greatest(coalesce(p_next_amount, p_counted, 0), 0);
  if nxt > coalesce(p_counted, 0) + 0.001 then raise exception 'FONDO_MAYOR_QUE_CONTADO'; end if;
  closed := public.close_cash(p_session, p_counted,
              trim(both ' ' from coalesce(p_notes, '') || case when nxt < coalesce(p_counted, 0) then ' [Cambio de turno: se retiraron S/ ' || (coalesce(p_counted, 0) - nxt) || ']' else '' end),
              p_seller_out);
  opened := public.open_cash(s.store_id, nxt, s.register_id, p_seller_in);
  return jsonb_build_object('closed', closed, 'opened', opened);
end $$;


revoke execute on function public.save_catalog(jsonb, jsonb, text[], text[], text[], text) from public, anon;
grant execute on function public.save_catalog(jsonb, jsonb, text[], text[], text[], text) to authenticated;
revoke execute on function public.cash_move(uuid, text, numeric, text, text), public.close_cash(uuid, numeric, text, text) from public, anon;
grant execute on function public.cash_move(uuid, text, numeric, text, text), public.close_cash(uuid, numeric, text, text) to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select count(*) from public.stock_movements;   -- historial copiado
--    select proname from pg_proc where proname in ('move_stock','track_stock_changes');
-- =====================================================================


-- ---------- Cesta: la prenda se aparta los minutos que elijas (por defecto 20) y nunca más de lo que hay ----------
-- Antes: 15 minutos fijos y se podía "apartar" aunque no quedara stock (alguien podía bloquear prendas).
create or replace function public.set_reservation(p_session text, p_variant text, p_qty integer) returns void
language plpgsql security definer set search_path = public as $$
declare mins int; st int; others int; q int;
begin
  delete from public.reservations where expires_at < now();
  if coalesce(p_qty, 0) <= 0 then
    delete from public.reservations where session_id = p_session and variant_id = p_variant;
    return;
  end if;
  select least(60, greatest(5, coalesce(public.fly_num(data->'settings'->>'cartHoldMinutes'), 20)))::int,
         (select coalesce(public.fly_num(v->>'stock'), 0)::int from jsonb_array_elements(data->'products') p, jsonb_array_elements(p->'variants') v where v->>'id' = p_variant limit 1)
    into mins, st from public.store_data where id = 'main';
  select coalesce(sum(qty), 0) into others from public.reservations where variant_id = p_variant and session_id <> p_session and expires_at > now();
  q := least(p_qty, 20, greatest(coalesce(st, 0) - others, 0));
  if q <= 0 then
    delete from public.reservations where session_id = p_session and variant_id = p_variant;
    return;
  end if;
  insert into public.reservations (session_id, variant_id, qty, expires_at)
  values (left(p_session, 60), left(p_variant, 60), q, now() + make_interval(mins => coalesce(mins, 20)))
  on conflict (session_id, variant_id) do update set qty = excluded.qty, expires_at = excluded.expires_at;
end $$;
