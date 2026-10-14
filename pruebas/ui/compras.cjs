// Prueba de la pantalla «Compras» (SQL 23) con Supabase simulado. Uso: node pruebas/ui/compras.cjs <carpeta-capturas> [rol]
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4341);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "administrador";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["S", "M"]), mk("p2", "Pantalón Sastre", 189, ["M"])], collections: [], banners: [], settings: {}, promoCodes: [] };
let suppliers = [], purchases = []; const calls = {};
const log = (k, v) => { (calls[k] = calls[k] || []).push(v); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4341/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.evaluate(() => { location.hash = "#staff/purchases"; }); await p.goto("http://localhost:4341/#staff/purchases"); await p.waitForTimeout(2500);
  const body = () => p.innerText("body");
  const isOpen = (await body()).includes("Registrar compra");
  console.log(`1) [${role}] abre Compras:`, isOpen);
  if (!isOpen) { await b.close(); srv.close(); return; }
  await p.screenshot({ path: `${out}/compras-lista.png` });
  await p.click("text=Registrar compra"); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Nuevo" }).click(); await p.waitForTimeout(300);
  await p.fill('input[placeholder="Ej. Textiles Gamarra SAC"]', "Textiles Gamarra SAC");
  await p.locator("text=RUC o DNI (opcional)").locator("..").locator("input").fill("20123456789");
  await p.click("text=Guardar proveedor"); await p.waitForTimeout(800);
  console.log("2) Proveedor creado y elegido:", JSON.stringify(calls.sup?.[0]?.p_name), "| seleccionado:", await p.locator("select").first().inputValue());
  await p.fill('input[placeholder="Ej. F001-2345"]', "F001-2345");
  await p.selectOption("select >> nth=1", "almacen");
  await p.fill('input[placeholder^="Escanea"]', "P1-M"); await p.press('input[placeholder^="Escanea"]', "Enter"); await p.waitForTimeout(200);
  await p.fill('input[placeholder^="Escanea"]', "pantal"); await p.waitForTimeout(300);
  await p.click("button:has-text('Pantalón Sastre · M')"); await p.waitForTimeout(200);
  const costs = p.locator('input[inputmode="decimal"]');
  console.log("3) Costo propuesto de la blusa (costo actual 50):", await costs.nth(0).inputValue(), "| pantalón vacío (falta):", await costs.nth(1).inputValue() === "");
  console.log("3b) Botón bloqueado sin costo:", await p.locator("button:has-text('Registrar compra (')").isDisabled());
  await p.locator('input[inputmode="numeric"]').nth(0).fill("5"); await costs.nth(1).fill("80");
  await p.screenshot({ path: `${out}/compras-nueva.png`, fullPage: true });
  await p.click("button:has-text('Registrar compra (')"); await p.waitForTimeout(800);
  console.log("4) Primer intento falla y no sale de la pantalla:", await p.locator("button:has-text('Registrar compra (')").count() === 1);
  await p.click("button:has-text('Registrar compra (')"); await p.waitForTimeout(1200);
  const [r1, r2] = calls.reg;
  console.log("5) Reintento usa el mismo código (no duplica):", r1.p_request_id === r2.p_request_id, "| datos:", JSON.stringify({ sede: r2.p_location, doc: r2.p_doc_ref, items: r2.p_items, costo: r2.p_update_cost }));
  console.log("6) Muestra la compra:", /Compra C001-000001/.test(await body()), "| total:", (await body()).match(/6 prendas\s*S\/ [\d.,]+/)?.[0]?.replace(/\s+/g, " "));
  await p.screenshot({ path: `${out}/compras-detalle.png`, fullPage: true });
  await p.click("text=Anular compra"); await p.waitForTimeout(800);
  console.log("7) Anulada con motivo:", JSON.stringify(calls.void?.[0]), "|", (await body()).includes("Anulada por Ana Admin"));
  await p.click("text=Volver a Compras"); await p.waitForTimeout(300);
  await p.click("text=/Proveedores \\(/"); await p.waitForTimeout(300);
  console.log("8) Pestaña proveedores:", (await body()).includes("RUC/DNI 20123456789"));
  await b.close(); srv.close();
})().catch(async (e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
