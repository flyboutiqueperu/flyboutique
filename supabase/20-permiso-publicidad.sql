-- =====================================================================
--  FLY BOUTIQUE — 20: PERMISO PARA ENVIAR PUBLICIDAD (Club Fly) — Ley 29733
--  Pegar TODO en Supabase → SQL Editor → New query (vacía) → Run. Se puede correr antes o después del Merge.
--  - Al registrarse, la persona marca (si quiere) «Quiero recibir novedades y ofertas». Se guarda sí/no, fecha y por dónde.
--  - Quien entró con Google o con el código al correo puede cambiarlo desde su Club Fly.
--  - Administración puede anotar el cambio cuando la persona lo pide en tienda o por WhatsApp (queda en la auditoría).
--  - Quien nunca respondió cuenta como «sin permiso»: no se le envía publicidad.
--  No borra datos. Para volver atrás: 20-permiso-publicidad-VOLVER-ATRAS.sql
-- =====================================================================

-- ---------- 1. Registro con formulario: ahora guarda el permiso ----------
-- Se reemplaza la función (misma lógica que el 10) agregando p_marketing. La app vieja sigue funcionando (es opcional).
drop function if exists public.register_customer(text, text, text, text);
create or replace function public.register_customer(p_name text, p_phone text, p_email text, p_captcha text default null, p_marketing boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if not public.check_captcha(p_captcha) then
    raise exception 'CAPTCHA_INVALIDO:%', coalesce(nullif(current_setting('fly.captcha_motivo', true), ''), 'desconocido');
  end if;
  if length(coalesce(p_phone, '')) < 7 or length(p_phone) > 20 or length(coalesce(p_name, '')) > 80 then raise exception 'DATOS_INVALIDOS'; end if;
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'CORREO_INVALIDO'; end if;
  select data into c from public.customers where phone = p_phone;
  if c is not null then
    -- Ya existe: no se cambia nada (ni el permiso: podría ser el celular de otra persona)
    return jsonb_build_object('name', split_part(coalesce(c->>'name', ''), ' ', 1), 'phone', p_phone, 'email', '',
                              'points', coalesce((c->>'points')::int, 0), 'existing', true);
  end if;
  c := jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', p_name, 'phone', p_phone,
                          'email', lower(left(p_email, 120)), 'points', 0, 'createdAt', (extract(epoch from now()) * 1000)::bigint);
  if p_marketing is not null then
    c := c || jsonb_build_object('marketing', jsonb_build_object('optIn', p_marketing, 'at', (extract(epoch from now()) * 1000)::bigint, 'via', 'registro web'));
  end if;
  insert into public.customers (phone, data) values (p_phone, c);
  return c || jsonb_build_object('existing', false);
end $$;
grant execute on function public.register_customer(text, text, text, text, boolean) to anon, authenticated;

-- ---------- 2. La propia persona (cuenta confirmada) ve y cambia su permiso ----------
create or replace function public.my_marketing() returns boolean
language sql stable security definer set search_path = public as $$
  select (data->'marketing'->>'optIn')::boolean from public.customers
   where public.google_email() <> ''
     and (lower(data->>'email') = public.google_email() or lower(coalesce(data->>'googleEmail', '')) = public.google_email() or phone = 'g:' || public.google_email())
   order by (data->'marketing'->>'at')::bigint desc nulls last limit 1
$$;
revoke execute on function public.my_marketing() from public, anon;
grant execute on function public.my_marketing() to authenticated;

create or replace function public.set_marketing_consent(p_optin boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare em text := public.google_email(); n int;
begin
  if em = '' then raise exception 'SOLO_CUENTA_CONFIRMADA'; end if;
  if p_optin is null then raise exception 'DATOS_INVALIDOS'; end if;
  update public.customers
     set data = data || jsonb_build_object('marketing', jsonb_build_object('optIn', p_optin, 'at', (extract(epoch from now()) * 1000)::bigint, 'via', 'club web'))
   where lower(data->>'email') = em or lower(coalesce(data->>'googleEmail', '')) = em or phone = 'g:' || em;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'SIN_CUENTA'; end if;
  return p_optin;
end $$;
revoke execute on function public.set_marketing_consent(boolean) from public, anon;
grant execute on function public.set_marketing_consent(boolean) to authenticated;

-- ---------- 3. Administración anota el permiso que la persona dio en tienda / WhatsApp ----------
create or replace function public.staff_set_marketing(p_phone text, p_optin boolean, p_note text default '') returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if p_optin is null or coalesce(p_phone, '') = '' then raise exception 'DATOS_INVALIDOS'; end if;
  update public.customers
     set data = data || jsonb_build_object('marketing', jsonb_build_object('optIn', p_optin, 'at', (extract(epoch from now()) * 1000)::bigint,
                                           'via', 'staff', 'by', public.my_staff_name(), 'note', left(coalesce(p_note, ''), 200)))
   where phone = p_phone;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'SIN_CUENTA'; end if;
  perform public.audit('permiso_publicidad', jsonb_build_object('phone', p_phone, 'optIn', p_optin, 'note', left(coalesce(p_note, ''), 200)));
  return p_optin;
end $$;
revoke execute on function public.staff_set_marketing(text, boolean, text) from public, anon;
grant execute on function public.staff_set_marketing(text, boolean, text) to authenticated;

-- =====================================================================
--  LISTO. Comprobación (solo lectura):
--    select proname from pg_proc where proname in ('register_customer','my_marketing','set_marketing_consent','staff_set_marketing');
-- =====================================================================
