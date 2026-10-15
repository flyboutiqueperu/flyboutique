-- FLY BOUTIQUE — VOLVER ATRÁS EL 25: se apaga la emisión de boletas y facturas electrónicas.
-- NO borra la tabla einvoices (quedan los comprobantes ya emitidos y sus enlaces) ni la configuración guardada.
-- Correr DESPUÉS de hacer Revert del PR en GitHub.
drop function if exists public.emit_einvoice(text);
drop function if exists public.refresh_einvoice(text);
drop function if exists public.void_einvoice(text, text);
drop function if exists public.set_einvoice_config(text, text, text, text, boolean, int, int);
drop function if exists public.einvoice_status();
drop function if exists public.einvoice_apply(text, jsonb, jsonb);
drop function if exists public.einvoice_payload(jsonb, int, text, int);
drop function if exists public.nubefact_call(jsonb);
drop function if exists public.einv_secret(text);
