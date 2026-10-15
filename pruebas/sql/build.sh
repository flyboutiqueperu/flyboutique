#!/bin/bash
# Crea una base de prueba local (NO es Supabase) con las tablas simuladas y TODOS los SQL de /supabase.
# Uso: bash pruebas/sql/build.sh prueba1   → luego: psql -h $PGDIR -p 5499 -U postgres -d prueba1 -f pruebas/sql/t22.sql
set -e
R=$(cd "$(dirname "$0")/../.." && pwd); S=$R/pruebas/sql; H=${PGDIR:-/var/lib/flypgtest}
P="psql -h $H -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
if ! pg_isready -h $H -p 5499 >/dev/null 2>&1; then
  if [ ! -d $H/data ]; then mkdir -p $H && chown postgres $H && runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D $H/data -A trust >/dev/null; fi
  rm -f $H/data/postmaster.pid; runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D $H/data -o "-p 5499 -k $H" -l $H/log start >/dev/null; sleep 3
fi
$P -c "drop database if exists $1" -c "create database $1" >/dev/null 2>&1
$P -d $1 -f $S/mock2.sql >/dev/null
$P -d $1 -c "alter table staff_profiles add constraint staff_profiles_role_check check (role in ('superadmin','administrador','vendedora_tienda','vendedora_online','almacen')); create table auth.users (id uuid primary key, email text, updated_at timestamptz); create table auth.identities (user_id uuid, provider text, identity_data jsonb, updated_at timestamptz); create schema extensions; create table app_secrets (name text primary key, value text); create function extensions.urlencode(t text) returns text language sql as \$\$ select t \$\$; create function extensions.http_post(url text, body text, ct text) returns table(status int, content text) language sql as \$\$ select 200, '{\"success\":true}' \$\$;" >/dev/null
for f in 08-fase2a-VOLVER-ATRAS 08-fase2a-parches 09-fase2b-club-caja 10-registro-club 11-fase2-caja 12-pedidos-sin-pago 13-caja-turnos 14-historial-y-concurrencia 15-acceso-codigo-correo 16-club-contrasena 17-outlet 18-costos-gastos 19-ubicaciones-stock 20-permiso-publicidad 21-devoluciones-cambios 22-vales 23-compras-proveedores 24-consulta-dni-ruc 25-facturacion-nubefact 26-notas-credito; do
  $P -d $1 -f $R/supabase/$f.sql >/dev/null 2>/tmp/fly-err.txt || { echo "FALLA $f"; grep -i error /tmp/fly-err.txt | head -3; }
done
$P -d $1 -f $S/setup.sql >/dev/null
echo "Base $1 lista"
