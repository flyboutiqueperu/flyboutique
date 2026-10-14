-- FLY BOUTIQUE — VOLVER ATRÁS EL 23: se deja de poder registrar compras y proveedores.
-- NO borra las tablas, los proveedores ni las compras ya registradas, ni el stock que entró.
-- Correr DESPUÉS de hacer Revert del PR en GitHub.
drop function if exists public.register_purchase(bigint, text, text, jsonb, text, boolean, text);
drop function if exists public.void_purchase(bigint, text);
drop function if exists public.upsert_supplier(bigint, text, text, text, text, text, boolean);
revoke select on public.suppliers from authenticated;
revoke select on public.purchases from authenticated;
