-- Volver atrás del 29 («Avísame cuando vuelva»). OJO: borra la lista de avisos pedidos (la tabla stock_alerts).
drop function if exists public.set_stock_alert_status(bigint, text);
drop function if exists public.staff_stock_alerts(text);
drop function if exists public.request_stock_alert(text, text, text, text, text, text);
drop table if exists public.stock_alerts;
