// Prueba de Más → Copia de las fotos y de la copia de datos completa (más de 1000 filas). Uso: node pruebas/ui/fotos.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { if (q.url.startsWith("/media/")) { if (q.url.includes("roto")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": "image/jpeg", "access-control-allow-origin": "*" }); return r.end(Buffer.alloc(40 * 1024, 9)); } let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4368);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "superadmin";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const M = (n) => `http://localhost:4368/media/${n}`;
const catalog = { products: [{ ...mk("p1", "Blusa Seda Marfil", 129, ["S", "M"]), images: [{ url: M("a.jpg") }, { url: M("b.jpg"), colorName: "Negro" }] }, { ...mk("p2", "Pantalón Sastre", 189, ["M"]), images: [{ url: M("roto.jpg") }] }], collections: [{ id: "c1", name: "Oficina", cover: M("c.jpg"), productIds: [] }], banners: [{ id: "b1", active: true, order: 1, title: "Nueva", image: M("ban.jpg") }], settings: {}, promoCodes: [] };
let suppliers = [], purchases = []; const calls = {}; const pages = []; const cfg = { configured: false, dniUrl: null, rucUrl: null, cached: 7, monthCalls: 12, monthFound: 10, lastProblem: { result: "sin-saldo", at: new Date().toISOString() } };
const log = (k, v) => { (calls[k] = calls[k] || []).push(v); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage();
  ctx.setDefaultTimeout && ctx.setDefaultTimeout(8000); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
  p.on("dialog", (d) => d.type() === "prompt" ? d.accept("Llegó otra cosa") : (console.log("  [alerta]", d.message()), d.accept()));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("/rest/v1/sales") || u.includes("/rest/v1/customers")) {
      const url = new URL(u); const off = Number(url.searchParams.get("offset") || 0), lim = Number(url.searchParams.get("limit") || 1000);
      const n = u.includes("/sales") ? 2500 : 1200; pages.push(`${u.includes("/sales") ? "ventas" : "clientas"} ${off}-${off + lim - 1}`);
      const rows = Array.from({ length: Math.max(0, Math.min(lim, n - off)) }, (_, k) => u.includes("/sales") ? { id: "s" + (off + k), data: { id: "s" + (off + k), total: 10 } } : { phone: "9" + (off + k), data: { name: "C" } });
      return rt.fulfill({ json: rows });
    }
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
    if (u.includes("/rpc/doc_lookup_status")) return rt.fulfill({ json: cfg });
    if (u.includes("/rpc/set_doc_lookup_config")) { const bd = rt.request().postDataJSON(); log("cfg", bd); if (bd.p_token === "-") cfg.configured = false; else if (bd.p_token) cfg.configured = true; cfg.dniUrl = bd.p_dni_url; cfg.rucUrl = bd.p_ruc_url; return rt.fulfill({ json: cfg }); }
    if (u.includes("/rpc/lookup_document")) return rt.fulfill({ json: cfg.configured ? { ok: true, name: "Lucia Torres Vega", source: "proveedor" } : { ok: false, reason: "NO_CONFIGURADO" } });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4368/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.evaluate(() => { location.hash = "#staff/fotoscopia"; }); await p.goto("http://localhost:4368/#staff/fotoscopia"); await p.waitForTimeout(2500);
  const body = () => p.innerText("body");
  console.log("1) Abre la pantalla:", (await body()).includes("Copia de las fotos"), "| cuenta:", (await body()).match(/\d+ archivos[^\n]*/)?.[0]);
  const zips = [];
  p.on("download", async (d) => { const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); zips.push(f); });
  await p.click("button:has-text('Descargar copia de las fotos')");
  await p.waitForSelector("text=/Copia lista|no se pudieron/", { timeout: 20000 }); await p.waitForTimeout(1500);
  console.log("2) Resultado en pantalla:", (await body()).match(/✓ Copia lista[^.]*\./)?.[0], "|", (await body()).match(/\d+ no se pudieron descargar/)?.[0]);
  console.log("3) ZIP descargados:", zips.map((z) => path.basename(z)).join(", "));
  await p.screenshot({ path: `${out}/fotos-copia.png`, fullPage: true });
  // Copia de datos completa (2500 ventas)
  await p.evaluate(() => { location.hash = "#staff/more"; }); await p.waitForTimeout(800);
  const dl = p.waitForEvent("download", { timeout: 20000 }); 
  await p.click("button:has-text('Copia de seguridad (datos)')"); // «Más» → Seguridad y copias
  const d = await dl; const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); await p.waitForTimeout(500);
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  console.log("5) Copia de datos: ventas", j.sales.length, "de 2500 | clientas", j.customers.length, "de 1200 | páginas pedidas:", pages.join(", "));
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
