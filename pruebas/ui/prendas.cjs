// Prueba de prendas: nombres en inglés, filtros (agotados, orden) y que la pantalla no se desborde de lado. Uso: node pruebas/ui/prendas.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4397);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "superadmin";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p3", "Falda Plisada Marina", 99, ["S"]), mk("p1", "Blusa Seda Valentina", 129, ["S", "M"]), mk("p2", "VESTIDO-MIDI-CORALINA-S-CORAL-LARGO-CODIGO-SIN-ESPACIOS-PARA-PROBAR", 189, ["M"])], collections: [], banners: [], settings: {}, promoCodes: [] };
// La blusa tiene dos colores y solo foto del negro (para el filtro «Colores sin foto»)
catalog.products[1].variants.push({ id: "p1B", size: "S", colorName: "Beige", colorHex: "#D9C7A7", stock: 2, sku: "P1-SB" });
catalog.products[1].images = [{ id: "im1", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", colorName: "Negro" }];
let suppliers = [], purchases = []; const calls = {}; const ecfg = { configured: false, auto: true, ruta: null, serieBoleta: "B001", serieFactura: "F001", nextBoleta: 1, nextFactura: 1, counts: {} }; let erows = [];
const cfg = { configured: false, dniUrl: null, rucUrl: null, cached: 7, monthCalls: 12, monthFound: 10, lastProblem: { result: "sin-saldo", at: new Date().toISOString() } };
const log = (k, v) => { (calls[k] = calls[k] || []).push(v); };
catalog.products[0].variants.forEach((v) => { v.stock = 0; });
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
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
  // Tienda en inglés: nombre traducido solo
  const p0 = await ctx.newPage(); await p0.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p0.addInitScript(() => localStorage.setItem("flyboutique:idioma:v1", "en"));
  await p0.goto("http://localhost:4397/catalogo"); await p0.waitForTimeout(1800);
  const te = await p0.innerText("body");
  check("EN: «Blusa Seda Valentina» → «Valentina Silk Blouse»", te.includes("Valentina Silk Blouse") && !te.includes("Blusa Seda Valentina"));
  await p0.close();
  await p.goto("http://localhost:4397/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  const noOverflow = () => p.evaluate(() => [...document.querySelectorAll(".app-content")].every((el) => el.scrollWidth <= el.clientWidth + 1));
  await p.goto("http://localhost:4397/#staff/products"); await p.waitForTimeout(1500);
  check("Productos: no se desborda de lado en el celular", await noOverflow());
  const names = () => p.evaluate(() => [...document.querySelectorAll(".app-content")].pop().innerText);
  let t = await names();
  check("Productos: orden guardado (nuevos primero) — Falda antes que Blusa", t.indexOf("Falda Plisada Marina") < t.indexOf("Blusa Seda Valentina"));
  await p.selectOption('select[aria-label="Ordenar"]', "nombre"); await p.waitForTimeout(300); t = await names();
  check("Productos: ordenar por nombre", t.indexOf("Blusa Seda Valentina") < t.indexOf("Falda Plisada Marina"));
  await p.selectOption('select[aria-label="Ordenar"]', "nuevos");
  await p.click("button:has-text('Agotados')"); await p.waitForTimeout(300); t = await names();
  check("Productos: filtro Agotados muestra solo la falda", t.includes("Falda Plisada Marina") && !t.includes("Blusa Seda Valentina") && t.includes("1 de 3 prendas"));
  await p.click("button:has-text('Colores sin foto')"); await p.waitForTimeout(300); t = await names();
  check("Productos: filtro «Colores sin foto» muestra la blusa y dice qué color falta (Beige)", t.includes("Blusa Seda Valentina") && !t.includes("Falda Plisada Marina") && t.includes("1 de 3 prendas") && /Falta foto de:\s*Beige/.test(t));
  await p.fill('input[aria-label="Buscar prendas"]', ""); await p.click("button:has-text('Todos')");
  await p.fill('input[aria-label="Buscar prendas"]', "valentina s"); await p.waitForTimeout(300); t = await names();
  check("Productos: búsqueda en vivo («valentina s»)", t.includes("Blusa Seda Valentina") && !t.includes("Falda Plisada Marina"));
  await p.goto("http://localhost:4397/#staff/stock"); await p.waitForTimeout(1500);
  await p.click(".tile-btn >> nth=2"); await p.waitForTimeout(400); t = await names();
  check("Stock: tocar «prendas agotadas» filtra", t.includes("Falda Plisada Marina") && t.includes("1 de 3 prendas") && t.includes("agotada"));
  check("Stock: no se desborda de lado", await noOverflow());
  await p.screenshot({ path: `${out}/prendas-stock.png` });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
