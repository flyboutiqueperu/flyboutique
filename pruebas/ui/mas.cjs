// Prueba de la pantalla «Más» (grupos, buscador, recientes, avisos). Uso: node pruebas/ui/mas.cjs <carpeta> [rol]
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4374);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "superadmin";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["S", "M"]), mk("p2", "Pantalón Sastre", 189, ["M"])], collections: [], banners: [], settings: {}, promoCodes: [] };
let suppliers = [], purchases = []; const calls = {}; const ecfg = { configured: false, auto: true, ruta: null, serieBoleta: "B001", serieFactura: "F001", nextBoleta: 1, nextFactura: 1, counts: {} }; let erows = [];
const cfg = { configured: false, dniUrl: null, rucUrl: null, cached: 7, monthCalls: 12, monthFound: 10, lastProblem: { result: "sin-saldo", at: new Date().toISOString() } };
const log = (k, v) => { (calls[k] = calls[k] || []).push(v); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
  p.on("dialog", (d) => d.type() === "prompt" ? d.accept("Llegó otra cosa") : (console.log("  [alerta]", d.message()), d.accept()));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: [1, 2].map((k) => ({ id: "s" + k, data: { id: "s" + k, serie: "B001", numero: 100 + k, tipo: "boleta", total: 50 * k, customerName: "Cliente " + k, status: "emitido", createdAt: Date.now() - k * 3600000, items: [], channel: "online", source: "web", paymentStatus: k === 1 ? "pendiente" : "confirmado" } })) });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role, active: true } });
    if (u.includes("/rest/v1/suppliers")) return rt.fulfill({ json: suppliers });
    if (u.includes("/rest/v1/purchases")) return rt.fulfill({ json: purchases });
    if (u.includes("/rest/v1/product_costs")) return rt.fulfill({ json: [{ product_id: "p1", cost: 50 }] });
    if (u.includes("/rpc/upsert_supplier")) { const bd = rt.request().postDataJSON(); log("sup", bd); const s = { id: 1, name: bd.p_name, ruc: bd.p_ruc, phone: bd.p_phone, contact: bd.p_contact, note: bd.p_note, active: true }; suppliers = [s]; return rt.fulfill({ json: s }); }
    if (u.includes("/rpc/register_purchase")) {
      const bd = rt.request().postDataJSON(); log("reg", bd);
      if ((calls.reg || []).length === 1) return rt.fulfill({ status: 500, body: "fallo de red simulado" }); // el primer intento falla
      const items = bd.p_items.map((i) => ({ ...i, name: i.variantId.startsWith("p1") ? "Blusa Seda Marfil" : "Pantalón Sastre", size: i.variantId.slice(2), color: "Negro" }));
      const pu = { id: 1, code: "C001-000001", request_id: bd.p_request_id, supplier_id: 1, supplier_name: "Textiles Gamarra SAC", doc_ref: bd.p_doc_ref, location: bd.p_location, items, total: items.reduce((a, i) => a + i.qty * i.unitCost, 0), update_cost: bd.p_update_cost, status: "recibida", created_at: new Date().toISOString(), created_by: "Ana Admin" };
      purchases = [pu]; return rt.fulfill({ json: pu });
    }
    if (u.includes("/rpc/void_purchase")) { const bd = rt.request().postDataJSON(); log("void", bd); purchases = purchases.map((x) => ({ ...x, status: "anulada", voided_by: "Ana Admin", voided_at: new Date().toISOString(), void_reason: bd.p_reason })); return rt.fulfill({ json: purchases[0] }); }
    if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
    if (u.includes("/rpc/einvoice_status")) return rt.fulfill({ json: ecfg });
    if (u.includes("/rpc/set_einvoice_config")) { const bd = rt.request().postDataJSON(); log("ecfg", bd); if (bd.p_ruta && !/^https:/.test(bd.p_ruta)) return rt.fulfill({ status: 400, json: { code: "P0001", message: "RUTA_INVALIDA" } }); if (bd.p_token === "-") ecfg.configured = false; else if (bd.p_token) { ecfg.configured = true; ecfg.ruta = bd.p_ruta; } if (bd.p_auto !== null && bd.p_auto !== undefined) ecfg.auto = bd.p_auto; if (bd.p_next_boleta) ecfg.nextBoleta = bd.p_next_boleta; return rt.fulfill({ json: ecfg }); }
    if (u.includes("/rest/v1/einvoices")) return rt.fulfill({ json: erows });
    if (u.includes("/rpc/emit_einvoice")) { const bd = rt.request().postDataJSON(); log("emit", bd); erows = [{ sale_id: bd.p_sale_id, tipo: 2, serie: "B001", numero: erows.length + 1, status: "enviado", updated_at: new Date().toISOString(), attempts: 1 }, ...erows]; return rt.fulfill({ json: erows[0] }); }
    if (u.includes("/rpc/void_einvoice")) { const bd = rt.request().postDataJSON(); log("void", bd); erows = erows.map((r) => r.sale_id === bd.p_sale_id ? { ...r, status: "anulacion_pendiente", void_reason: bd.p_reason } : r); return rt.fulfill({ json: erows[0] }); }
    if (u.includes("/rpc/doc_lookup_status")) return rt.fulfill({ json: cfg });
    if (u.includes("/rpc/set_doc_lookup_config")) { const bd = rt.request().postDataJSON(); log("cfg", bd); if (bd.p_token === "-") cfg.configured = false; else if (bd.p_token) cfg.configured = true; cfg.dniUrl = bd.p_dni_url; cfg.rucUrl = bd.p_ruc_url; return rt.fulfill({ json: cfg }); }
    if (u.includes("/rpc/lookup_document")) return rt.fulfill({ json: cfg.configured ? { ok: true, name: "Lucia Torres Vega", source: "proveedor" } : { ok: false, reason: "NO_CONFIGURADO" } });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4374/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.evaluate(() => { location.hash = "#staff/more"; }); await p.goto("http://localhost:4374/#staff/more"); await p.waitForTimeout(2500);
  const heads = async () => p.evaluate(() => [...document.querySelectorAll(".more-group-btn > span:nth-child(2) > span:first-child")].map((x) => x.textContent));
  const titles = async () => p.evaluate(() => [...document.querySelectorAll(".more-tile span span:first-child")].map((x) => x.textContent));
  console.log(`1) [${role}] grupos:`, JSON.stringify(await heads()));
  // Grupos desplegables: al entrar están todos cerrados; el aviso de pedidos se ve en el título del grupo cerrado
  console.log(`1b) [${role}] abiertos al entrar:`, await p.locator(".more-group.is-open").count(), "| cerrados muestran resumen:", await p.locator(".more-group:not(.is-open) .more-group-btn").count());
  console.log(`3) [${role}] aviso de pedidos por validar:`, await p.evaluate(() => document.querySelector(".more-badge")?.textContent || "—"));
  await p.screenshot({ path: `${out}/mas-${role}-inicio.png` });
  await p.evaluate(() => document.querySelectorAll(".more-group:not(.is-open) .more-group-btn").forEach((b) => b.click()));
  await p.waitForTimeout(300);
  const t = await titles();
  console.log(`2) [${role}] ${t.length} opciones | Ventas y caja en orden:`, JSON.stringify(t.slice(0, 6)), "| tiene Usuarios:", t.includes("Usuarios y permisos"));
  await p.fill('input[aria-label="Buscar en Más"]', "devol"); await p.waitForTimeout(300);
  console.log(`4) [${role}] buscar «devol»:`, JSON.stringify(await titles()));
  await p.fill('input[aria-label="Buscar en Más"]', "boleta"); await p.waitForTimeout(300);
  console.log(`5) [${role}] buscar «boleta»:`, JSON.stringify(await titles()));
  await p.fill('input[aria-label="Buscar en Más"]', "xyz"); await p.waitForTimeout(300);
  console.log(`6) [${role}] sin resultados:`, /No encontramos/.test(await p.innerText("body")));
  await p.fill('input[aria-label="Buscar en Más"]', ""); 
  await p.click(".more-tile:has-text('Vales de compra')"); await p.waitForTimeout(600);
  await p.evaluate(() => { location.hash = "#staff/more"; }); await p.waitForTimeout(800);
  console.log(`7) [${role}] lo último que usaste:`, JSON.stringify(await p.evaluate(() => [...document.querySelectorAll(".more-chip")].map((x) => x.textContent.trim()))));
  await p.screenshot({ path: `${out}/mas-${role}.png`, fullPage: true });
  await p.setViewportSize({ width: 1280, height: 860 }); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/mas-${role}-pc.png`, fullPage: true });
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
