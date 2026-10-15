// Prueba del tablero de ventas (por hora, formas de pago, promedios) y del menú lateral en PC. Uso: node pruebas/ui/tablero.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4398);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const catalog = { products: [{ id: "p1", name: "Blusa Seda Valentina", slug: "p1", category: "Blusas", price: 100, status: "active", showOnline: true, images: [], variants: [{ id: "v1", size: "S", colorName: "Negro", colorHex: "#111", stock: 5, sku: "V1" }] }], collections: [], banners: [], settings: {}, promoCodes: [] };
// Ventas de hoy: 2 a las 11 h (Efectivo 100 + Yape 100), 1 a las 16 h (Yape 300, factura), 1 anulada
const at = (h) => { const d = new Date(); d.setHours(h, 15, 0, 0); return d.getTime(); };
const sale = (id, h, total, method, extra = {}) => ({ id, data: { id, serie: "B001", numero: id.length, tipo: "boleta", total, subtotal: total, discount: 0, status: "emitido", createdAt: at(h), channel: "tienda", storeId: "principal", staffName: "María", paymentMethod: method, payments: [{ method, amount: total }], items: [{ productId: "p1", variantId: "v1", name: "Blusa Seda Valentina", qty: total / 100, unitPrice: 100 }], ...extra } });
const sales = [sale("s1", 11, 100, "Efectivo"), sale("s2", 11, 100, "Yape"), sale("s3", 16, 300, "Yape", { tipo: "factura", staffName: "Lucía" }), sale("s4", 12, 999, "Efectivo", { status: "anulado" })];
let ok = true; const alerts = []; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
const route = async (rt) => {
  const u = rt.request().url();
  if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
  if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
  if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
  if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
  if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: sales });
  if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role: "superadmin", active: true } });
  return rt.fulfill({ json: [] });
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const equipo of ["pc", "movil"]) {
    const ctx = await b.newContext(equipo === "pc" ? { locale: "es-PE", viewport: { width: 1366, height: 820 } } : { locale: "es-PE", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    const p = await ctx.newPage(); p.setDefaultTimeout(4000);
    p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
    p.on("dialog", (d) => { alerts.push(d.message()); d.accept(); });
    await p.route("http://fake.supabase.test/**", route);
    await p.goto("http://localhost:4398/#staff");
    await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
    await p.waitForTimeout(2500);
    const board = p.locator(".sales-board");
    const t = await board.innerText();
    check(`${equipo}: vendido hoy S/ 500 en 3 ventas (sin la anulada)`, t.includes("S/ 500") && t.includes("3 ventas") && t.includes("1 anuladas"));
    check(`${equipo}: ticket promedio S/ 167`, t.includes("S/ 167"));
    check(`${equipo}: boletas / facturas 2 / 1`, t.includes("2 / 1"));
    check(`${equipo}: hora más alta 16:00 – 17:00 con S/ 300`, t.includes("16:00 – 17:00") && t.includes("S/ 300"));
    check(`${equipo}: Yape 80% y Efectivo 20%`, /Yape[\s\S]*S\/ 400[\s\S]*80%/.test(t) && /Efectivo[\s\S]*S\/ 100[\s\S]*20%/.test(t));
    check(`${equipo}: por vendedora (María y Lucía)`, t.includes("María") && t.includes("Lucía"));
    await board.locator(".board-bar").nth(2).hover(); await p.waitForTimeout(200);
    check(`${equipo}: al pasar por la barra de las 11 h se lee su detalle`, (await board.innerText()).includes("11:00 – 12:00"));
    const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll(".app-content")].every((el) => el.scrollWidth <= el.clientWidth + 1));
    check(`${equipo}: no se desborda de lado`, noOverflow);
    const side = await p.evaluate(() => { const n = document.querySelector(".staff-nav"); const r = n.getBoundingClientRect(); return { w: r.width, h: r.height, more: getComputedStyle(document.querySelector(".side-more")).display }; });
    if (equipo === "pc") {
      check("pc: menú a la izquierda (alto y angosto) con las opciones de «Más»", side.w < 260 && side.h > 600 && side.more !== "none");
      await p.click(".side-link:has-text('Reportes')"); await p.waitForTimeout(800);
      check("pc: el menú lateral abre Reportes", (await p.innerText("body")).includes("Por vendedora"));
      check("pc: Reportes queda marcado en el menú", await p.locator(".side-link.is-active:has-text('Reportes')").count() === 1);
      await p.goto("http://localhost:4398/#staff/dashboard"); await p.waitForTimeout(800);
      await p.click("text=Temporadas (Navidad"); await p.waitForTimeout(300);
      const tc = await p.innerText("body");
      check("pc: Panel → Temporadas muestra la de hoy y sus fechas", tc.includes("Hoy se ve:") && tc.includes("Día de la Madre") && tc.includes("Fiestas Patrias"));
      await p.selectOption('select[aria-label="Temporada"]', "off"); await p.click("text=Guardar temporadas"); await p.waitForTimeout(400);
      check("pc: apagar temporadas guarda y avisa", alerts.some((a) => a.includes("Temporadas apagadas")));
    } else {
      check("movil: menú abajo, sin la lista lateral", side.h < 120 && side.more === "none");
      await p.click(".staff-help-btn"); await p.fill('input[aria-label="Pregunta de ayuda"]', "¿cómo anulo una venta?"); await p.click("text=Preguntar"); await p.waitForTimeout(300);
      const ans = await p.locator(".help-answer").innerText();
      check("movil: el asistente responde «anular venta» con Comprobantes", ans.includes("Comprobantes"));
      await p.fill('input[aria-label="Pregunta de ayuda"]', "quiero subir fotos de una prenda"); await p.click("text=Preguntar"); await p.waitForTimeout(300);
      check("movil: «subir fotos» lleva a Productos", (await p.locator(".help-answer").innerText()).includes("Productos"));
      await p.fill('input[aria-label="Pregunta de ayuda"]', "xyzzy"); await p.click("text=Preguntar"); await p.waitForTimeout(300);
      check("movil: si no sabe, lo dice", (await p.locator(".help-answer").innerText()).includes("No encontré"));
      await p.fill('input[aria-label="Pregunta de ayuda"]', "devolución de una prenda"); await p.click("text=Preguntar"); await p.waitForTimeout(300);
      await p.locator(".help-answer button:has-text('Ir a esa pantalla')").first().click(); await p.waitForTimeout(800);
      check("movil: «Ir a esa pantalla» abre Devolución", (await p.innerText("body")).toLowerCase().includes("devoluci") && p.url().includes("returns"));
      await p.goto("http://localhost:4398/#staff/dashboard"); await p.waitForTimeout(800);
    }
    await p.mouse.move(700, 5); await p.screenshot({ path: `${out}/tablero-${equipo}.png` });
    await ctx.close();
  }
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
