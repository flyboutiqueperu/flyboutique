# Kit de pruebas (no toca producción)

## 1. SQL (PostgreSQL 16 local que imita Supabase)
```
bash pruebas/sql/build.sh prueba1          # crea la base con mock2.sql + supabase/08..23 + setup.sql
psql -h /var/lib/flypgtest -p 5499 -U postgres -d prueba1 -f pruebas/sql/t22.sql
```
- `mock2.sql`: tablas como producción (store_data, sales, customers, staff_profiles…).
- `setup.sql`: datos de prueba (staff, productos).
- `tNN.sql`: prueba del SQL número NN.
- Al crear un SQL nuevo: agrégalo a la lista de `build.sh` y crea su `tNN.sql`.
- Si falta PostgreSQL: `apt-get install -y postgresql-16`. El script crea la base de datos si no existe.

## 2. Navegador (Playwright con Supabase simulado)
```
cd pruebas/ui && npm install && cd ../..
VITE_SUPABASE_URL=http://fake.supabase.test VITE_SUPABASE_ANON_KEY=x npx vite build --outDir pruebas/ui/dist --emptyOutDir
mkdir -p /tmp/shots && node pruebas/ui/idioma.cjs /tmp/shots
```
- Cada `*.cjs` levanta un servidor en el puerto 4360, simula las respuestas de Supabase y saca capturas en la carpeta indicada.
- Usa el Chromium de `/opt/pw-browsers`. Si cambia la versión, ajusta `executablePath` en el script.
- Algunos scripts pueden quedar viejos si cambia un texto de un botón: actualiza el texto en el script.

## 3. Pruebas SQL que quedaron viejas (no son fallas de producción)
`t11`, `t19`, `t19b`, `t_user` y `tclub` se escribieron para un estado anterior (por ejemplo, en `setup.sql` el usuario 111… es administrador, no superadmin; `t19` usa `transfer_stock`, reemplazada por las guías del SQL 19; `tclub` vende sin caja abierta). Dan error al correrlas sobre la base completa 08–26. Las de los SQL 20 a 26 pasan.
