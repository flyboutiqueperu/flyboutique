-- =====================================================================
--  FLY BOUTIQUE — 10: REGISTRO DEL CLUB FLY (verificación y privacidad)
--  Pegar TODO en Supabase → SQL Editor → New query → Run. No borra datos.
--  No necesita cambios en la app (se puede correr en cualquier momento).
--  Para volver atrás: 10-registro-club-VOLVER-ATRAS.sql
-- =====================================================================

-- ---------- 1. Verificación anti-robots (Cloudflare Turnstile) ----------
-- Hace lo mismo que antes, pero si Cloudflare rechaza o no se puede consultar, anota el MOTIVO
-- (sin claves) para que el mensaje de error lo muestre. Así sabemos por qué falla el registro.
create or replace function public.check_captcha(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare sec text; ok boolean := false; st int; body text;
begin
  select value into sec from public.app_secrets where name = 'turnstile_secret';
  if sec is null or sec = '' then return true; end if;
  if coalesce(p_token, '') = '' then
    perform set_config('fly.captcha_motivo', 'sin-token', true);
    return false;
  end if;
  begin
    select r.status, r.content into st, body
      from extensions.http_post(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        'secret=' || extensions.urlencode(sec) || '&response=' || extensions.urlencode(p_token),
        'application/x-www-form-urlencoded') r;
    ok := coalesce((body::jsonb ->> 'success')::boolean, false);
    if not ok then
      perform set_config('fly.captcha_motivo', coalesce((select string_agg(e, ',') from jsonb_array_elements_text(body::jsonb -> 'error-codes') e), 'http-' || st), true);
    end if;
  exception when others then
    ok := false;
    perform set_config('fly.captcha_motivo', 'sin-conexion: ' || left(sqlerrm, 120), true);
  end;
  return coalesce(ok, false);
end $$;

-- ---------- 2. Registro con formulario: no mostrar datos de otra clienta ----------
-- Antes, si alguien escribía un celular que ya era clienta, la respuesta traía su nombre completo y su correo.
-- Ahora solo devuelve el primer nombre (para el saludo) y nunca el correo.
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
    -- Ya existe: no se cambia nada de la clienta ni se muestra su correo
    return jsonb_build_object('name', split_part(coalesce(c->>'name', ''), ' ', 1), 'phone', p_phone, 'email', '',
                              'points', coalesce((c->>'points')::int, 0), 'existing', true);
  end if;
  c := jsonb_build_object('id', 'cust_' || substr(md5(random()::text), 1, 12), 'name', p_name, 'phone', p_phone,
                          'email', lower(left(p_email, 120)), 'points', 0, 'createdAt', (extract(epoch from now()) * 1000)::bigint);
  insert into public.customers (phone, data) values (p_phone, c);
  return c || jsonb_build_object('existing', false);
end $$;

-- =====================================================================
--  LISTO. Si el registro falla, el aviso de la tienda muestra el código de Cloudflare, por ejemplo:
--    invalid-input-secret  → la clave secreta guardada en app_secrets está mal (o es la clave del sitio)
--    timeout-or-duplicate  → la verificación ya se usó o venció: recargar y volver a intentar
--    sin-conexion          → la base de datos no pudo conectarse con Cloudflare (extensión "http")
-- =====================================================================
