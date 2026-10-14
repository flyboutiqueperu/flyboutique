-- FLY BOUTIQUE — VOLVER ATRÁS EL 21: se deja de poder registrar devoluciones parciales y cambios.
-- NO borra datos: las devoluciones ya hechas quedan guardadas en cada venta (returns), en el stock y en la caja.
-- Correr DESPUÉS de hacer Revert del PR en GitHub.
drop function if exists public.find_sale_for_return(text);
drop function if exists public.return_sale(text, jsonb, text, text, jsonb, text, text, text);
create or replace function public.void_sale(p_sale_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  return public.void_sale_core(p_sale_id, p_reason, public.my_staff_name());
end $$;
