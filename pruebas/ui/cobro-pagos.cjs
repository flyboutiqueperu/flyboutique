// Prueba del cobro: RUC solo con Factura (10… o 20…) y pago combinado con el teclado (Efectivo + Tarjeta con Enter).
// Uso: node pruebas/ui/cobro-pagos.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4409);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "caja@staff.flyboutique.pe", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const user = { id: "u-caja", email: "caja@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { settings0: 1, products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 100, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 5, sku: "B-M" }] }], collections: [], banners: [], settings: { company: { legalName: "Fly Boutique S.A.C.", ruc: "20123456789", address: "Av. Larco 126, Trujillo", phone: "51978687704", email: "flyboutiqueperu@gmail.com" } }, promoCodes: [] };
let cash = null; const calls = []; let lastSale = null; const MODO = process.env.MODO || "activa"; let emits = 0;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const VP = { pc: { viewport: { width: 1280, height: 860 } }, tablet: { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true }, movil: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }[process.env.EQUIPO || "pc"];
  const ctx = await b.newContext({ locale: "es-PE", ...VP });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url(); const name = u.split("/").pop().split("?")[0]; calls.push(name);
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u-caja", username: "caja", name: "Carla Cajera", role: "cajero", active: true } });
    if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: cash });
    if (u.includes("/rpc/einvoice_status")) return MODO === "sin-sql" ? rt.fulfill({ status: 404, json: { code: "PGRST202", message: "not found" } }) : rt.fulfill({ json: { configured: MODO !== "apagada", auto: true, serieBoleta: "B001", serieFactura: "F001" } });
    if (u.includes("/rest/v1/einvoices")) return MODO === "sin-sql" ? rt.fulfill({ status: 404, json: { code: "42P01" } }) : rt.fulfill({ status: 406, json: { code: "PGRST116", message: "0 rows" } });
    if (u.includes("/rpc/emit_einvoice")) {
      emits++;
      const ok = { sale_id: "sale_1", tipo: 2, serie: "B001", numero: 1, status: "enviado", qr: "20600000001|03|B001|1|52.20|342.20|2026-10-15|1|45678912|hash1", hash: "hash1", link: "https://nf.test/B001-1", pdf_url: "https://nf.test/B001-1.pdf", ok: true };
      if (MODO === "falla" && emits === 1) return rt.fulfill({ json: { ...ok, status: "error", last_error: "SIN_CONEXION: timeout", ok: false } });
      return rt.fulfill({ json: ok });
    }
    if (u.includes("/rpc/refresh_einvoice")) return rt.fulfill({ json: { sale_id: "sale_1", tipo: 2, serie: "B001", numero: 1, status: "aceptado", qr: "x", hash: "hash1", link: "https://nf.test/B001-1" } });
    if (u.includes("/rpc/open_cash")) { const body = rt.request().postDataJSON(); cash = { id: "s1", store_id: body.p_store, status: "abierta", opened_by_name: "Carla Cajera", opened_at: new Date().toISOString(), opening_amount: body.p_amount, byMethod: { Efectivo: 140, Yape: 60 }, entradas: 0, salidas: 20, expectedCash: Number(body.p_amount) + 120, salesCount: 2, movements: [{ id: "m1", type: "salida", amount: 20, reason: "Compra de bolsas", created_by_name: "Carla Cajera", created_at: new Date().toISOString() }] }; return rt.fulfill({ json: cash }); }
    if (u.includes("/rpc/pos_sale")) { const b = rt.request().postDataJSON().p_sale; lastSale = b; return rt.fulfill({ json: { ...b, id: "sale_1", serie: "B001", numero: 125, subtotal: 100, discount: 0, total: 100, status: "emitido", source: "pos", cashierName: "Carla Cajera", earnedPoints: 0, createdAt: Date.now() } }); }
    if (u.includes("/rest/v1/sellers")) return rt.fulfill({ json: [{ code: "MA01", name: "María Alvarado" }] });
    return rt.fulfill({ json: [] });
  });
  let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
  await p.goto("http://localhost:4409/#staff");
  await p.fill('input[placeholder="Usuario"]', "caja"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
  await p.click("text=Entrar");
  await p.waitForSelector("text=La caja de", { timeout: 15000 });
  const quien = p.locator("button", { hasText: "María" }).first(); if (await quien.count()) await quien.click();
  await p.fill('input[placeholder="0.00"]', "100"); await p.click("text=Abrir caja");
  await p.waitForSelector("text=Caja abierta"); await p.waitForTimeout(400);
  await p.click("text=Vender"); await p.waitForSelector("text=Blusa Seda"); await p.waitForTimeout(400);
  await p.fill('input[placeholder="Lector de códigos o buscar producto"]', "B-M"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  const addBtn = await p.$("text=Agregar"); if (addBtn) await addBtn.click(); await p.waitForTimeout(300);
  await p.click("text=/Cobrar/"); await p.waitForTimeout(800);
  // RUC
  for (const tipo of ["Nota de venta", "Boleta"]) {
    await p.click(`.doc-tipo button:has-text('${tipo}')`); await p.waitForTimeout(150);
    const docChips = await p.locator("button", { hasText: /^(DNI|Carné ext\.|Pasaporte|RUC)$/ }).allInnerTexts();
    check(`${tipo}: no aparece RUC (solo DNI, Carné ext., Pasaporte)`, !docChips.map((x) => x.trim()).includes("RUC") && docChips.map((x) => x.trim()).includes("DNI"));
  }
  await p.click(".doc-tipo button:has-text('Factura')"); await p.waitForTimeout(200);
  const rucInput = p.locator('input[placeholder^="RUC"]');
  check("Factura: el campo pide RUC", (await rucInput.count()) === 1);
  await rucInput.fill("15456789126"); await p.waitForTimeout(400);
  let body = await p.innerText("body");
  check("Factura con RUC 15… (válido pero no 10/20): avisa y no deja registrar", body.includes("empieza con 10 (persona con negocio) o 20 (empresa)") && body.includes("RUC que empiece con 10 o 20"));
  await rucInput.fill("20600000005"); await p.waitForTimeout(400);
  body = await p.innerText("body");
  check("Factura con RUC 20… válido: ya no pide RUC", !body.includes("RUC que empiece con 10 o 20") && !body.includes("RUC válido de 11 dígitos"));
  await p.click(".doc-tipo button:has-text('Boleta')"); await p.waitForTimeout(200);
  check("Al volver a Boleta se limpia el RUC y pide DNI", (await p.locator('input[placeholder^="DNI"]').inputValue()) === "");
  await p.fill('input[placeholder^="DNI (8 dígitos)"]', "45678912"); await p.fill('input[placeholder^="Nombres y apellidos"]', "Lucía Torres Vega");
  await p.fill('input[placeholder="Ej. MA01"]', "ma01"); await p.waitForTimeout(200);
  // Pago combinado con teclado: Efectivo 40 + Enter → avisa que faltan 60 → Tarjeta se pone sola con 60
  await p.click("button:has-text('Efectivo')"); await p.waitForTimeout(250);
  check("Al elegir Efectivo, su monto queda marcado para escribir encima", await p.evaluate(() => { const el = document.activeElement; return el && el.getAttribute("aria-label") === "Monto con Efectivo" && el.selectionStart === 0 && el.selectionEnd === el.value.length; }));
  await p.keyboard.type("40"); await p.keyboard.press("Enter"); await p.waitForTimeout(250);
  check("Enter con pago incompleto: «Faltan S/ 60.00: toca el otro medio»", (await p.locator(".pay-nudge").innerText()).includes("60.00") && (await p.locator(".pay-pick").count()) > 0);
  await p.click("button:has-text('Tarjeta')"); await p.waitForTimeout(250);
  check("Tarjeta se agrega sola con lo que falta (S/ 60) y queda lista para escribir", (await p.locator('input[aria-label="Monto con Tarjeta"]').inputValue()) === "60.00" && await p.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Monto con Tarjeta"));
  await p.keyboard.press("Enter"); await p.waitForTimeout(250);
  check("Enter con pago completo y efectivo: pasa a «Efectivo recibido»", await p.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Efectivo recibido"));
  await p.keyboard.type("50"); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  check("Enter en efectivo recibido: el foco va a «Registrar venta» (vuelto S/ 10)", await p.evaluate(() => /Registrar venta/i.test(document.activeElement?.innerText || "")) && (await p.innerText("body")).includes("Vuelto"));
  await p.screenshot({ path: `${out}/cobro-pagos.png` });
  await p.keyboard.press("Enter"); await p.waitForSelector(".receipt-doc", { timeout: 8000 }); await p.waitForTimeout(500);
  const pays = (lastSale && lastSale.payments) || [];
  check("Se registra con Efectivo 40 + Tarjeta 60", pays.length === 2 && pays.some((x) => x.method === "Efectivo" && Number(x.amount) === 40) && pays.some((x) => x.method === "Tarjeta" && Number(x.amount) === 60));
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
