-- =====================================================================
--  FLY BOUTIQUE — 18: COSTOS DE COMPRA Y GASTOS (privados)
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Después, Merge del PR.
--  - product_costs: cuánto te costó cada prenda y a qué proveedor. NO va en el catálogo (que es público).
--  - expenses: gastos del negocio (alquiler, sueldos, luz, publicidad...). No se borran: se anulan con motivo.
--  Solo Super Admin y Administración pueden verlos y cambiarlos. Nadie de caja ni la web.
--  No borra datos. Para volver atrás: 18-costos-gastos-VOLVER-ATRAS.sql
-- =====================================================================

create table if not exists public.product_costs (
  product_id text primary key,
  cost numeric not null check (cost >= 0 and cost < 100000),
  supplier text check (char_length(supplier) <= 120),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.product_costs enable row level security;
revoke all on public.product_costs from anon, authenticated;
grant select, insert, update on public.product_costs to authenticated;
drop policy if exists "costos_ver" on public.product_costs;
drop policy if exists "costos_crear" on public.product_costs;
drop policy if exists "costos_editar" on public.product_costs;
create policy "costos_ver" on public.product_costs for select using (public.has_role('superadmin', 'administrador'));
create policy "costos_crear" on public.product_costs for insert with check (public.has_role('superadmin', 'administrador'));
create policy "costos_editar" on public.product_costs for update using (public.has_role('superadmin', 'administrador')) with check (public.has_role('superadmin', 'administrador'));

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  spent_on date not null default current_date,
  category text not null check (char_length(category) between 2 and 40),
  amount numeric not null check (amount > 0 and amount < 1000000),
  note text check (char_length(note) <= 200),
  store_id text,
  created_at timestamptz not null default now(),
  created_by text,
  voided boolean not null default false,
  void_reason text check (char_length(void_reason) <= 200),
  voided_by text
);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;
grant select, insert, update on public.expenses to authenticated;
drop policy if exists "gastos_ver" on public.expenses;
drop policy if exists "gastos_crear" on public.expenses;
drop policy if exists "gastos_anular" on public.expenses;
create policy "gastos_ver" on public.expenses for select using (public.has_role('superadmin', 'administrador'));
create policy "gastos_crear" on public.expenses for insert with check (public.has_role('superadmin', 'administrador') and not voided);
create policy "gastos_anular" on public.expenses for update using (public.has_role('superadmin', 'administrador')) with check (public.has_role('superadmin', 'administrador'));

-- Quién lo hizo y cuándo lo pone el servidor (no se puede falsificar desde el navegador);
-- un gasto ya registrado solo se puede ANULAR (con motivo), no cambiar el monto ni la fecha.
create or replace function public.stamp_cost_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'product_costs' then
    NEW.updated_at := now(); NEW.updated_by := public.my_staff_name();
    perform public.audit('costo_cambiado', jsonb_build_object('producto', NEW.product_id, 'costo', NEW.cost,
      'antes', case when TG_OP = 'UPDATE' then OLD.cost end));
  elsif TG_OP = 'INSERT' then
    NEW.created_at := now(); NEW.created_by := public.my_staff_name(); NEW.voided := false; NEW.voided_by := null; NEW.void_reason := null;
  else
    if OLD.voided then raise exception 'GASTO_YA_ANULADO'; end if;
    if NEW.amount <> OLD.amount or NEW.spent_on <> OLD.spent_on or NEW.category <> OLD.category
       or coalesce(NEW.note, '') <> coalesce(OLD.note, '') or not NEW.voided then raise exception 'GASTO_SOLO_ANULAR'; end if;
    if coalesce(trim(NEW.void_reason), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
    NEW.created_at := OLD.created_at; NEW.created_by := OLD.created_by; NEW.voided_by := public.my_staff_name();
    perform public.audit('gasto_anulado', jsonb_build_object('gasto', OLD.id, 'monto', OLD.amount, 'motivo', NEW.void_reason));
  end if;
  return NEW;
end $$;
drop trigger if exists trg_stamp_costs on public.product_costs;
create trigger trg_stamp_costs before insert or update on public.product_costs for each row execute function public.stamp_cost_expense();
drop trigger if exists trg_stamp_expenses on public.expenses;
create trigger trg_stamp_expenses before insert or update on public.expenses for each row execute function public.stamp_cost_expense();
