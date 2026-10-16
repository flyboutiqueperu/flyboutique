-- 29 · «Avísame cuando vuelva»
-- Cuando una talla o color está agotado, quien visita la tienda deja su celular o correo. El staff ve la lista en
-- Más → «Avísame cuando vuelva», sabe cuándo ya hay stock y le escribe por WhatsApp o correo. Es un aviso pedido por la
-- misma persona y solo para esa prenda (no la suma a publicidad). Nadie de afuera puede leer la lista.
-- No borra datos. Para volver atrás: 29-avisame-stock-VOLVER-ATRAS.sql
create table if not exists public.stock_alerts (
  id bigserial primary key,
  product_id text not null,
  product_name text not null,
  color text not null default '',
  size text not null default '',
  contact text not null,
  contact_type text not null check (contact_type in ('celular', 'correo')),
  name text,
  lang text not null default 'es',
  status text not null default 'pendiente' check (status in ('pendiente', 'avisado', 'cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_by text
);
create index if not exists stock_alerts_status_idx on public.stock_alerts (status, product_id);
alter table public.stock_alerts enable row level security;
revoke all on public.stock_alerts from public, anon, authenticated;

-- Pedir el aviso (tienda, sin iniciar sesión). Devuelve 'ok' o 'ya_estaba'.
create or replace function public.request_stock_alert(p_product_id text, p_color text, p_size text, p_contact text, p_name text default null, p_lang text default 'es')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_contact text := lower(trim(coalesce(p_contact, '')));
  v_type text;
  v_digits text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
  v_name text;
begin
  if length(v_digits) = 11 and v_digits like '51%' then v_digits := substr(v_digits, 3); end if;
  if v_digits ~ '^9\d{8}$' and v_contact !~ '@' then v_contact := v_digits; v_type := 'celular';
  elsif v_contact ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' and length(v_contact) <= 120 then v_type := 'correo';
  else raise exception 'CONTACTO_INVALIDO'; end if;
  if length(coalesce(p_product_id, '')) not between 1 and 80 or length(coalesce(p_color, '')) > 60 or length(coalesce(p_size, '')) > 30 or length(coalesce(p_name, '')) > 80 then raise exception 'DATOS_INVALIDOS'; end if;
  select p->>'name' into v_name from store_data s, jsonb_array_elements(s.data->'products') p where s.id = 'main' and p->>'id' = p_product_id limit 1;
  if v_name is null then raise exception 'PRENDA_NO_EXISTE'; end if;
  if exists (select 1 from stock_alerts where status = 'pendiente' and contact = v_contact and product_id = p_product_id and color = coalesce(p_color, '') and size = coalesce(p_size, '')) then return 'ya_estaba'; end if;
  -- Límites contra abusos: 10 avisos pendientes por contacto y 300 avisos nuevos por hora en toda la tienda
  if (select count(*) from stock_alerts where status = 'pendiente' and contact = v_contact) >= 10 then raise exception 'DEMASIADOS_AVISOS'; end if;
  if (select count(*) from stock_alerts where created_at > now() - interval '1 hour') >= 300 then raise exception 'INTENTA_MAS_TARDE'; end if;
  insert into stock_alerts (product_id, product_name, color, size, contact, contact_type, name, lang)
  values (p_product_id, v_name, coalesce(p_color, ''), coalesce(p_size, ''), v_contact, v_type, nullif(trim(coalesce(p_name, '')), ''), case when p_lang = 'en' then 'en' else 'es' end);
  return 'ok';
end $$;
revoke execute on function public.request_stock_alert(text, text, text, text, text, text) from public;
grant execute on function public.request_stock_alert(text, text, text, text, text, text) to anon, authenticated;

-- Lista para el staff (los últimos 500; pendientes primero)
create or replace function public.staff_stock_alerts(p_status text default 'pendiente')
returns setof public.stock_alerts language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador', 'vendedora_online', 'vendedora_tienda', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  return query select * from stock_alerts where p_status = 'todos' or status = p_status order by created_at desc limit 500;
end $$;
revoke execute on function public.staff_stock_alerts(text) from public, anon;
grant execute on function public.staff_stock_alerts(text) to authenticated;

-- Marcar como avisado / cancelado (o volver a pendiente). Queda quién lo hizo.
create or replace function public.set_stock_alert_status(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador', 'vendedora_online', 'vendedora_tienda', 'cajero') then raise exception 'SIN_PERMISO'; end if;
  if p_status not in ('pendiente', 'avisado', 'cancelado') then raise exception 'ESTADO_INVALIDO'; end if;
  update stock_alerts set status = p_status, updated_at = now(),
    handled_by = (select coalesce(name, username) from staff_profiles where user_id = auth.uid())
  where id = p_id;
  if not found then raise exception 'NO_EXISTE'; end if;
end $$;
revoke execute on function public.set_stock_alert_status(bigint, text) from public, anon;
grant execute on function public.set_stock_alert_status(bigint, text) to authenticated;
