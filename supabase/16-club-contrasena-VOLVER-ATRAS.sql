-- FLY BOUTIQUE — VOLVER ATRÁS EL 16: la contraseña de clienta deja de contar (Google y código siguen). No borra datos.
create or replace function public.google_email() returns text
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
revoke execute on function public.mark_customer_password() from authenticated;
