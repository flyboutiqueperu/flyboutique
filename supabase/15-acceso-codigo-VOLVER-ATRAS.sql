-- FLY BOUTIQUE — VOLVER ATRÁS EL 15 (solo Google vuelve a contar como cuenta confirmada). No borra datos.
create or replace function public.google_email() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null
               and coalesce(auth.jwt()->>'email', '') <> ''
               and (coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
                    or coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google')
              then lower(auth.jwt()->>'email') else '' end
$$;

create or replace function public.register_google_customer() returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  em text := lower(coalesce(auth.jwt()->>'email', ''));
  nm text := coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name', ''), nullif(auth.jwt()->'user_metadata'->>'name', ''), split_part(lower(coalesce(auth.jwt()->>'email', '')), '@', 1));
  r record; c jsonb;
begin
  if auth.uid() is null or em = '' or coalesce(auth.jwt()->'app_metadata'->>'provider', '') <> 'google' then
    raise exception 'SOLO_GOOGLE';
  end if;
  select phone, data into r from public.customers
  where lower(data->>'email') = em or phone = 'g:' || em
  order by (phone like 'g:%') limit 1;
  if found then
    return jsonb_build_object('name', coalesce(r.data->>'name', nm), 'email', em,
      'phone', case when r.phone like 'g:%' then '' else r.phone end,
      'points', coalesce((r.data->>'points')::int, 0), 'existing', true);
  end if;
  c := jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', left(nm, 80), 'phone', '',
                          'email', em, 'points', 0, 'via', 'google', 'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.customers (phone, data) values ('g:' || em, c);
  return jsonb_build_object('name', left(nm, 80), 'email', em, 'phone', '', 'points', 0, 'existing', false);
end $function$;
