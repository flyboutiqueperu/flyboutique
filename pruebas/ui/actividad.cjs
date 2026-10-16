// Prueba de «Registro de actividad» (filtros, búsqueda, permisos). Uso: node pruebas/ui/actividad.cjs <carpeta> [rol]
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4382);
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
    if (u.includes("/rest/v1/audit_log")) { log("audit", u); const now = Date.now(); return rt.fulfill({ json: [
      { id: 5, at: new Date(now - 60000).toISOString(), user_name: "Carla Cajera", action: "caja_cerrada", details: { diferencia: -5, motivo: "Faltó sencillo" } },
      { id: 4, at: new Date(now - 120000).toISOString(), user_name: "Ana Admin", action: "venta_anulada", details: { venta: "B001-000025", motivo: "Error de talla" } },
      { id: 3, at: new Date(now - 180000).toISOString(), user_name: "Ana Admin", action: "comprobante_aceptado", details: { comprobante: "B001-12", venta: "s1" } },
      { id: 2, at: new Date(now - 86400000 * 2).toISOString(), user_name: "Luis Almacén", action: "guia_emitida", details: { guia: "G-0003" } },
      { id: 1, at: new Date(now - 86400000 * 2 - 5000).toISOString(), user_name: null, action: "algo_nuevo_raro", details: { total: 99 } },
    ] }); }
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
  let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
  await p.goto("http://localhost:4382/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  const body = () => p.innerText("body");
  if (role === "cajero") {
    await p.goto("http://localhost:4382/#staff/activity"); await p.waitForTimeout(2000);
    check("cajero no puede abrir el registro", !(await body()).includes("Registro de actividad") && !(calls.audit || []).length);
    await b.close(); srv.close(); console.log(ok ? "TODO OK" : "HAY FALLAS"); process.exit(ok ? 0 : 1);
  }
  check("panel muestra «Ver todo» en actividad", (await body()).includes("Ver todo"));
  await p.getByRole("button", { name: "Ver todo" }).click(); await p.waitForTimeout(1500);
  let t = await body();
  check("abre «Registro de actividad»", t.includes("Registro de actividad"));
  check("pide últimos 7 días (gte)", (calls.audit || []).some((u) => u.includes("at=gte")));
  check("etiquetas en español", t.includes("Caja cerrada") && t.includes("Venta anulada") && t.includes("Comprobante aceptado por SUNAT") && t.includes("Guía emitida") && t.includes("Algo nuevo raro"));
  check("detalle legible", t.includes("Motivo: Error de talla") && t.includes("Total: S/"));
  check("5 registros", t.includes("5 registros"));
  await p.selectOption('select[aria-label="Persona"]', "Ana Admin"); await p.waitForTimeout(300);
  check("filtro persona → 2", (await body()).includes("2 registros"));
  await p.selectOption('select[aria-label="Persona"]', ""); await p.selectOption('select[aria-label="Tipo"]', "caja"); await p.waitForTimeout(300);
  check("filtro tipo caja → 1", (await body()).includes("1 registro") && (await body()).includes("Caja cerrada"));
  await p.selectOption('select[aria-label="Tipo"]', ""); await p.fill('input[placeholder^="Buscar"]', "b001-000025"); await p.waitForTimeout(300);
  check("búsqueda por número → 1", (await body()).includes("1 registro") && (await body()).includes("Venta anulada"));
  await p.fill('input[placeholder^="Buscar"]', "");
  const n0 = (calls.audit || []).length; await p.click("text=Todo"); await p.waitForTimeout(800);
  check("«Todo» vuelve a pedir sin fecha", (calls.audit || []).length > n0 && !calls.audit[calls.audit.length - 1].includes("at=gte"));
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("text=Excel (CSV)")]);
  check("descarga CSV " + dl.suggestedFilename(), /actividad-fly-.*\.csv/.test(dl.suggestedFilename()));
  await p.screenshot({ path: `${out}/actividad.png`, fullPage: true });
  await p.goto("http://localhost:4382/#staff/more"); await p.waitForTimeout(1500);
  await p.fill('input[aria-label="Buscar en Más"]', "auditoria"); await p.waitForTimeout(300);
  check("«Más» encuentra «Registro de actividad» por sinónimo", (await body()).includes("Registro de actividad"));
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
