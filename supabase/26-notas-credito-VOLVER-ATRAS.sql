-- FLY BOUTIQUE — VOLVER ATRÁS EL 26: se deja de emitir notas de crédito.
-- NO borra la tabla einvoice_notes (quedan las notas ya emitidas). Correr DESPUÉS de hacer Revert del PR.
drop function if exists public.emit_credit_note(text, text);
drop function if exists public.credit_note_apply(text, text, jsonb, jsonb);
drop function if exists public.set_credit_note_series(text, text);
