-- Ejecuta esto en Supabase → SQL Editor → New query → Run
-- Crea la tabla donde vivirá todo el catálogo de Fly Boutique de forma real y permanente.

create table if not exists store_data (
  id text primary key default 'main',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table store_data enable row level security;

-- Por ahora, lectura y escritura abiertas (la app todavía no usa el sistema de
-- autenticación real de Supabase para el personal, sigue con su propio login interno).
-- Cuando conectemos Supabase Auth a los roles de Staff, esto se endurece para que
-- solo el personal autenticado pueda escribir.
create policy "Lectura pública" on store_data for select using (true);
create policy "Escritura pública temporal" on store_data for insert with check (true);
create policy "Actualización pública temporal" on store_data for update using (true);
