// Prueba de la caja: ventas por forma de pago visibles, contador de billetes, cuadre de tarjeta/Yape al cerrar y caja olvidada de ayer.
// Uso: node pruebas/ui/caja-cierre.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4410);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "caja@staff.flyboutique.pe", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const user = { id: "u-caja", email: "caja@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 100, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 5, sku: "B-M" }] }], collections: [], banners: [], settings: {}, promoCodes: [] };
const mkCash = (openedAt) => ({ id: "s1", store_id: "principal", status: "abierta", opened_by_name: "Carla Cajera", opened_at: openedAt, opening_amount: 100,
  byMethod: { Efectivo: 100, Tarjeta: 60, Yape: 45 }, bySeller: {}, cashSales: 100, entradas: 0, salidas: 0, salesCount: 3, expectedCash: 200, movements: [] });
const sales = [
  { id: "a", data: { id: "a", serie: "B001", numero: 1, tipo: "nota", total: 100, status: "emitido", cashSessionId: "s1", createdAt: Date.now() } },
  { id: "b", data: { id: "b", serie: "B001", numero: 2, tipo: "boleta", total: 60, status: "emitido", cashSessionId: "s1", createdAt: Date.now() } },
  { id: "c", data: { id: "c", serie: "F001", numero: 1, tipo: "factura", total: 45, status: "emitido", cashSessionId: "s1", createdAt: Date.now() } },
];
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const run = async (openedAt) => {
    let cash = mkCash(openedAt); let closed = null;
    const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    const p = await ctx.newPage(); p.setDefaultTimeout(6000);
    p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
    p.on("dialog", (d) => d.accept());
    await p.route("http://fake.supabase.test/**", async (rt) => {
      const u = rt.request().url();
      if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
      if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
      if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
      if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
      if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u-caja", username: "caja", name: "Carla Cajera", role: "cajero", active: true } });
      if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: cash });
      if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: sales });
      if (u.includes("/rpc/close_cash")) { const bd = rt.request().postDataJSON(); closed = bd; const rep = { ...cash, status: "cerrada", counted_cash: bd.p_counted, difference: bd.p_counted - cash.expectedCash, notes: bd.p_notes, closed_at: new Date().toISOString() }; cash = null; return rt.fulfill({ json: rep }); }
      return rt.fulfill({ json: [] });
    });
    await p.goto("http://localhost:4410/#staff");
    await p.fill('input[placeholder="Usuario"]', "caja"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
    await p.click("text=Entrar"); await p.waitForTimeout(2500);
    await p.goto("http://localhost:4410/#staff/caja"); await p.waitForTimeout(1500);
    return { p, ctx, getClosed: () => closed };
  };
  // 1) Caja de hoy
  let { p, ctx, getClosed } = await run(new Date().toISOString());
  const totals = await p.locator(".pay-totals").innerText();
  check("Caja: se ven las ventas por forma de pago (Efectivo, Tarjeta S/ 60, Yape S/ 45)", /Tarjeta\s*S\/ ?60\.00/.test(totals) && /Yape\s*S\/ ?45\.00/.test(totals) && /Efectivo\s*S\/ ?100\.00/.test(totals));
  check("Caja: cuenta notas de venta, boletas y facturas", (await p.innerText("body")).includes("1 notas de venta · 1 boletas · 1 facturas"));
  await p.click("text=Cerrar caja"); await p.waitForTimeout(400);
  await p.click("text=Contar billetes y monedas"); await p.waitForTimeout(200);
  await p.fill('input[aria-label="Cantidad de S/ 100"]', "1"); await p.fill('input[aria-label="Cantidad de S/ 50"]', "1"); await p.fill('input[aria-label="Cantidad de S/ 20"]', "2"); await p.fill('input[aria-label="Cantidad de S/ 10"]', "1");
  await p.waitForTimeout(200);
  check("Contador de billetes: 100 + 50 + 2×20 + 10 = S/ 200 → «Cuadra exacto ✓»", (await p.innerText("body")).includes("Cuadra exacto"));
  await p.fill('input[aria-label="Tarjeta según POS"]', "50"); await p.waitForTimeout(200);
  let body = await p.innerText(".cuadre-otros");
  check("Cuadre de tarjeta: POS S/ 50 vs sistema S/ 60 → «Falta S/ 10.00»", body.includes("Falta S/ 10.00"));
  check("Con diferencia en tarjeta pide el motivo", (await p.innerText("body")).includes("escribe el motivo de la diferencia"));
  await p.locator(".cuadre-otros button:has-text('Coincide')").nth(1).click(); await p.waitForTimeout(150);
  await p.fill('input[placeholder="Motivo de la diferencia (obligatorio)"]', "Voucher de 10 anulado en el POS");
  await p.screenshot({ path: `${out}/caja-cierre.png`, fullPage: true });
  await p.locator("button", { hasText: /^Cerrar caja$/ }).last().click(); await p.waitForTimeout(800);
  const c = getClosed() || {};
  check("Al cerrar se guarda el cuadre en el informe (tarjeta, Yape ✓ y comprobantes)", c.p_counted === 200 && /Tarjeta sistema S\/ ?60\.00 \/ según POS S\/ ?50\.00/.test(c.p_notes || "") && /Yape sistema S\/ ?45\.00 ✓/.test(c.p_notes || "") && (c.p_notes || "").includes("1 notas, 1 boletas, 1 facturas") && (c.p_notes || "").startsWith("Voucher de 10 anulado"));
  await ctx.close();
  // 2) Caja olvidada de ayer
  ({ p, ctx } = await run(new Date(Date.now() - 30 * 3600e3).toISOString()));
  check("Caja de ayer: aviso «sigue abierta desde…» y botón para cerrarla", (await p.locator(".caja-vieja").innerText()).includes("sigue abierta desde") && (await p.locator(".caja-vieja button").count()) === 1);
  check("Caja de ayer: «Vender» queda apagado", await p.locator(".big-action", { hasText: "Vender" }).isDisabled());
  await p.goto("http://localhost:4410/#staff/pos"); await p.waitForTimeout(1500);
  check("Pantalla de venta: no deja vender hasta cerrar la caja de ayer", (await p.locator(".caja-de-ayer").innerText()).includes("cerrar la caja de ayer"));
  await ctx.close();
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
