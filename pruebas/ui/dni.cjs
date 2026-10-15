// Prueba de la consulta DNI/RUC en el cobro (SQL 24). MODO=activa|sin-token|sin-sql  Uso: node pruebas/ui/dni.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4366);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "caja@staff.flyboutique.pe", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const user = { id: "u-caja", email: "caja@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { settings0: 1, products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 100, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 5, sku: "B-M" }] }], collections: [], banners: [], settings: { company: { legalName: "Fly Boutique S.A.C.", ruc: "20123456789", address: "Av. Larco 126, Trujillo", phone: "51978687704", email: "flyboutiqueperu@gmail.com" } }, promoCodes: [] };
let cash = null; const calls = []; const lookups = []; const MODO = process.env.MODO || "activa";
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
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
    if (u.includes("/rpc/lookup_document")) {
      const bd = rt.request().postDataJSON(); lookups.push(bd.p_number);
      if (MODO === "sin-sql") return rt.fulfill({ status: 404, json: { code: "PGRST202", message: "Could not find the function" } });
      if (MODO === "sin-token") return rt.fulfill({ json: { ok: false, reason: "NO_CONFIGURADO" } });
      if (bd.p_number === "33334444") return rt.fulfill({ json: { ok: false, reason: "SIN_SALDO" } });
      const db = { "45678912": { ok: true, name: "Lucia Torres Vega", source: "proveedor" }, "20100047218": { ok: true, name: "BANCO DE CREDITO DEL PERU", address: "Calle Centenario 156, La Molina, Lima, Lima", estado: "ACTIVO", condicion: "HABIDO", source: "proveedor" }, "20601234565": { ok: true, name: "EMPRESA DE BAJA SAC", estado: "BAJA DE OFICIO", condicion: "NO HABIDO", source: "memoria" } };
      return rt.fulfill({ json: db[bd.p_number] || { ok: false, reason: "NO_ENCONTRADO" } });
    }
    if (u.includes("/rpc/open_cash")) { const body = rt.request().postDataJSON(); cash = { id: "s1", store_id: body.p_store, status: "abierta", opened_by_name: "Carla Cajera", opened_at: new Date().toISOString(), opening_amount: body.p_amount, byMethod: { Efectivo: 140, Yape: 60 }, entradas: 0, salidas: 20, expectedCash: Number(body.p_amount) + 120, salesCount: 2, movements: [{ id: "m1", type: "salida", amount: 20, reason: "Compra de bolsas", created_by_name: "Carla Cajera", created_at: new Date().toISOString() }] }; return rt.fulfill({ json: cash }); }
    if (u.includes("/rpc/pos_sale")) { const b = rt.request().postDataJSON().p_sale; return rt.fulfill({ json: { ...b, id: "sale_1", serie: "B001", numero: 125, subtotal: 100, discount: 0, total: 100, status: "emitido", source: "pos", cashierName: "Carla Cajera", earnedPoints: 0, createdAt: Date.now() } }); }
    if (u.includes("/rest/v1/sellers")) return rt.fulfill({ json: [{ code: "MA01", name: "María Alvarado" }] });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4366/#staff");
  await p.fill('input[placeholder="Usuario"]', "caja"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
  await p.click("text=Entrar");
  await p.waitForSelector("text=La caja de", { timeout: 15000 });
  await p.screenshot({ path: `${out}/caja-cerrada.png` });
  console.log("1) Caja cerrada visible para el cajero");
  const quien = p.locator("button", { hasText: "María" }).first(); if (await quien.count()) await quien.click();
  await p.fill('input[placeholder="0.00"]', "100"); await p.click("text=Abrir caja");
  await p.waitForSelector("text=Caja abierta"); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/caja-abierta.png`, fullPage: true });
  console.log("2) Caja abierta con resumen:", (await p.innerText("body")).match(/Efectivo que debe haber en la caja\s*S\/ ?[\d.]+/)?.[0]);
  await p.click("text=Cerrar caja"); await p.fill('input[inputmode="decimal"]', "215"); await p.waitForTimeout(300);
  console.log("3) Arqueo muestra:", (await p.innerText("body")).match(/Esperado S\/ [\d.]+ · [^\n]+/)?.[0]);
  await p.screenshot({ path: `${out}/caja-arqueo.png` }); await p.click("text=Cancelar"); await p.screenshot({ path: `${out}/caja-botones.png` });
  await p.click("text=Vender"); await p.waitForSelector("text=Blusa Seda"); await p.waitForTimeout(400);
  console.log("4) Pantalla de venta abre con caja abierta"); await p.screenshot({ path: `${out}/pos-main.png` });
  await p.fill('input[placeholder="Lector de códigos o buscar producto"]', "B-M"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  const addBtn = await p.$("text=Agregar"); if (addBtn) await addBtn.click(); await p.waitForTimeout(300);
  const tap = await p.evaluate(() => { const b = document.querySelector('button[aria-label="Más"].tap-round'); if (!b) return null; const r = b.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); });
  console.log("4a) Botón + de cantidad (para el dedo):", tap, "| letra de los campos:", await p.evaluate(() => getComputedStyle(document.querySelector("input")).fontSize));
  await p.screenshot({ path: `${out}/pos-con-prenda.png` });
  const cobrar = await p.$("text=/Cobrar/"); if (cobrar) { await cobrar.click(); await p.waitForTimeout(500);
    const t = await p.innerText("body");
    console.log("4b) Cobro pide quién atendió (nombre o código):", t.includes("¿Quién atendió?") && t.includes("Obligatorio para registrar la venta"));
    await p.fill('input[placeholder="Ej. MA01"]', "ma01"); await p.waitForTimeout(200);
    console.log("4c) Código reconocido:", (await p.innerText("body")).includes("✓ María Alvarado"));
    const box = () => p.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((x) => x.textContent).join(" | "));
    const val = (sel) => p.locator(sel).inputValue();
    await p.fill('input[placeholder^="DNI (8 dígitos)"]', "45678912"); await p.waitForTimeout(900);
    console.log(`D1) [${MODO}] DNI 45678912 → nombre:`, JSON.stringify(await val('input[placeholder^="Nombres y apellidos"]')), "| aviso:", JSON.stringify(await box()));
    await p.fill('input[placeholder^="DNI (8 dígitos)"]', "11112222"); await p.waitForTimeout(900);
    console.log(`D2) [${MODO}] DNI que no existe → nombre:`, JSON.stringify(await val('input[placeholder^="Nombres y apellidos"]')), "| aviso:", JSON.stringify(await box()));
    await p.fill('input[placeholder^="DNI (8 dígitos)"]', "33334444"); await p.waitForTimeout(900);
    console.log(`D2b) [${MODO}] plan agotado → aviso:`, JSON.stringify(await box()));
    await p.fill('input[placeholder^="Nombres y apellidos"]', "Nombre escrito a mano");
    await p.fill('input[placeholder^="DNI (8 dígitos)"]', "45678912"); await p.waitForTimeout(900);
    console.log(`D3) [${MODO}] Nombre escrito a mano se respeta:`, JSON.stringify(await val('input[placeholder^="Nombres y apellidos"]')));
    await p.locator("button", { hasText: /^Factura$/ }).first().click(); await p.waitForTimeout(300);
    await p.fill('input[placeholder^="RUC (11 dígitos)"]', "20100047219"); await p.waitForTimeout(500);
    console.log(`R1) [${MODO}] RUC con dígito malo:`, JSON.stringify(await box()));
    await p.fill('input[placeholder^="RUC (11 dígitos)"]', "20100047218"); await p.waitForTimeout(900);
    console.log(`R2) [${MODO}] RUC BCP → razón social:`, JSON.stringify(await val('input[placeholder^="Razón social"]')), "| dirección:", JSON.stringify(await val('input[placeholder^="Dirección fiscal"]')), "| aviso:", JSON.stringify(await box()));
    await p.fill('input[placeholder^="RUC (11 dígitos)"]', "20601234565"); await p.waitForTimeout(900);
    console.log(`R3) [${MODO}] RUC de baja → aviso:`, JSON.stringify(await box()));
    await p.screenshot({ path: `${out}/dni-ruc.png` });
    console.log(`L) [${MODO}] consultas enviadas al servidor:`, JSON.stringify(lookups));
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
