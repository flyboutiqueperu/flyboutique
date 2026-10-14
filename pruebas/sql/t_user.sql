set client_min_messages = warning;
select t_as('{"sub":"22222222-2222-2222-2222-222222222222","aal":"aal1"}');
select t_expect_error($q$ select staff_set_username('22222222-2222-2222-2222-222222222222','ana2') $q$, 'SIN_PERMISO') as vendedora_no_puede;
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal1"}');
select t_expect_error($q$ select staff_set_username('22222222-2222-2222-2222-222222222222','ana2') $q$, 'SIN_PERMISO') as superadmin_sin_codigo_no;
select t_as('{"sub":"11111111-1111-1111-1111-111111111111","aal":"aal2"}');
select t_expect_error($q$ select staff_set_username('22222222-2222-2222-2222-222222222222','admin') $q$, 'USUARIO_EXISTE') as duplicado;
select t_expect_error($q$ select staff_set_username('22222222-2222-2222-2222-222222222222','a b') $q$, 'USUARIO_INVALIDO') as invalido;
select staff_set_username('22222222-2222-2222-2222-222222222222','Ana.Tienda');
select (select email from auth.users where id='22222222-2222-2222-2222-222222222222') as auth_email,
       (select identity_data->>'email' from auth.identities where user_id='22222222-2222-2222-2222-222222222222') as identity_email,
       (select username from staff_profiles where user_id='22222222-2222-2222-2222-222222222222') as perfil;
