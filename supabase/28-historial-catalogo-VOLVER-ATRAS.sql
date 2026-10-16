-- Volver atrás del 28: quita la función. El historial ya guardado en audit_log se conserva (no se borra).
drop function if exists public.staff_log(text, jsonb);
