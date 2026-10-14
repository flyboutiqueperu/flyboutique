-- FLY BOUTIQUE — VOLVER ATRÁS EL 22: se dejan de usar los vales (no se descuentan ni se crean).
-- NO borra la tabla ni los vales ya creados. Correr DESPUÉS de hacer Revert del PR en GitHub.
drop trigger if exists trg_sales_store_credit on public.sales;
drop function if exists public.credit_lookup(text);
drop function if exists public.void_credit(text, text);
revoke select on public.store_credits from authenticated;
