-- =====================================================================
--  FLY BOUTIQUE — 12: PEDIDOS WEB SIN PAGO (cancelar y liberar el stock)
--  Pegar TODO en Supabase → SQL Editor → New query → Run. Después, Merge del PR.
--  No borra datos: el pedido queda como "anulado" con su motivo y la prenda vuelve al stock.
--  Para volver atrás: 12-pedidos-sin-pago-VOLVER-ATRAS.sql
-- =====================================================================

-- ---------- Anular (lógica común, sin revisar permisos: la usan las funciones de abajo) ----------
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

revoke execute on function public.void_sale_core(text, text, text) from public, anon, authenticated;

-- ---------- Anular venta o pedido (solo Administración) — igual que antes ----------
create or replace function public.void_sale(p_sale_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  return public.void_sale_core(p_sale_id, p_reason, public.my_staff_name());
end $$;

-- ---------- Cancelar un pedido web que NO se pagó (staff de tienda, online o Administración) ----------
-- Solo pedidos web con el pago sin confirmar. Devuelve la prenda al stock y los puntos usados.
create or replace function public.cancel_unpaid_order(p_sale_id text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda', 'vendedora_online') then raise exception 'SIN_PERMISO'; end if;
  select data into s from public.sales where id = p_sale_id;
  if s is null then raise exception 'PEDIDO_NO_EXISTE'; end if;
  if coalesce(s->>'source', '') <> 'web' or s->>'paymentStatus' = 'confirmado' then raise exception 'SOLO_PEDIDOS_SIN_PAGO'; end if;
  return public.void_sale_core(p_sale_id, coalesce(nullif(trim(p_reason), ''), 'Pago no recibido'), public.my_staff_name());
end $$;

-- ---------- Cancelación automática de pedidos sin pago ----------
-- Pasadas N horas (Panel → Pedidos; 24 por defecto; 0 = nunca) los pedidos web sin pago confirmado
-- se anulan solos y la prenda vuelve a estar disponible. La tienda llama a esta función al cargar.
create or replace function public.expire_unpaid_orders() returns int
language plpgsql security definer set search_path = public as $$
declare h numeric; r record; n int := 0;
begin
  select coalesce(public.fly_num(data->'settings'->>'unpaidOrderHours'), 24) into h from public.store_data where id = 'main';
  if h is null or h <= 0 then return 0; end if;
  for r in select id from public.sales
            where data->>'source' = 'web' and coalesce(data->>'status', '') <> 'anulado'
              and coalesce(data->>'paymentStatus', '') <> 'confirmado'
              and created_at < now() - make_interval(secs => (h * 3600)::double precision)
            order by created_at limit 50 loop
    perform public.void_sale_core(r.id, 'Pago no recibido en ' || h || ' h (cancelación automática)', 'Sistema');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.cancel_unpaid_order(text, text) from public, anon;
grant execute on function public.cancel_unpaid_order(text, text) to authenticated;
grant execute on function public.expire_unpaid_orders() to anon, authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select proname from pg_proc where proname in ('void_sale_core','cancel_unpaid_order','expire_unpaid_orders');
-- =====================================================================
