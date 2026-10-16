const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4336);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "administrador";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["XS", "S", "M", "L"]), mk("p2", "Pantalón Sastre", 189, ["S", "M"]), mk("p3", "Vestido Midi", 219, ["M"]), mk("p4", "Top Lino", 79, ["S"])], collections: [], banners: [], settings: { cartHoldMinutes: 20 }, promoCodes: [] };
const costCalls = [];
const EXP = [{ id: 1, spent_on: new Date().toISOString().slice(0, 10), category: "Alquiler", amount: 300, note: "Local", voided: false, created_by: "Ana Admin" }];
const mkSale = (id, items, extra = {}) => ({ id, serie: "B001", numero: 1, status: "emitido", channel: "tienda", createdAt: Date.now() - 3600000, items, subtotal: items.reduce((t, i) => t + i.unitPrice * i.qty, 0), discount: 0, total: items.reduce((t, i) => t + i.unitPrice * i.qty, 0), staffName: "María", payments: [{ method: "Efectivo", amount: 1 }], ...extra });
const SALES = [
  mkSale("s1", [{ productId: "p1", name: "Blusa Seda Marfil", qty: 2, unitPrice: 129 }]),
  mkSale("s2", [{ productId: "p2", name: "Pantalón Sastre", qty: 1, unitPrice: 189 }], { channel: "online", shipping: 12, total: 201 }),
  mkSale("s0", [{ productId: "p1", name: "Blusa Seda Marfil", qty: 1, unitPrice: 129 }], { createdAt: Date.now() - 32 * 86400000, payments: [{ method: "Yape", amount: 129 }] }),
  mkSale("s3", [{ productId: "p1", name: "Blusa Seda Marfil", qty: 1, unitPrice: 129 }], { status: "anulado" }),
];
const hist = [
  { id: 3, created_at: new Date().toISOString(), product_id: "p1", variant_id: "p1M", size: "M", color: "Negro", type: "venta", qty: -1, stock_before: 6, stock_after: 5, unit_price: 129, doc: "B001-000125", customer: "Lucía Torres", seller: "MA01 · María Alvarado", staff_name: "Caja Larco", channel: "tienda" },
  { id: 2, created_at: new Date(Date.now() - 86400000).toISOString(), product_id: "p1", variant_id: "p1M", size: "M", color: "Negro", type: "entrada", qty: 4, stock_before: 2, stock_after: 6, unit_price: 129, staff_name: "Alberto", note: "Reposición proveedor" },
  { id: 1, created_at: new Date(Date.now() - 3 * 86400000).toISOString(), product_id: "p1", variant_id: "p1S", size: "S", color: "Negro", type: "anulación / devolución", qty: 1, stock_before: 3, stock_after: 4, unit_price: 129, doc: "B001-000101", staff_name: "Alberto", note: "Talla equivocada" },
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/factors")) return rt.fulfill({ json: { id: "c1" } });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role, active: true } });
    if (u.includes("stock_movements")) return rt.fulfill({ json: hist });
    if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: SALES.map((d) => ({ data: d })) });
    if (u.includes("product_costs")) { if (rt.request().method() !== "GET") { costCalls.push(rt.request().postDataJSON()); return rt.fulfill({ status: 201, body: "" }); } return rt.fulfill({ json: u.includes("product_id=eq.p1") ? { cost: 50, supplier: "Gamarra" } : [{ product_id: "p1", cost: 50 }] }); }
    if (u.includes("/rest/v1/expenses")) { if (rt.request().method() === "POST") { const bd = rt.request().postDataJSON(); EXP.unshift({ id: 9, ...bd, voided: false, created_by: "Ana Admin" }); return rt.fulfill({ status: 201, body: "" }); } return rt.fulfill({ json: EXP }); }
    if (u.includes("/rpc/move_stock")) { const bd = rt.request().postDataJSON(); return bd.p_type === "ajuste" ? rt.fulfill({ status: 400, json: { code: "P0001", message: "STOCK_CAMBIO:4" } }) : rt.fulfill({ json: 9 }); }
    if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
    return rt.fulfill({ json: [] });
  });
  // 1) Login vacío
  await p.goto("http://localhost:4336/#staff");
  await p.waitForSelector('input[placeholder="Usuario"]');
  await p.click("text=Entrar"); await p.waitForTimeout(300);
  console.log("1) Entrar sin datos dice:", (await p.innerText("body")).match(/Escribe tu usuario[^\n]*/)?.[0]);
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.click("text=Entrar"); await p.waitForTimeout(200);
  console.log("1b) Sin contraseña dice:", (await p.innerText("body")).match(/Falta la contraseña/)?.[0]);
  await p.screenshot({ path: `${out}/m-login.png` });
  await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/m-panel.png` }); await p.evaluate(() => { const el = [...document.querySelectorAll("*")].find((x) => x.scrollHeight > x.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(x).overflowY)); if (el) el.scrollTop = el.scrollHeight; }); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/m-panel-fin.png` }); await p.evaluate(() => { document.querySelectorAll("*").forEach((x) => { if (x.scrollTop) x.scrollTop = 0; }); });
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  console.log("2) Panel: ancho página", w[0], "pantalla", w[1], w[0] > w[1] + 2 ? "⚠ SE DESBORDA" : "ok");
  await p.getByText("Más", { exact: true }).last().click(); await p.waitForTimeout(400);
  await p.locator('.more-group-btn:has-text("Equipo y reportes")').click(); await p.waitForTimeout(300); // los grupos de «Más» son desplegables
  await p.getByText("Reportes", { exact: true }).first().click(); await p.waitForTimeout(1200);
  let t = await p.innerText("body");
  console.log("R1) Ventas sin envío 447:", /Ventas \(sin envío\)[\s\S]{0,40}S\/ 447\.00/.test(t), "| incompleto por Pantalón:", t.includes("Faltan costos de 1 de 3") && t.includes("Pantalón Sastre (1)"));
  console.log("R0) Por sede y comparación:", t.includes("POR SEDE") || t.includes("Por sede"), "|", t.match(/[+-]?\d+% vs\. periodo anterior|sin ventas el periodo anterior/)?.[0], "| sin ventas:", t.includes("Vestido Midi"));
  await p.selectOption('select[aria-label="Medio de pago"]', "Yape"); await p.waitForTimeout(400);
  console.log("R0b) Filtro Yape (no hay ventas Yape este mes):", (await p.innerText("body")).includes("0 comprobantes"));
  await p.selectOption('select[aria-label="Medio de pago"]', "todos"); await p.waitForTimeout(300);
  await p.fill('input[placeholder="Monto S/ *"]', "50"); await p.selectOption('select[aria-label="Tipo de gasto"]', "Publicidad"); await p.click("text=Registrar gasto"); await p.waitForTimeout(700);
  t = await p.innerText("body");
  console.log("R2) Gasto agregado, total gastos 350:", /S\/ 350\.00/.test(t));
  await p.screenshot({ path: `${out}/m-rentabilidad.png`, fullPage: true });
  const w2 = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); console.log("R3) sin desborde:", w2[0] <= w2[1] + 2);
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
