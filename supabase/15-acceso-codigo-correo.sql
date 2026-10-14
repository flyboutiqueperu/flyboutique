-- =====================================================================
--  FLY BOUTIQUE — 15: ENTRAR AL CLUB FLY CON UN CÓDIGO AL CORREO
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Correr DESPUÉS del 14.
--  Una clienta "confirmada" es la que entró con Google o con el código de 6 dígitos que llegó a su correo.
--  Solo ella puede usar sus puntos en la web y ver sus pedidos. NO cuentan: cuentas con contraseña
--  (cualquiera podría crear una con el correo de otra persona) ni cuentas del staff.
--  No borra datos. Para volver atrás: 15-acceso-codigo-VOLVER-ATRAS.sql
-- =====================================================================

-- Correo confirmado de la clienta (el nombre se mantiene para no tocar las funciones que ya lo usan)
create or replace function public.google_email() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null
               and coalesce(auth.jwt()->>'email', '') <> ''
               and lower(auth.jwt()->>'email') not like '%@staff.flyboutique.pe'
               and (coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
                    or coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google'
                    -- entró con el código al correo (no con contraseña)
                    or exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
                                where a->>'method' in ('otp', 'magiclink', 'email/signup')))
              then lower(auth.jwt()->>'email') else '' end
$$;

-- Crear o encontrar la cuenta del Club de quien entró con Google o con el código
create or replace function public.register_google_customer() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  em text := public.google_email();
  nm text := coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name', ''), nullif(auth.jwt()->'user_metadata'->>'name', ''), split_part(public.google_email(), '@', 1));
  via text := case when coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google' then 'google' else 'correo' end;
  r record; c jsonb;
begin
  if em = '' then raise exception 'SOLO_GOOGLE'; end if;
  -- ¿Ya existe una clienta con ese correo? (primero las que ya tienen celular)
  select phone, data into r from public.customers
   where lower(data->>'email') = em or lower(coalesce(data->>'googleEmail', '')) = em or phone = 'g:' || em
   order by (phone like 'g:%') limit 1;
  if found then
    return jsonb_build_object('name', coalesce(r.data->>'name', nm), 'email', em,
      'phone', case when r.phone like 'g:%' then '' else r.phone end,
      'points', coalesce((r.data->>'points')::int, 0), 'existing', true);
  end if;
  c := jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', left(nm, 80), 'phone', '',
                          'email', em, 'points', 0, 'via', via, 'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.customers (phone, data) values ('g:' || em, c);
  return jsonb_build_object('name', left(nm, 80), 'email', em, 'phone', '', 'points', 0, 'existing', false);
end $$;
revoke execute on function public.register_google_customer() from public, anon;
grant execute on function public.register_google_customer() to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select proname from pg_proc where proname in ('google_email','register_google_customer');
--  IMPORTANTE (una vez, en Supabase): ver los pasos del PR para que el correo traiga el código de 6 dígitos.
-- =====================================================================
