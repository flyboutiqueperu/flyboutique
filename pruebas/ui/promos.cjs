// Prueba: promoción automática en caja y descuento por prenda (con motivo). Uso: node pruebas/ui/promos.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4399);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "caja@staff.flyboutique.pe", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const user = { id: "u-caja", email: "caja@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { settings0: 1, products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 100, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 5, sku: "B-M" }] }], collections: [], banners: [], settings: { company: { legalName: "Fly Boutique S.A.C.", ruc: "20123456789", address: "Av. Larco 126, Trujillo", phone: "51978687704", email: "flyboutiqueperu@gmail.com" } }, promoCodes: [] };
let cash = null; const calls = []; let saleBody = null;
catalog.products.push({ id: "p2", name: "Labial Rosa", slug: "l", category: "Belleza", price: 39, status: "active", images: [], variants: [{ id: "v2", size: "Única", colorName: "Rosa", colorHex: "#f2a7b8", stock: 9, sku: "LAB-R" }] });
catalog.settings.posPromos = [{ id: "pr1", active: true, name: "Labial por S/ 5", kind: "monto", minAmount: 100, targetProductIds: ["p2"], price: 5 }];
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
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
    if (u.includes("/rpc/open_cash")) { const body = rt.request().postDataJSON(); cash = { id: "s1", store_id: body.p_store, status: "abierta", opened_by_name: "Carla Cajera", opened_at: new Date().toISOString(), opening_amount: body.p_amount, byMethod: { Efectivo: 140, Yape: 60 }, entradas: 0, salidas: 20, expectedCash: Number(body.p_amount) + 120, salesCount: 2, movements: [{ id: "m1", type: "salida", amount: 20, reason: "Compra de bolsas", created_by_name: "Carla Cajera", created_at: new Date().toISOString() }] }; return rt.fulfill({ json: cash }); }
    if (u.includes("/rpc/pos_sale")) { saleBody = rt.request().postDataJSON().p_sale; }
    if (u.includes("/rpc/pos_sale")) { const b = rt.request().postDataJSON().p_sale; return rt.fulfill({ json: { ...b, id: "sale_1", serie: "B001", numero: 125, subtotal: 100, discount: 0, total: 100, status: "emitido", source: "pos", cashierName: "Carla Cajera", earnedPoints: 0, createdAt: Date.now() } }); }
    if (u.includes("/rest/v1/sellers")) return rt.fulfill({ json: [{ code: "MA01", name: "María Alvarado" }] });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4399/#staff");
  await p.fill('input[placeholder="Usuario"]', "caja"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForSelector("text=La caja de", { timeout: 15000 });
  const quien = p.locator("button", { hasText: "María" }).first(); if (await quien.count()) await quien.click();
  await p.fill('input[placeholder="0.00"]', "100"); await p.click("text=Abrir caja"); await p.waitForSelector("text=Caja abierta");
  await p.click("text=Vender"); await p.waitForSelector("text=Blusa Seda"); await p.waitForTimeout(300);
  const scan = async (code) => { await p.fill('input[placeholder="Lector de códigos o buscar producto"]', code); await p.keyboard.press("Enter"); await p.waitForTimeout(300); const a = await p.$("text=Agregar"); if (a) await a.click(); await p.waitForTimeout(300); };
  await scan("LAB-R");
  await p.click("text=/Cobrar/"); await p.waitForTimeout(500);
  let t = await p.innerText("body");
  check("sugerencia: faltan S/ para la promo", t.includes("faltan") && t.includes("Labial por S/ 5"));
  await p.click("text=Volver a la venta"); await p.waitForTimeout(300);
  await scan("B-M");
  await p.click("text=/Cobrar/"); await p.waitForTimeout(500);
  t = await p.innerText("body");
  check("promo aplicada sola: Labial a S/ 5 (−S/ 34)", t.includes("Labial por S/ 5") && t.includes("-S/ 34"));
  // descuento por prenda: Blusa con falla, S/ 10
  await p.locator(".line-disc-btn").first().click(); await p.waitForTimeout(200);
  await p.fill('input[aria-label="Valor del descuento"]', "10"); await p.selectOption('select[aria-label="Motivo"]', "Prenda con falla"); await p.waitForTimeout(200);
  t = await p.innerText("body");
  check("descuento por prenda con motivo", t.includes("Prenda con falla") && t.includes("Descuento por prenda"));
  await p.fill('input[placeholder="Ej. MA01"]', "ma01");
  await p.click("text=DNI"); await p.fill('input[placeholder^="DNI (8 dígitos)"]', "45678912"); await p.fill('input[placeholder^="Nombres y apellidos"]', "Lucía Torres Vega");
  await p.click("button:has-text('Efectivo')"); await p.waitForTimeout(300);
  const falta = (await p.innerText("body")).match(/Falta completar[^\n]*/)?.[0]; if (falta) console.log("  ", falta);
  await p.click("text=/Registrar venta/"); await p.waitForSelector(".receipt-doc", { timeout: 8000 }); await p.waitForTimeout(300);
  const sb = saleBody || {};
  console.log("  venta enviada:", JSON.stringify({ discount: sb.discount, autoPromoDiscount: sb.autoPromoDiscount, total: sb.total, items: (sb.items || []).map((i) => [i.name, i.lineDiscount || 0, i.discountReason || ""]) }));
  check("envía la promo y el descuento por prenda al servidor", sb.autoPromoDiscount === 34 && sb.discount === 44 && (sb.items || []).some((i) => i.lineDiscount === 10 && i.discountReason === "Prenda con falla"));
  const r = await p.innerText(".receipt-doc");
  check("el comprobante muestra la promo y el descuento de la prenda", r.includes("Promoción: Labial por S/ 5") && r.includes("Prenda con falla"));
  await p.screenshot({ path: `${out}/promos-comprobante.png`, fullPage: true });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
