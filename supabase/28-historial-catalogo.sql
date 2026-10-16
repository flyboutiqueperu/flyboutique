-- 28 · Historial de cargas masivas del catálogo
-- Importar el Excel de TumiSoft y subir fotos en lote se hacen en el navegador. Esta función deja la constancia en
-- audit_log (Más → Registro de actividad): quién, cuándo y cuántas prendas/fotos. Solo Administración y Super Admin,
-- solo esas dos acciones y con detalles pequeños: no sirve para escribir cualquier cosa en el historial.
-- No borra datos. Para volver atrás: 28-historial-catalogo-VOLVER-ATRAS.sql
create or replace function public.staff_log(p_action text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('superadmin', 'administrador') then raise exception 'SIN_PERMISO'; end if;
  if p_action not in ('catalogo_importado', 'fotos_subidas') then raise exception 'ACCION_INVALIDA'; end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' or length(p_details::text) > 4000 then raise exception 'DETALLE_INVALIDO'; end if;
  perform public.audit(p_action, p_details);
end $$;
revoke execute on function public.staff_log(text, jsonb) from public, anon;
grant execute on function public.staff_log(text, jsonb) to authenticated;
