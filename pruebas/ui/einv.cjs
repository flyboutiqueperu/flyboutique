// Prueba de la boleta electrónica tras la venta (SQL 25). MODO=activa|falla|apagada|sin-sql  Uso: node pruebas/ui/einv.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4369);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "caja@staff.flyboutique.pe", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const user = { id: "u-caja", email: "caja@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { settings0: 1, products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 100, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 5, sku: "B-M" }] }], collections: [], banners: [], settings: { company: { legalName: "Fly Boutique S.A.C.", ruc: "20123456789", address: "Av. Larco 126, Trujillo", phone: "51978687704", email: "flyboutiqueperu@gmail.com" } }, promoCodes: [] };
let cash = null; const calls = []; const MODO = process.env.MODO || "activa"; let emits = 0;
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
    if (u.includes("/rpc/pos_sale")) { const b = rt.request().postDataJSON().p_sale; return rt.fulfill({ json: { ...b, id: "sale_1", serie: "B001", numero: 125, subtotal: 100, discount: 0, total: 100, status: "emitido", source: "pos", cashierName: "Carla Cajera", earnedPoints: 0, createdAt: Date.now() } }); }
    if (u.includes("/rest/v1/sellers")) return rt.fulfill({ json: [{ code: "MA01", name: "María Alvarado" }] });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4369/#staff");
  await p.fill('input[placeholder="Usuario"]', "caja"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
  await p.click("text=Entrar");
  await p.waitForSelector("text=La caja de", { timeout: 15000 });
  await p.screenshot({ path: `${out}/caja-cerrada.png` });
  console.log("1) Caja cerrada visible para el cajero");
  const quien = p.locator("button", { hasText: "María" }).first(); if (await quien.count()) await quien.click();
  await p.fill('input[placeholder="0.00"]', "100"); await p.click("text=Abrir caja");
  await p.waitForSelector("text=Caja abierta"); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/caja-abierta.png`, fullPage: true });
  console.log("2) Caja abierta con resumen:", (await p.innerText("body")).match(/Efectivo que debe haber\s*S\/ [\d.]+/)?.[0]);
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
    console.log("4b) Cobro pide código:", t.includes("Código de quien atendió"));
    await p.fill('input[placeholder="Ej. MA01"]', "ma01"); await p.waitForTimeout(200);
    console.log("4c) Código reconocido:", (await p.innerText("body")).includes("✓ María Alvarado"));
    await p.screenshot({ path: `${out}/cobro-codigo.png` });
    await p.click("text=DNI"); await p.fill('input[placeholder^="DNI (8 dígitos)"]', "45678912"); await p.fill('input[placeholder^="Nombres y apellidos"]', "Lucía Torres Vega");
    await p.fill('input[type="email"]', "lucia@correo.com");
    await p.click("button:has-text('Efectivo')"); await p.waitForTimeout(200); await p.click("text=S/ 200"); await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/cobro-nuevo.png` });
    console.log("4d) Vuelto con billete S/ 200:", (await p.innerText("body")).match(/Vuelto:\s*S\/ \d+/)?.[0]);
    await p.click("text=/Registrar venta/"); await p.waitForSelector(".receipt-doc", { timeout: 8000 }); await p.waitForTimeout(400);
    await p.waitForTimeout(1500);
    const doc = await p.innerText(".receipt-doc");
    const bar = await p.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((x) => x.innerText.replace(/\s+/g, " ")).join(" | "));
    console.log(`E1) [${MODO}] envíos a Nubefact: ${emits} | título: ${doc.match(/BOLETA DE VENTA ELECTRÓNICA|NOTA DE VENTA[^\n]*/)?.[0]} | número: ${doc.match(/B001-0000000\d/)?.[0] || "—"} | QR: ${await p.locator('img[alt="Código QR del comprobante"]').count()} | estado: ${JSON.stringify(bar)}`);
    if (MODO === "falla") {
      await p.click("button:has-text('Reintentar')"); await p.waitForTimeout(1500);
      console.log(`E2) [${MODO}] tras reintentar: envíos ${emits} |`, (await p.innerText(".receipt-doc")).match(/BOLETA DE VENTA ELECTRÓNICA/)?.[0], "|", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((x) => x.innerText.replace(/\s+/g, " ")).join(" | "))));
    }
    if (MODO === "activa") {
      await p.click("button:has-text('Actualizar estado')"); await p.waitForTimeout(800);
      console.log(`E3) [${MODO}] actualizar estado:`, JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((x) => x.innerText.replace(/\s+/g, " ")).join(" | "))));
      await p.screenshot({ path: `${out}/boleta-electronica.png`, fullPage: true });
    }
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
