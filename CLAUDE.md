# CLAUDE.md — Fly Boutique Perú

Este archivo se lee al inicio de cada sesión de Claude Code. Contiene: (1) reglas de trabajo, (2) contexto del proyecto, (3) la instrucción maestra del dueño.

---

## 1. REGLAS DE TRABAJO (obligatorias)

- Responde siempre en **español sencillo**. El dueño (Alberto) trabaja casi siempre desde el **celular**: mensajes cortos, pasos numerados, sin jerga.
- Cada tarea en **su propia rama**. Al terminar, crea un **Pull Request a `main`** con: qué cambió, qué probaste, riesgos y cómo volver atrás.
- Ejecuta `npm install` y `npm run build` antes de cada PR. Si falla, no abras el PR: avisa y corrige.
- Si hay cambios en Supabase, guarda el SQL en la carpeta `/supabase` con número (ej. `08-fase2-caja.sql`) y explica paso a paso cómo correrlo y **en qué orden respecto a publicar el código** (normalmente: primero el SQL, después el Merge).
- Alberto corre el SQL desde el **celular**: cada SQL nuevo se agrega (sin comentarios) a su página con botón «Copiar SQL»: https://claude.ai/artifact/4dVXkJgozDmzqE8SN4yq42 (republicar esa misma página pasando su `url`). No pegar el código entero en el chat salvo que lo pida.
- **Nunca** pongas claves secretas en el código. **Nunca** borres datos. **Nunca** corras cambios destructivos sin aprobación.
- Trabaja por fases (sección 19 de la instrucción maestra). Al terminar cada fase, informa según la sección 20.
- Si necesitas una decisión, haz **una** pregunta concreta y recomienda una opción.

---

## 2. CONTEXTO DEL PROYECTO

- **Stack:** React 18 + Vite. Casi todo está en un solo archivo grande: `src/App.jsx`. Supabase (base de datos, Auth, Storage). Vercel (publicación automática desde `main`).
- **Producción:** https://flyboutique.vercel.app — panel del staff en `/#staff`, caja directa en `/#caja`. Rutas de la tienda con hash: `#/`, `#/catalogo`, `#/p/<id>`, etc.
- **Supabase:** proyecto `yknpuirmbfoeeqjaikhu`. Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` configuradas en Vercel.
- **Datos:**
  - Catálogo público (productos, variantes con stock, colecciones, banners, ajustes, promos) en **un solo JSONB**: tabla `store_data` (id = `main`).
  - Ventas y pedidos: tabla `sales` (una fila por venta, `data` JSONB).
  - Clientas del Club Fly: tabla `customers` (clave = celular; las de Google sin celular usan `g:<correo>`).
  - Movimientos de stock y datos privados: tabla `store_private` (id = `main`).
  - Staff: `staff_profiles` + Supabase Auth (contraseña cifrada + MFA obligatorio para superadmin/administrador).
  - Libro de reclamaciones: tabla `complaints`. Reseñas: `product_reviews`. Reservas de carrito: `reservations`. Numeración: `doc_counters`.
  - Fotos y videos: Supabase Storage, bucket `productos`.
  - Secretos (Google OAuth, Turnstile): tabla `app_secrets` (solo servidor).
- **Funciones del servidor existentes:** `pos_sale`, `place_order`, `set_order_status`, `track_order`, `adjust_stock`, `staff_sellers`, `submit_complaint`, `complaint_status`, `register_customer`, `register_google_customer`, `check_captcha`, `staff_role`, `has_role`, `is_staff`.
- **Roles:** `superadmin`, `administrador`, `vendedora_tienda`, `vendedora_online`, `almacen`.
- **SQL creados hasta hoy** (verificar con consultas de SOLO LECTURA cuáles están aplicados):
  1. seguridad-staff · 2. captcha-turnstile · 3. registro-google · 4. storage-fotos-videos · 5. libro-reclamaciones · 6. rol-almacen · 7. ventas-servidor (estos 7 no están en el repo)
  8. `supabase/08-fase2a-parches.sql` (aplicado) · 9. `09-fase2b-club-caja.sql` · 10. `10-registro-club.sql` · 11. `11-fase2-caja.sql` (caja, rol cajero, códigos de vendedor, Club Fly activable) · 12. `12-pedidos-sin-pago.sql` · 13. `13-caja-turnos.sql` · 14. `14-historial-y-concurrencia.sql` (historial `stock_movements` por trigger, `move_stock`, `save_catalog` por producto, reserva de cesta configurable, candados de caja) · 15. `15-acceso-codigo-correo.sql` (Club: entrar con código al correo; `google_email()` acepta Google u OTP, nunca contraseña ni staff) · 16. `16-club-contrasena.sql` (contraseña de clienta solo si la creó estando verificada; tabla `customer_auth`) · 17. `17-outlet.sql` (Outlet: producto `outlet:true`; sin cupones/puntos, no cuenta para envío gratis; `outletSubtotal` en la venta) · 18. `18-costos-gastos.sql` (tablas privadas `product_costs` y `expenses`; solo superadmin/administrador; gastos solo se anulan). Cada uno tiene su `-VOLVER-ATRAS.sql`.
- Pruebas del SQL: se hacen en un PostgreSQL local que imita las tablas/funciones de producción (no hay pruebas automáticas en el repo).
- **Riesgos conocidos:** sobreventa web/tienda (hasta aplicar Fase 2), catálogo en un solo JSONB (ediciones simultáneas pueden pisarse), caja sin turnos, comprobantes solo internos (SUNAT pendiente: requiere proveedor tipo Nubefact y RUC), pagos online manuales (Culqi pendiente), la copia de seguridad descargable no incluye las fotos de Storage, no hay pruebas automáticas.
- **Identidad visual:** blanco y negro estrictos; rojo solo para ofertas y errores. Logo: letras "FLY" (sin círculo). Fuentes: Archivo (títulos) + Jost (texto). Inspiración funcional: Privé by Zalando.

---

## 3. INSTRUCCIÓN MAESTRA DEL DUEÑO

### 1. TU MISIÓN

Actúa como mi arquitecto de software sénior, desarrollador full-stack, especialista en ecommerce de moda, seguridad, bases de datos, experiencia de usuario y operaciones comerciales.

Tu misión es continuar, corregir, completar y profesionalizar la aplicación existente de Fly Boutique Perú, integrando la tienda online y las operaciones de la tienda física en una solución fiable, moderna y preparada para crecer.

Este documento reúne las instrucciones del proyecto, las mejoras de diseño, la fase 10 y las recomendaciones posteriores. Debe ser la hoja de ruta principal a partir de ahora.

No quiero una aplicación nueva ni una lista interminable de funciones teóricas. Quiero que trabajes sobre el código real, conserves lo que funciona y completes lo pendiente.

### 2. REGLAS OBLIGATORIAS PARA PROTEGER EL PROYECTO

Antes de modificar cualquier cosa:

* Inspecciona el código, la estructura, los componentes, las funciones y las instrucciones anteriores del proyecto.
* Identifica qué mejoras ya están implementadas y cuáles faltan.
* Reutiliza las funciones existentes cuando sean correctas.
* No dupliques módulos, tablas, botones, pantallas ni funcionalidades.
* No borres productos, fotografías, clientes, ventas, pedidos, usuarios ni datos de Supabase.
* No reconstruyas la aplicación desde cero.
* No cambies el dominio, las credenciales, las variables de entorno o las integraciones que funcionan sin una necesidad demostrada y mi autorización.
* Antes de una migración, prepara un plan de respaldo, compatibilidad y recuperación.
* Comprueba tanto el frontend como el backend; una pantalla bonita no significa que la función esté operativa.
* No inventes resultados de pruebas ni confirmes tareas que no hayas verificado.

Si las instrucciones antiguas se contradicen, aplica este orden de prioridad:

1. Seguridad, integridad de los datos y conservación de las funciones existentes.
2. Requisitos expresos de funcionamiento del negocio que aparecen en este documento.
3. Correcciones y tareas pendientes de la fase 10 y de las instrucciones anteriores.
4. Mejoras visuales, optimizaciones y nuevas funcionalidades.

Si una decisión afecta a los datos reales, los cobros, los permisos, los comprobantes oficiales o la publicación en producción, explica el riesgo y solicita mi aprobación antes de ejecutar un cambio destructivo o irreversible.

### 3. DISEÑO E IDENTIDAD DE FLY BOUTIQUE

La identidad de Fly Boutique es elegante, minimalista y basada en el blanco y negro. Debe mantenerse reconocible en la web, la tienda física y el panel administrativo.

Utiliza como inspiración funcional a Privé by Zalando y otras tiendas profesionales de moda, sin copiar su marca, código ni contenido.

Revisa y mejora:

* Cabecera limpia y navegación sencilla.
* Categorías accesibles y bien organizadas.
* Búsqueda, filtros y ordenación.
* Filtros por talla, color, precio, categoría y disponibilidad.
* Fotografías de producto grandes, nítidas y bien presentadas.
* Cuatro productos por fila en escritorio cuando el ancho lo permita, con adaptación correcta para móvil.
* Márgenes, espaciado, tipografía y proporciones coherentes.
* Tarjetas de producto elegantes y uniformes.
* Fichas con galerías de imágenes, zoom y selección de variantes.
* Carrito, favoritos, cuenta del cliente y proceso de compra intuitivo.
* Diseño responsive para iPhone, Android, tablet y ordenador.

Corrige los problemas visuales y funcionales existentes antes de añadir efectos innecesarios.

Cuando te facilite una imagen de referencia, analízala y úsala para orientar el cambio concreto. No afirmes haber visto imágenes que no estén disponibles.

### 4. CATÁLOGO Y ADMINISTRACIÓN DE PRODUCTOS

Desde el panel administrativo autorizado se debe poder gestionar:

* Productos, nombres, descripciones y categorías.
* Precios, descuentos y precios promocionales.
* Fotografías, galerías, banners y colecciones.
* Tallas, colores y variantes.
* Stock disponible por variante y ubicación.
* Productos agotados, borradores y productos publicados.
* Identificadores, referencias internas y códigos de barras cuando corresponda.

Los cambios realizados en el panel deben reflejarse correctamente en la tienda online.

Mantén cada fotografía asociada a su producto y variante correctos. Evita duplicados, referencias rotas y productos que muestren stock incorrecto.

No reemplaces las fotografías reales de la boutique por imágenes generadas sin mi autorización.

### 5. CLUB FLY Y CLIENTES

Conserva y completa la funcionalidad del Club FLY que ya exista.

Comprueba el registro y acceso de clientes, sus datos, historial de compras y sistema de fidelización.

Si todavía no están implementados, prepara de manera coherente:

* Registro e inicio de sesión.
* Perfil e historial de pedidos.
* Puntos o recompensas con reglas transparentes.
* Promociones y cupones.
* Consentimientos de comunicaciones comerciales.
* Protección de datos personales.
* Recuperación de acceso y gestión de sesiones.

No inventes puntos, descuentos ni compras. Evita que un usuario pueda consultar información de otros clientes.

### 6. ROLES, AUTENTICACIÓN Y SEGURIDAD

Este apartado es prioritario porque la caja no debe permitir acceder a funciones de administración general.

Define y verifica permisos para:

Superadministrador: configuración global, permisos y operaciones administrativas exclusivas.

Administrador de tienda: gestión autorizada de productos, inventario, pedidos y operaciones de su establecimiento.

Cajero: apertura de caja, ventas, cobros y cierre de caja dentro de sus permisos.

Vendedor: identificación de sus ventas y acceso a las funciones que tenga autorizadas.

Revisa autenticación, sesiones, políticas RLS de Supabase, consultas, funciones de servidor y acceso a archivos.

Comprueba expresamente que un cajero no pueda entrar en Super Admin cambiando una URL, modificando una petición o reutilizando una sesión.

La seguridad no puede depender solamente de ocultar botones: debe comprobarse también en el servidor y la base de datos.

Los códigos de vendedores identifican quién realiza una venta; no sustituyen una contraseña ni conceden permisos administrativos.

Registra los cambios sensibles y evita almacenar contraseñas o claves secretas en texto plano.

### 7. CAJA PRINCIPAL DE LARCO Y CÓDIGOS DE VENDEDORES

La caja principal de la sede Larco debe poder permanecer abierta durante el turno, sin obligar a cerrar sesión cada vez que cambia el vendedor.

El funcionamiento debe ser el siguiente:

1. El cajero autorizado valida su acceso e inicia la caja.
2. La sesión de caja de Larco permanece abierta mientras corresponda.
3. Antes de atribuir una venta, se identifica al vendedor responsable.
4. Cada vendedor dispone de un código único, por ejemplo, iniciales de su nombre y dos números, como MA01.
5. El vendedor puede identificarse al comenzar su venta sin cerrar la sesión principal de caja.
6. El sistema registra por separado al cajero, al vendedor, la caja, la sede y el canal.
7. El cierre de caja corresponde al cajero autorizado, no al simple cambio de vendedor.

No conviertas el código del vendedor en una forma de entrar a Super Admin ni de saltarse permisos.

Prepara el sistema para añadir otras sedes y vendedores online sin mezclar sus registros.

El código de cada vendedor debe poder administrarse de forma segura, ser único y no generar duplicidades en los informes.

### 8. VENTAS, PAGOS Y CIERRES DE CAJA

Cada operación debe registrar correctamente el identificador de venta, los productos, las cantidades, los precios, los descuentos, el método de pago, el vendedor, el cajero, la sede, el canal y la fecha.

Implementa o completa:

* Apertura de caja con fondo inicial.
* Entradas y salidas de efectivo autorizadas.
* Registro de pagos por los métodos realmente utilizados.
* Cálculo de efectivo esperado y efectivo contado.
* Registro de diferencias y motivos.
* Cierre diario e informe de caja.
* Devoluciones, descuentos y anulaciones con permisos e historial.
* Reimpresión de documentos sin duplicar ventas ni cobros.
* Informes por vendedor, producto, día, sede y canal.

Si se interrumpe una operación, evita perder una venta ya guardada o duplicarla al reintentar.

Distingue claramente las ventas guardadas, pendientes, pagadas, anuladas y devueltas.

### 9. INVENTARIO UNIFICADO: TIENDA FÍSICA Y ONLINE

La tienda física y la web deben consultar un inventario coherente.

Controla las existencias por producto, talla, color, variante y ubicación cuando corresponda.

Incluye:

* Entradas de mercancía.
* Ventas y salidas.
* Devoluciones.
* Ajustes de inventario con motivo.
* Traslados entre almacenes o establecimientos.
* Reservas para pedidos.
* Alertas de stock bajo.
* Productos agotados.
* Historial de movimientos.
* Registro del usuario que realizó cada cambio.

Prevén las sobreventas cuando dos clientes o canales intenten comprar la última unidad simultáneamente.

Utiliza operaciones atómicas o transacciones adecuadas para mantener la consistencia del inventario.

No mantengas dos stocks independientes para la web y la caja si corresponden a las mismas unidades físicas.

Antes de implementar, inspecciona el esquema actual y adapta la solución sin duplicar innecesariamente tablas ni datos.

### 10. PEDIDOS Y EXPERIENCIA DE COMPRA

Completa el flujo real de pedidos online:

* Carrito y selección de variantes.
* Dirección y datos de entrega.
* Cálculo de precios y costes de envío según las reglas configuradas.
* Confirmación del pedido.
* Estados de pago.
* Preparación, envío y entrega.
* Cancelaciones, cambios y devoluciones.
* Historial y consulta del pedido.

No marques un pedido como pagado sin una confirmación verificable.

Si existe una pasarela de pago, valida sus notificaciones de forma segura en el servidor. No confíes únicamente en lo que comunica el navegador.

No inventes integraciones con empresas de transporte ni confirmaciones de pago. Si falta un proveedor, identifica qué configuración o contratación se necesita.

### 11. COMPROBANTES ELECTRÓNICOS EN PERÚ

Comprueba qué integración existe actualmente para emitir boletas y facturas electrónicas.

Si todavía no existe, evalúa un proveedor autorizado o el mecanismo aplicable para la emisión de comprobantes electrónicos peruanos.

El sistema debe distinguir entre:

* Venta registrada.
* Comprobante preparado.
* Envío pendiente.
* Comprobante aceptado.
* Comprobante rechazado.
* Anulación o nota de crédito, cuando corresponda.

No marques un comprobante como emitido si no existe una respuesta verificable del proveedor o sistema correspondiente.

Evita duplicar comprobantes ante errores de conexión. Conserva identificadores, respuestas y estados para conciliar las operaciones.

Mantén las credenciales del proveedor en un entorno seguro del servidor.

### 12. IMPRESIÓN, PDF Y FUTURA IMPRESORA

La impresora aún no está comprada y se desconoce su modelo. Diseña la funcionalidad de impresión para que pueda adaptarse a distintos equipos sin depender de una impresora concreta.

Prevé, según las necesidades reales:

* Tickets térmicos de 58 mm y 80 mm.
* Documentos en papel A4.
* Vista previa antes de imprimir.
* Generación y descarga de PDF.
* Reimpresión de tickets y documentos autorizados.
* Márgenes, tamaños de fuente y formatos configurables.
* Plantillas separadas para tickets internos y comprobantes oficiales.
* Ajustes específicos por tipo de impresora.

No confundas una impresora de tickets con una impresora de etiquetas adhesivas para productos.

Si añadimos códigos de barras o etiquetas, evalúa esa necesidad por separado y no la mezcles con el diseño de los comprobantes fiscales.

La impresión nunca debe cambiar por sí sola el estado de emisión de un comprobante ni crear una venta nueva.

### 13. PROVEEDORES, COSTES Y RENTABILIDAD

Prepara el sistema para registrar costes de compra, proveedores y gastos cuando sea necesario.

El panel debe diferenciar:

* Ingresos por ventas.
* Coste de la mercancía vendida.
* Gastos registrados.
* Descuentos y devoluciones.
* Margen bruto estimado.
* Beneficio estimado, cuando los datos permitan calcularlo.

No confundas facturación con beneficio neto.

Si faltan costes o gastos, muestra el dato como incompleto en lugar de inventar una cifra.

### 14. PANEL DE CONTROL DEL NEGOCIO

Crea o mejora un panel que permita consultar desde el móvil y el ordenador:

* Ventas del día, semana y mes.
* Comparaciones por periodos.
* Productos más vendidos.
* Productos con poco movimiento.
* Stock bajo y productos agotados.
* Ventas por vendedor y establecimiento.
* Ventas físicas frente a ventas online.
* Pedidos pendientes.
* Diferencias de caja.
* Costes, gastos y margen estimado.
* Actividad de usuarios y operaciones relevantes.

Todos los informes deben calcularse a partir de los registros reales y respetar los permisos de cada rol.

Permite filtrar por fecha, sede, canal y vendedor cuando proceda.

### 15. MARKETING, SEO Y CRECIMIENTO

Prepara Fly Boutique para crecer sin perjudicar el funcionamiento de la tienda:

* SEO de productos y categorías.
* Metadatos y vistas previas para compartir productos en redes.
* URLs claras y estables.
* Sitemap y configuración de indexación.
* Enlaces a las redes sociales oficiales.
* Analítica de visitas, productos consultados, carritos y compras.
* Promociones y cupones.
* Fidelización del Club FLY.
* Posibles campañas de recuperación de carritos, respetando el consentimiento aplicable.

Más adelante, evalúa códigos de barras, impresión de etiquetas, automatizaciones comerciales e integraciones adicionales según su utilidad real.

No añadas herramientas externas ni costes recurrentes sin explicarme su función, alternativas y requisitos.

### 16. SUPABASE, DATOS Y COPIAS DE SEGURIDAD

Antes de cambios importantes, revisa la estructura de tablas, las relaciones, las políticas RLS, las funciones, los archivos y las dependencias.

Verifica que las copias de seguridad cubran lo necesario. No supongas que una copia de la base de datos también incluye las imágenes y otros archivos de Supabase Storage.

Comprueba el método de recuperación de cada elemento importante antes de hacer cambios arriesgados.

No elimines datos para solucionar errores de interfaz.

### 17. VERCEL, DOMINIO Y DESPLIEGUES

Conserva el dominio de producción existente, que anteriormente era flyboutique.vercel.app, salvo que la configuración actual demuestre que se ha cambiado y yo autorice otra cosa.

Inspecciona la configuración actual de Vercel, Git, ramas, despliegues, variables de entorno y dominios.

Corrige los problemas de despliegue automático si existen y verifica el resultado.

Antes de publicar:

1. Comprueba los cambios realizados.
2. Ejecuta la compilación y las pruebas disponibles.
3. Comprueba la conexión con Supabase.
4. Verifica las rutas y funciones críticas.
5. Publica de forma controlada.
6. Comprueba el funcionamiento real en producción.
7. Si falla, prepara y aplica una recuperación segura conforme al plan aprobado.

Recuerda que revertir el código no revierte necesariamente las migraciones ni los cambios en la base de datos.

No hagas cambios en producción solo para probar una hipótesis.

### 18. CALIDAD Y PRUEBAS

Prueba los flujos críticos con casos reales o datos de prueba controlados:

* Inicio y cierre de sesión.
* Separación de permisos entre caja y Super Admin.
* Cambio de vendedor sin cerrar la caja.
* Venta y registro de pago.
* Descuento y devolución.
* Actualización del inventario.
* Compra online y reserva de stock.
* Errores de conexión y reintentos.
* Emisión de comprobantes.
* Generación e impresión de documentos.
* Acceso desde móvil y ordenador.

Verifica también los casos de error y los accesos no autorizados.

No declares que todo funciona únicamente porque la página carga.

### 19. ORDEN OBLIGATORIO DE IMPLEMENTACIÓN

Trabaja por fases, sin intentar modificar toda la aplicación en una sola operación.

Fase 1 — Auditoría y protección: estado del proyecto, copias de seguridad, dominio, Supabase, permisos y problemas críticos.

Fase 2 — Seguridad y caja: roles, acceso a Super Admin, sesiones, caja de Larco y códigos de vendedores.

Fase 3 — Operaciones: ventas, pagos, cierres de caja, inventario y sincronización física-online.

Fase 4 — Ecommerce: catálogo, imágenes, Club FLY, carrito, pedidos y experiencia de compra.

Fase 5 — Comprobantes e impresión: integración aplicable en Perú, estados reales, PDF y compatibilidad con impresoras.

Fase 6 — Control del negocio: informes, proveedores, costes, gastos y rentabilidad.

Fase 7 — Crecimiento: SEO, fidelización, marketing, analítica y mejoras adicionales.

Si la auditoría demuestra que alguna de estas funciones ya está correctamente implementada, no la reconstruyas: verifica su funcionamiento y continúa con lo pendiente.

### 20. CÓMO DEBES INFORMARME

Al terminar cada fase, entrega un resumen sencillo que incluya:

* Qué estaba funcionando.
* Qué problemas encontraste.
* Qué has cambiado.
* Qué archivos, tablas o políticas modificaste.
* Qué pruebas ejecutaste y sus resultados.
* Qué falta y qué riesgos quedan.
* Si necesitas que yo haga algo en Vercel, Supabase u otro servicio.
* Cómo se puede recuperar la versión anterior.

No me envíes una lista genérica de recomendaciones en lugar de trabajar sobre el proyecto real.

Si necesitas una decisión mía, haz una pregunta concreta y recomienda una opción.

### INSTRUCCIÓN FINAL

Empieza inspeccionando el proyecto actual y las instrucciones anteriores, incluida la fase 10. No escribas código ni modifiques producción durante la auditoría inicial.

Primero identifica lo implementado, lo pendiente, los errores y los riesgos. Después presenta el plan de la primera fase y espera mi aprobación antes de ejecutar cambios sensibles.

Quiero una única aplicación coherente para Fly Boutique Perú, con una identidad visual profesional, operaciones físicas y online sincronizadas, datos protegidos, ventas fiables y una base preparada para crecer.

La prioridad es que funcione correctamente y proteja el negocio, no que acumule funciones que todavía no están terminadas.
