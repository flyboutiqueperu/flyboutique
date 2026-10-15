-- FLY BOUTIQUE — VOLVER ATRÁS EL 24: se apaga la consulta de DNI/RUC.
-- NO borra las tablas doc_lookups / doc_lookup_log ni el token guardado (se puede borrar el token desde el panel con «-»).
-- Correr DESPUÉS de hacer Revert del PR en GitHub.
drop function if exists public.lookup_document(text, text);
drop function if exists public.set_doc_lookup_config(text, text, text);
drop function if exists public.doc_lookup_status();
drop function if exists public.put_app_secret(text, text);
drop function if exists public.ruc_valido(text);
