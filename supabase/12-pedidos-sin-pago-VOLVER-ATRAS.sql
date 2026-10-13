-- =====================================================================
--  FLY BOUTIQUE — VOLVER ATRÁS EL ARCHIVO 12 (pedidos sin pago)
--  Restaura void_sale como estaba (08) y desactiva la cancelación automática. No borra datos.
--  (Los pedidos que ya se anularon quedan anulados; si alguno se debe recuperar, avisar.)
-- =====================================================================
create or replace function public.void_sale(p_sale_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; it jsonb; pidx int; vidx int; st int; ph text; returned boolean; used int;
        movs jsonb := '[]'::jsonb; label text; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
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
          'type', 'ajuste', 'qty', (it->>'qty')::int, 'note', 'Anulación de ' || label || ': ' || trim(p_reason), 'staffName', public.my_staff_name(), 'createdAt', now_ms));
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

  update public.sales set data = data || jsonb_build_object('status', 'anulado', 'voidReason', trim(p_reason), 'voidedBy', public.my_staff_name(),
         'voidedAt', now_ms, 'stockReturned', returned) where id = p_sale_id returning data into s;
  perform public.audit('venta_anulada', jsonb_build_object('sale', p_sale_id, 'motivo', p_reason, 'total', s->'total'));
  return s;
end $$;


revoke execute on function public.expire_unpaid_orders() from anon, authenticated;
revoke execute on function public.cancel_unpaid_order(text, text) from authenticated;
