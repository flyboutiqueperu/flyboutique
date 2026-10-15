// Prueba de la línea «Para continuar: …» bajo los botones apagados: dice exactamente qué falta y desaparece al completar.
// Revisa: cesta/checkout (ES y EN), libro de reclamaciones, editor de producto, usuarios y vendedores. Uso: DIST=<carpeta dist> node pruebas/ui/faltan.cjs <carpeta capturas>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4386);
const URL0 = "http://localhost:4386";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["M"])], collections: [], banners: [], settings: {}, promoCodes: [] };
const profile = { user_id: "u1", username: "ana", name: "Ana Admin", role: "superadmin", active: true };
let ok = true; const check = (t, v) => { console.log(v ? "OK   " : "FALLA", t); if (!v) ok = false; };
const route = (p) => p.route("http://fake.supabase.test/**", async (rt) => {
  const u = rt.request().url();
  if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
  if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
  if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
  if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
  if (u.includes("staff_profiles")) return rt.fulfill({ json: u.includes("order=") ? [profile] : profile });
  if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
  return rt.fulfill({ json: [] });
});
// Texto de la línea «faltan» visible (o "" si no hay)
const faltan = async (p) => { const l = p.locator(".faltan:visible"); return (await l.count()) ? (await l.first().innerText()).trim() : ""; };

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  p.on("dialog", (d) => d.accept());
  await route(p);
  const visit = async (u) => { await p.evaluate((x) => { history.pushState(null, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, u); await p.waitForTimeout(700); };

  // ---------- 1. Checkout web ----------
  await p.goto(URL0 + "/"); await p.waitForTimeout(1500);
  await visit("/p/p1"); await p.locator("button:visible", { hasText: /agregar a la cesta/i }).first().click(); await p.waitForTimeout(500);
  await visit("/cart");
  const confirmBtn = p.locator("button", { hasText: "Confirmar pedido por WhatsApp" });
  let f = await faltan(p);
  check("checkout (recojo, Yape): " + f, f === "Para continuar: escribe tu nombre, escribe un celular válido, escribe el número de operación del pago.");
  check("botón apagado", await confirmBtn.isDisabled());
  await p.click("text=Delivery en Trujillo"); await p.waitForTimeout(300);
  f = await faltan(p);
  check("delivery pide dirección y distrito: " + f, f.includes("escribe la dirección (calle y número)") && f.includes("elige el distrito"));
  await p.fill('input[placeholder="Tu nombre *"]', "Lucía Pérez");
  await p.fill('input[placeholder^="Dirección (calle"]', "Av. España 123"); await p.waitForTimeout(200);
  f = await faltan(p);
  check("ya no pide nombre ni dirección: " + f, !f.includes("tu nombre") && !f.includes("calle y número") && f.includes("elige el distrito") && f.includes("celular"));
  await p.locator("select", { has: p.locator("option", { hasText: "Distrito en Trujillo" }) }).selectOption({ index: 1 });
  await p.locator('input[inputmode="tel"]:visible').first().fill("987654321").catch(() => {});
  await p.waitForTimeout(200);
  f = await faltan(p);
  if (f.includes("celular")) { const ph = p.locator('input[placeholder^="Celular"]'); if (await ph.count()) { await ph.fill("987654321"); await p.waitForTimeout(200); f = await faltan(p); } }
  check("solo falta el n.° de operación: " + f, f === "Para continuar: escribe el número de operación del pago.");
  await p.fill('input[placeholder="Número de operación del pago"]', "123456"); await p.waitForTimeout(200);
  check("al completar, la línea desaparece", (await faltan(p)) === "");
  check("botón encendido", !(await confirmBtn.isDisabled()));
  await p.screenshot({ path: `${out}/faltan-checkout-ok.png` });
  // En inglés
  await p.fill('input[placeholder="Tu nombre *"]', "");
  await p.locator("button[title='English']:visible").first().click(); await p.waitForTimeout(400);
  f = await faltan(p);
  check("en inglés: " + f, f === "To continue: enter your name.");
  await p.screenshot({ path: `${out}/faltan-checkout-en.png` });
  await p.locator("button[title='Español']:visible").first().click(); await p.waitForTimeout(300);

  // ---------- 2. Libro de reclamaciones ----------
  await visit("/complaints");
  const sendBtn = p.locator("button", { hasText: "Enviar hoja de reclamación" });
  f = await faltan(p);
  check("reclamo vacío lista todo: " + f.slice(0, 120) + "…", ["escribe tu nombre completo", "escribe tu número de documento", "escribe tu domicilio", "escribe un correo válido", "escribe un teléfono válido", "describe el producto o servicio", "cuenta qué pasó (al menos 10 letras)", "escribe qué solicitas", "marca la declaración de datos verdaderos"].every((x) => f.includes(x)) && !f.includes("apoderado"));
  await p.check("text=Soy menor de edad"); await p.waitForTimeout(150);
  check("menor de edad pide apoderado", (await faltan(p)).includes("padre, madre o apoderado"));
  await p.fill('input[placeholder="Nombres y apellidos"]', "Lucía Pérez Ruiz");
  await p.fill('input[placeholder="Número de documento"]', "12345678");
  await p.fill('input[placeholder="Domicilio"]', "Av. España 123");
  await p.fill('input[placeholder^="Correo electrónico"]', "lucia@correo.pe");
  await p.locator('input[inputmode="tel"]:visible').first().fill("987654321").catch(() => {});
  await p.fill('input[placeholder="Nombre del padre, madre o apoderado"]', "Rosa Ruiz");
  await p.fill('input[placeholder="Descripción del producto o servicio"]', "Blusa Seda Marfil");
  await p.fill('textarea[placeholder="Cuéntanos qué pasó"]', "Llegó manchada");
  await p.waitForTimeout(200);
  f = await faltan(p);
  check("quedan solo solicitud y declaración (y teléfono si no se llenó): " + f, f.includes("escribe qué solicitas") && f.includes("marca la declaración") && !f.includes("nombre completo") && !f.includes("cuenta qué pasó"));
  await p.fill('textarea[placeholder^="¿Qué solicitas?"]', "Cambio");
  await p.locator("label", { hasText: "Declaro que los datos son verdaderos" }).locator("input").check();
  await p.waitForTimeout(200);
  f = await faltan(p);
  if (f.includes("teléfono")) console.log("  (el teléfono no se llenó con el selector genérico)");
  check("reclamo completo: sin línea y botón encendido", f === "" && !(await sendBtn.isDisabled()));
  await p.screenshot({ path: `${out}/faltan-reclamo.png` });

  // ---------- 3. Seguir mi pedido ----------
  await visit("/track");
  f = await faltan(p);
  check("rastreo: " + f, f.includes("escribe el número de pedido") && f.includes("celular con el que compraste"));
  await p.fill('input[placeholder="Número de pedido"]', "B001-000123"); await p.waitForTimeout(150);
  check("rastreo sin pedido pendiente", !(await faltan(p)).includes("número de pedido"));
  // En inglés: reclamaciones y rastreo sin frases en español
  await p.locator("button[title='English']:visible").first().click(); await p.waitForTimeout(300);
  f = await faltan(p); check("rastreo en inglés: " + f, f === "To continue: enter the mobile number you ordered with.");
  await visit("/complaints"); await p.fill('input[placeholder="Full name"]', "").catch(() => {});
  f = await faltan(p); check("reclamaciones en inglés sin español: " + f, f === "" || (f.startsWith("To continue:") && !/\bescribe |marca la |cuenta qué|describe el /.test(f)));
  await p.locator("button[title='Español']:visible").first().click(); await p.waitForTimeout(300);

  // ---------- 4. Staff (superadmin) ----------
  await p.goto(URL0 + "/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  check("staff en español (sin «To continue»)", !(await p.innerText("body")).includes("To continue"));
  // Editor de producto
  await p.goto(URL0 + "/#staff/productEditor"); await p.waitForTimeout(2000);
  if (!(await p.locator("text=Guardar producto").count())) { await p.goto(URL0 + "/#staff/products"); await p.waitForTimeout(1500); await p.locator("button", { hasText: /^\s*Nuevo\s*$/ }).first().click(); await p.waitForTimeout(800); }
  const saveP = p.locator("button", { hasText: "Guardar producto" });
  f = await faltan(p);
  check("producto vacío: " + f, f === "Para continuar: escribe el nombre, pon el precio, elige al menos una talla, agrega al menos un color.");
  check("guardar producto apagado", await saveP.isDisabled());
  await p.fill('input[placeholder="Ej. Vestido Midi Coralina"]', "Vestido Prueba");
  await p.fill('input[placeholder="189"]', "150");
  await p.locator("button", { hasText: /^\+ M$/ }).first().click(); await p.waitForTimeout(150);
  f = await faltan(p);
  check("solo falta el color: " + f, f === "Para continuar: agrega al menos un color.");
  await p.fill('input[placeholder="Nombre del color"]', "Negro"); await p.press('input[placeholder="Nombre del color"]', "Enter"); await p.waitForTimeout(200);
  check("producto completo: sin línea y botón encendido", (await faltan(p)) === "" && !(await saveP.isDisabled()));
  await p.screenshot({ path: `${out}/faltan-producto.png` });
  // Usuarios
  await p.goto(URL0 + "/#staff/users"); await p.reload(); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/faltan-usuarios-lista.png` });
  await p.locator("button", { hasText: /^\s*Nuevo\s*$/ }).first().click(); await p.waitForTimeout(500);
  f = await faltan(p);
  check("usuario nuevo: " + f, f === "Para continuar: escribe el nombre completo, escribe el usuario, la contraseña debe tener al menos 8 caracteres.");
  await p.locator('span:text-is("Nombre completo") + input').fill("Carla Cajera");
  await p.locator('span:text-is("Usuario (para iniciar sesión)") + input').fill("carla");
  await p.locator('input[autocomplete="new-password"]').fill("1234");
  await p.waitForTimeout(150);
  check("usuario: solo la contraseña corta", (await faltan(p)) === "Para continuar: la contraseña debe tener al menos 8 caracteres.");
  await p.locator('input[autocomplete="new-password"]').fill("12345678"); await p.waitForTimeout(150);
  check("usuario completo: sin línea", (await faltan(p)) === "" && !(await p.locator("button", { hasText: "Crear usuario" }).isDisabled()));
  // Vendedores
  await p.goto(URL0 + "/#staff/sellers"); await p.reload(); await p.waitForTimeout(2500);
  await p.locator("button", { hasText: "Nuevo código" }).click(); await p.waitForTimeout(400);
  f = await faltan(p);
  check("vendedora nueva: " + f, f === "Para continuar: escribe el nombre de la vendedora, escribe el código (ej. MA01).");
  await p.locator('span:text-is("Nombre de la vendedora") + input').fill("María Alvarado"); await p.waitForTimeout(200);
  check("con nombre se sugiere el código y la línea desaparece", (await faltan(p)) === "");
  await p.screenshot({ path: `${out}/faltan-vendedora.png` });

  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
