-- =====================================================================
--  FLY BOUTIQUE — 16: CLUB FLY TAMBIÉN CON CONTRASEÑA (segura)
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 15.
--  Regla: la contraseña solo la puede crear la dueña del correo, estando dentro con el código del
--  correo o con Google. Así nadie puede "inventarle" una contraseña a una cuenta ajena.
--  Una sesión con contraseña solo cuenta si esa contraseña se creó de esa forma.
--  No borra datos. Para volver atrás: 16-club-contrasena-VOLVER-ATRAS.sql
-- =====================================================================

-- Quién creó su contraseña estando verificada (solo lo escribe el servidor)
create table if not exists public.customer_auth (
  user_id uuid primary key,
  email text not null,
  password_set_at timestamptz not null default now()
);
alter table public.customer_auth enable row level security;
revoke all on public.customer_auth from anon, authenticated;

-- Correo confirmado "fuerte": Google o código al correo (igual que el 15)
create or replace function public.strong_customer_email() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null
               and coalesce(auth.jwt()->>'email', '') <> ''
               and lower(auth.jwt()->>'email') not like '%@staff.flyboutique.pe'
               and (coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
                    or coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google'
                    or exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
                                where a->>'method' in ('otp', 'magiclink', 'email/signup')))
              then lower(auth.jwt()->>'email') else '' end
$$;
revoke execute on function public.strong_customer_email() from public, anon;

-- Correo confirmado de la clienta: Google, código, o contraseña creada estando verificada
create or replace function public.google_email() returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.strong_customer_email() <> '' then public.strong_customer_email()
    when auth.uid() is not null
         and coalesce(auth.jwt()->>'email', '') <> ''
         and lower(auth.jwt()->>'email') not like '%@staff.flyboutique.pe'
         and exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a where a->>'method' = 'password')
         and exists (select 1 from public.customer_auth ca where ca.user_id = auth.uid() and ca.email = lower(auth.jwt()->>'email'))
      then lower(auth.jwt()->>'email')
    else '' end
$$;

-- La app la llama justo después de que la clienta (entrando con código o Google) crea su contraseña
create or replace function public.mark_customer_password() returns void
language plpgsql security definer set search_path = public as $$
declare em text := public.strong_customer_email();
begin
  if em = '' then raise exception 'SOLO_VERIFICADA'; end if;
  insert into public.customer_auth (user_id, email, password_set_at) values (auth.uid(), em, now())
  on conflict (user_id) do update set email = excluded.email, password_set_at = now();
end $$;
revoke execute on function public.mark_customer_password() from public, anon;
grant execute on function public.mark_customer_password() to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select proname from pg_proc where proname in ('strong_customer_email','mark_customer_password');
-- =====================================================================
