-- Quita las funciones de asistencia (SQL 31). Las tablas y sus datos (personas, marcas, ajustes) se CONSERVAN.
drop function if exists public.att_clock(text);
drop function if exists public.att_today();
drop function if exists public.att_people_list();
drop function if exists public.att_save_person(bigint, text, numeric, int, numeric, numeric, boolean, text);
drop function if exists public.att_set_pin(bigint, text);
drop function if exists public.att_marks_range(date, date);
drop function if exists public.att_add_mark(bigint, text, timestamptz, text);
drop function if exists public.att_void_mark(bigint, text);
drop function if exists public.att_adjustments_list(date);
drop function if exists public.att_save_adjustment(bigint, date, text, numeric, text);
drop function if exists public.att_void_adjustment(bigint);
drop function if exists public.att_pin_hash(text, text);
