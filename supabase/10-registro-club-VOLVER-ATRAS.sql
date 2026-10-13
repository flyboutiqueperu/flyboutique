-- =====================================================================
--  FLY BOUTIQUE — VOLVER ATRÁS EL ARCHIVO 10 (registro del Club)
--  Deja check_captcha y register_customer como estaban el 13-oct-2026. No borra datos.
-- =====================================================================
create or replace function public.check_captcha(p_token text) returns boolean
language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare sec text; ok boolean;
begin
  select value into sec from public.app_secrets where name = 'turnstile_secret';
  if sec is null or sec = '' then return true; end if;
  if coalesce(p_token, '') = '' then return false; end if;
  begin
    select coalesce((r.content::jsonb ->> 'success')::boolean, false) into ok
    from extensions.http_post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      'secret=' || extensions.urlencode(sec) || '&response=' || extensions.urlencode(p_token),
      'application/x-www-form-urlencoded') r;
  exception when others then
    ok := false;
  end;
  return coalesce(ok, false);
end $function$;

create or replace function public.register_customer(p_name text, p_phone text, p_email text, p_captcha text default null::text) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare c jsonb;
begin
  if not public.check_captcha(p_captcha) then raise exception 'CAPTCHA_INVALIDO'; end if;
  if length(coalesce(p_phone, '')) < 7 or length(p_phone) > 20 or length(coalesce(p_name, '')) > 80 then raise exception 'DATOS_INVALIDOS'; end if;
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'CORREO_INVALIDO'; end if;
  select data into c from public.customers where phone = p_phone;
  if c is not null then
    return jsonb_build_object('name', c->>'name', 'phone', p_phone, 'email', coalesce(c->>'email', ''), 'points', coalesce((c->>'points')::int, 0), 'existing', true);
  end if;
  c := jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', p_name, 'phone', p_phone,
                          'email', lower(left(p_email, 120)), 'points', 0, 'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.customers (phone, data) values (p_phone, c);
  return c || jsonb_build_object('existing', false);
end $function$;
