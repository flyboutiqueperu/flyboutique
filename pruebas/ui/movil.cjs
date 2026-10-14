const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4331);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "administrador";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["XS", "S", "M", "L"]), mk("p2", "Pantalón Sastre", 189, ["S", "M"]), mk("p3", "Vestido Midi", 219, ["M"]), mk("p4", "Top Lino", 79, ["S"])], collections: [], banners: [], settings: { cartHoldMinutes: 20 }, promoCodes: [] };
const hist = [
  { id: 3, created_at: new Date().toISOString(), product_id: "p1", variant_id: "p1M", size: "M", color: "Negro", type: "venta", qty: -1, stock_before: 6, stock_after: 5, unit_price: 129, doc: "B001-000125", customer: "Lucía Torres", seller: "MA01 · María Alvarado", staff_name: "Caja Larco", channel: "tienda" },
  { id: 2, created_at: new Date(Date.now() - 86400000).toISOString(), product_id: "p1", variant_id: "p1M", size: "M", color: "Negro", type: "entrada", qty: 4, stock_before: 2, stock_after: 6, unit_price: 129, staff_name: "Alberto", note: "Reposición proveedor" },
  { id: 1, created_at: new Date(Date.now() - 3 * 86400000).toISOString(), product_id: "p1", variant_id: "p1S", size: "S", color: "Negro", type: "anulación / devolución", qty: 1, stock_before: 3, stock_after: 4, unit_price: 129, doc: "B001-000101", staff_name: "Alberto", note: "Talla equivocada" },
];
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
    if (u.includes("/rpc/move_stock")) { const bd = rt.request().postDataJSON(); return bd.p_type === "ajuste" ? rt.fulfill({ status: 400, json: { code: "P0001", message: "STOCK_CAMBIO:4" } }) : rt.fulfill({ json: 9 }); }
    if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
    return rt.fulfill({ json: [] });
  });
  // 1) Login vacío
  await p.goto("http://localhost:4331/#staff");
  await p.waitForSelector('input[placeholder="Usuario"]');
  await p.click("text=Entrar"); await p.waitForTimeout(300);
  console.log("1) Entrar sin datos dice:", (await p.innerText("body")).match(/Escribe tu usuario[^\n]*/)?.[0]);
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.click("text=Entrar"); await p.waitForTimeout(200);
  console.log("1b) Sin contraseña dice:", (await p.innerText("body")).match(/Falta la contraseña/)?.[0]);
  await p.screenshot({ path: `${out}/m-login.png` });
  await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/m-panel.png` });
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  console.log("2) Panel: ancho página", w[0], "pantalla", w[1], w[0] > w[1] + 2 ? "⚠ SE DESBORDA" : "ok");
  const over = async (name) => { const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); console.log("   ancho", name, w[0] > w[1] + 2 ? "⚠ SE DESBORDA " + w[0] : "ok"); };
  if (role !== "cajero") {
    await p.getByText("Stock", { exact: true }).last().click(); await p.waitForTimeout(700);
    await p.getByText("Blusa Seda Marfil", { exact: true }).click(); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/m-stock.png` }); await over("stock");
    await p.click("text=Historial de esta prenda"); await p.waitForTimeout(800);
    console.log("3) Historial resumen:", (await p.innerText("body")).match(/\d+\s*Ingresadas\s*\d+\s*Vendidas/)?.[0]?.replace(/\s+/g, " "));
    await p.screenshot({ path: `${out}/m-historial.png`, fullPage: true }); await over("historial");
    await p.click("text=Volver a Stock"); await p.waitForTimeout(300);
    if (!(await p.$('button:has-text("Movimiento")'))) { await p.getByText("Blusa Seda Marfil", { exact: true }).click(); await p.waitForTimeout(300); }
    await p.getByRole("button", { name: "Movimiento", exact: true }).nth(2).click(); await p.waitForTimeout(300);
    await p.click("button:has-text('Regalo')"); await p.fill('input[inputmode="numeric"] >> nth=-1', "1");
    console.log("4) Regalo sin motivo, botón activo?:", await p.isEnabled("text=Registrar"));
    await p.fill('input[maxlength="140"]', "Regalo a @influencer"); console.log("4b) con motivo:", await p.isEnabled("text=Registrar"));
    await p.screenshot({ path: `${out}/m-movimiento.png` });
    await p.click("text=Registrar"); await p.waitForTimeout(500);
    console.log("4c) Stock tras regalo (servidor dice 9):", (await p.innerText("body")).includes("9"));
    if (!(await p.$('button:has-text("Movimiento")'))) { await p.getByText("Blusa Seda Marfil", { exact: true }).click(); await p.waitForTimeout(200); }
    await p.getByRole("button", { name: "Movimiento", exact: true }).first().click(); await p.waitForTimeout(300);
    let msg = null; p.once("dialog", async (d) => { msg = d.message(); await d.accept(); });
    await p.click("button:has-text('Conteo')"); await p.fill('input[inputmode="numeric"] >> nth=-1', "2"); await p.click("text=Registrar"); await p.waitForTimeout(600);
    console.log("5) Conteo desfasado avisa:", msg);
  } else {
    await p.screenshot({ path: `${out}/m-caja.png`, fullPage: true }); await over("caja");
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
