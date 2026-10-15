// Prueba del cierre de caja: avisa qué falta, muestra el error junto al botón (sin internet) y lleva al informe. Uso: node pruebas/ui/cierre.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4385);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "caja@staff.flyboutique.pe", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const user = { id: "u-caja", email: "caja@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { settings0: 1, products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 100, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 5, sku: "B-M" }] }], collections: [], banners: [], settings: { company: { legalName: "Fly Boutique S.A.C.", ruc: "20123456789", address: "Av. Larco 126, Trujillo", phone: "51978687704", email: "flyboutiqueperu@gmail.com" } }, promoCodes: [] };
let cash = null; const calls = []; let closeTries = 0, closeBody = null;
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
    if (u.includes("/rpc/close_cash")) { closeTries++; if (closeTries === 1) return rt.abort("internetdisconnected"); const bd = rt.request().postDataJSON(); closeBody = bd; const rep = { ...cash, status: "cerrada", counted_cash: bd.p_counted, difference: bd.p_counted - cash.expectedCash, notes: bd.p_notes, closed_by_name: "Carla Cajera", closed_at: new Date().toISOString() }; cash = null; return rt.fulfill({ json: rep }); }
    if (u.includes("/rpc/pos_sale")) { const b = rt.request().postDataJSON().p_sale; return rt.fulfill({ json: { ...b, id: "sale_1", serie: "B001", numero: 125, subtotal: 100, discount: 0, total: 100, status: "emitido", source: "pos", cashierName: "Carla Cajera", earnedPoints: 0, createdAt: Date.now() } }); }
    if (u.includes("/rest/v1/sellers")) return rt.fulfill({ json: [{ code: "MA01", name: "María Alvarado" }] });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4385/#staff");
  await p.fill('input[placeholder="Usuario"]', "caja"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
  await p.click("text=Entrar");
  await p.waitForSelector("text=La caja de", { timeout: 15000 });
  const quien = p.locator("button", { hasText: "María" }).first(); if (await quien.count()) await quien.click();
  await p.fill('input[placeholder="0.00"]', "100"); await p.click("text=Abrir caja");
  await p.waitForSelector("text=Caja abierta"); await p.waitForTimeout(400);
  p.on("dialog", (d) => d.accept());
  await p.click("text=Cerrar caja"); await p.waitForTimeout(400);
  const card = p.locator(".cash-missing");
  check("dice qué falta: " + (await card.innerText()), (await card.innerText()).includes("quién cierra la caja") && (await card.innerText()).includes("efectivo contado"));
  await p.locator("text=¿Quién cierra la caja?").locator("..").locator("button", { hasText: "María" }).first().click().catch(async () => { await p.locator("button", { hasText: "María" }).last().click(); });
  await p.fill('input[inputmode="decimal"]', "215"); await p.waitForTimeout(300);
  check("pide el motivo de la diferencia", (await card.innerText()).includes("motivo de la diferencia"));
  await p.fill('input[placeholder^="Motivo de la diferencia"]', "Faltó sencillo"); await p.waitForTimeout(200);
  check("ya no falta nada", await p.locator(".cash-missing").count() === 0);
  await p.locator("button", { hasText: /^Cerrar caja$/ }).last().click(); await p.waitForTimeout(1200);
  const err = p.locator(".cash-form-error");
  check("sin internet: el error sale junto al botón", await err.count() === 1 && await err.isVisible() && (await err.innerText()).length > 10);
  await p.screenshot({ path: `${out}/cierre-error.png` });
  await p.locator("button", { hasText: /^Cerrar caja$/ }).last().click(); await p.waitForTimeout(1500);
  const t = await p.innerText("body");
  check("cerró y muestra el informe", t.includes("Caja cerrada. Este es el informe del turno"));
  check("el informe queda a la vista", await p.locator("text=Caja cerrada. Este es el informe del turno").isVisible() && (await p.locator("text=Caja cerrada. Este es el informe del turno").boundingBox()).y < 844);
  check("envió contado 215, motivo y quién cerró", closeBody && closeBody.p_counted === 215 && closeBody.p_notes === "Faltó sencillo" && !!closeBody.p_seller);
  await p.screenshot({ path: `${out}/cierre-ok.png` });
  check("después se puede abrir otra vez", t.includes("Abrir caja"));
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
