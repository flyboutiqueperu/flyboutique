-- FLY BOUTIQUE — VOLVER ATRÁS EL 20: se dejan de usar las funciones del permiso de publicidad.
-- NO borra datos: los permisos ya guardados quedan dentro de cada clienta (campo marketing).
-- El registro vuelve a la versión del 10 (sin permiso). Correr DESPUÉS de hacer Revert del PR en GitHub.
drop function if exists public.staff_set_marketing(text, boolean, text);
drop function if exists public.set_marketing_consent(boolean);
drop function if exists public.my_marketing();
drop function if exists public.register_customer(text, text, text, text, boolean);
create or replace function public.register_customer(p_name text, p_phone text, p_email text, p_captcha text default null) returns jsonb
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
    return jsonb_build_object('name', split_part(coalesce(c->>'name', ''), ' ', 1), 'phone', p_phone, 'email', '',
                              'points', coalesce((c->>'points')::int, 0), 'existing', true);
  end if;
  c := jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', p_name, 'phone', p_phone,
                          'email', lower(left(p_email, 120)), 'points', 0, 'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.customers (phone, data) values (p_phone, c);
  return c || jsonb_build_object('existing', false);
end $$;
grant execute on function public.register_customer(text, text, text, text) to anon, authenticated;
