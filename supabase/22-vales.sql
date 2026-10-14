-- =====================================================================
--  FLY BOUTIQUE — 22: VALES DE COMPRA CON SALDO
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 21. Después, Merge del PR.
--  - Cuando una devolución se paga con «Vale», se crea un vale con código (ej. V7K2QX) y su saldo.
--  - En caja se puede pagar con «Vale» escribiendo el código: se descuenta del saldo en el mismo momento
--    en que se guarda la venta (si no alcanza el saldo, la venta NO se guarda).
--  - Si se anula una venta pagada con vale, el saldo vuelve al vale.
--  - Cada movimiento del vale queda en su historial. Solo Super Admin, Administración y Cajero(a) los ven.
--  No borra datos. Para volver atrás: 22-vales-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.store_credits (
  code text primary key,
  customer_name text, customer_phone text,
  amount numeric not null check (amount > 0),
  balance numeric not null check (balance >= 0),
  status text not null default 'activo' check (status in ('activo', 'usado', 'anulado')),
  origin_sale_id text, origin_doc text, note text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), created_by text
);
alter table public.store_credits enable row level security;
revoke all on public.store_credits from anon, authenticated;
grant select on public.store_credits to authenticated;
drop policy if exists "vales_ver" on public.store_credits;
create policy "vales_ver" on public.store_credits for select using (public.has_role('superadmin', 'administrador', 'cajero'));
-- (las escrituras van SOLO por las funciones y el disparador de abajo)

create or replace function public.new_credit_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    c := 'V' || (select string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.store_credits where code = c);
  end loop;
  return c;
end $$;
revoke execute on function public.new_credit_code() from public, anon, authenticated;

-- Disparador en ventas: usa el saldo al pagar, crea el vale en devoluciones y lo repone si se anula la venta.
create or replace function public.sales_store_credit() returns trigger
language plpgsql security definer set search_path = public as $$
declare p jsonb; cr public.store_credits; amt numeric; i int; r jsonb; v_code text; doc text; who text;
begin
  doc := coalesce(NEW.data->>'serie', '') || '-' || lpad(coalesce(NEW.data->>'numero', '0'), 6, '0');
  who := coalesce(public.my_staff_name(), 'Sistema');
  if TG_OP = 'INSERT' then
    -- Un "upsert" de una venta que ya existe no vuelve a descontar
    if exists (select 1 from public.sales where id = NEW.id) then return NEW; end if;
    for p in select * from jsonb_array_elements(coalesce(NEW.data->'payments', '[]'::jsonb)) loop
      if p->>'method' <> 'Vale' then continue; end if;
      amt := round(coalesce(public.fly_num(p->>'amount'), 0), 2);
      if amt <= 0 then continue; end if;
      select * into cr from public.store_credits sc where sc.code = upper(trim(coalesce(p->>'code', ''))) for update;
      if cr.code is null then raise exception 'VALE_NO_EXISTE'; end if;
      if cr.status <> 'activo' or cr.balance + 0.004 < amt then raise exception 'VALE_SIN_SALDO:%', cr.balance; end if;
      update public.store_credits set balance = round(balance - amt, 2), status = case when round(balance - amt, 2) <= 0 then 'usado' else 'activo' end,
             history = history || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'uso', 'amount', -amt, 'doc', doc, 'sale', NEW.id, 'by', who))
       where store_credits.code = cr.code;
    end loop;
    return NEW;
  end if;

  -- Devolución pagada con vale: se crea el vale y su código queda en la devolución
  if jsonb_array_length(coalesce(NEW.data->'returns', '[]'::jsonb)) > jsonb_array_length(coalesce(OLD.data->'returns', '[]'::jsonb)) then
    for i in jsonb_array_length(coalesce(OLD.data->'returns', '[]'::jsonb)) .. jsonb_array_length(NEW.data->'returns') - 1 loop
      r := NEW.data->'returns'->i;
      if r->>'method' = 'Vale' and coalesce(public.fly_num(r->>'difference'), 0) > 0 and coalesce(r->>'valeCode', '') = '' then
        v_code := public.new_credit_code();
        insert into public.store_credits (code, customer_name, customer_phone, amount, balance, origin_sale_id, origin_doc, note, history, created_by)
        values (v_code, NEW.data->>'customerName', nullif(NEW.data->>'customerPhone', ''), round(public.fly_num(r->>'difference'), 2), round(public.fly_num(r->>'difference'), 2),
                NEW.id, doc, r->>'reason',
                jsonb_build_array(jsonb_build_object('at', now(), 'type', 'creado', 'amount', round(public.fly_num(r->>'difference'), 2), 'doc', doc, 'sale', NEW.id, 'by', who)), who);
        NEW.data := jsonb_set(NEW.data, array['returns', i::text, 'valeCode'], to_jsonb(v_code));
        perform public.audit('vale_creado', jsonb_build_object('vale', v_code, 'monto', r->'difference', 'doc', doc));
      end if;
    end loop;
  end if;

  -- Venta anulada: el saldo usado vuelve al vale
  if coalesce(OLD.data->>'status', '') <> 'anulado' and NEW.data->>'status' = 'anulado' then
    for p in select * from jsonb_array_elements(coalesce(NEW.data->'payments', '[]'::jsonb)) loop
      if p->>'method' <> 'Vale' or coalesce(p->>'code', '') = '' then continue; end if;
      amt := round(coalesce(public.fly_num(p->>'amount'), 0), 2);
      update public.store_credits set balance = round(balance + amt, 2), status = case when status = 'anulado' then status else 'activo' end,
             history = history || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'devuelto por anulación', 'amount', amt, 'doc', doc, 'sale', NEW.id, 'by', who))
       where store_credits.code = upper(trim(p->>'code'));
    end loop;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_sales_store_credit on public.sales;
create trigger trg_sales_store_credit before insert or update on public.sales for each row execute function public.sales_store_credit();

-- Caja consulta un vale por su código (saldo, a nombre de quién y su historial)
create or replace function public.credit_lookup(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cr public.store_credits;
begin
  if not public.has_role('superadmin', 'administrador', 'cajero', 'vendedora_tienda') then raise exception 'SIN_PERMISO'; end if;
  select * into cr from public.store_credits where code = upper(trim(coalesce(p_code, '')));
  if cr.code is null then return null; end if;
  return jsonb_build_object('code', cr.code, 'balance', cr.balance, 'amount', cr.amount, 'status', cr.status, 'customer', cr.customer_name, 'doc', cr.origin_doc, 'createdAt', cr.created_at);
end $$;
revoke execute on function public.credit_lookup(text) from public, anon;
grant execute on function public.credit_lookup(text) to authenticated;

-- Administración puede anular un vale (ej. se entregó por error). Queda el motivo.
create or replace function public.void_credit(p_code text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cr public.store_credits;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  update public.store_credits set status = 'anulado',
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'type', 'anulado', 'amount', -balance, 'note', trim(p_reason), 'by', public.my_staff_name()))
   where code = upper(trim(p_code)) and status <> 'anulado' returning * into cr;
  if cr.code is null then raise exception 'VALE_NO_EXISTE'; end if;
  perform public.audit('vale_anulado', jsonb_build_object('vale', cr.code, 'saldo', cr.balance, 'motivo', p_reason));
  return to_jsonb(cr);
end $$;
revoke execute on function public.void_credit(text, text) from public, anon;
grant execute on function public.void_credit(text, text) to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select count(*) from public.store_credits;
-- =====================================================================
