-- FLY BOUTIQUE — VOLVER ATRÁS EL 18: se dejan de usar costos y gastos desde la app. NO borra las tablas ni los datos.
revoke select, insert, update on public.product_costs from authenticated;
revoke select, insert, update on public.expenses from authenticated;
