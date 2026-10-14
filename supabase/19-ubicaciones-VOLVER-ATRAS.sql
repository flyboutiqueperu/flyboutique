-- FLY BOUTIQUE — VOLVER ATRÁS EL 19: se deja de cuadrar el stock por sede y de usar guías. No borra datos.
-- OJO: antes de correrlo, recibe o anula las guías EN CAMINO (si no, esas prendas no vuelven al stock).
drop trigger if exists trg_reconcile_locations on public.store_data;
revoke execute on function public.create_transfer(text, text, jsonb, text) from authenticated;
revoke execute on function public.receive_transfer(bigint, jsonb, text) from authenticated;
revoke execute on function public.cancel_transfer(bigint, text) from authenticated;
drop function if exists public.move_stock(text, text, int, text, int, text);
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
grant execute on function public.save_catalog(jsonb, jsonb, text[], text[], text[], text) to authenticated;
