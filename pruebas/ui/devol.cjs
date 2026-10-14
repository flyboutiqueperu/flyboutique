const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4354);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "administrador";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["XS", "S", "M", "L"]), mk("p2", "Pantalón Sastre", 189, ["S", "M"]), mk("p3", "Vestido Midi", 219, ["M"]), mk("p4", "Top Lino", 79, ["S"])], collections: [], banners: [], settings: { cartHoldMinutes: 20 }, promoCodes: [] };
const SALE = { id: "s9", serie: "B001", numero: 123, status: "emitido", channel: "tienda", storeId: "principal", createdAt: Date.now() - 86400000, customerName: "Lucía", customerPhone: "51911111111",
  items: [{ productId: "p1", variantId: "p1M", name: "Blusa Seda Marfil", size: "M", colorName: "Negro", qty: 2, unitPrice: 129 }, { productId: "p4", variantId: "p4S", name: "Top Lino", size: "S", colorName: "Negro", qty: 1, unitPrice: 79 }],
  subtotal: 337, discount: 33.7, total: 303.3, staffName: "María", payments: [{ method: "Efectivo", amount: 303.3 }] };
const calls = []; let CUR = null;
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role, active: true } });
    if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: role === "cajero" ? [] : [{ data: CUR || SALE }] });
    if (u.includes("/rpc/find_sale_for_return")) { const bd = rt.request().postDataJSON(); return rt.fulfill({ json: bd.p_doc.toUpperCase() === "B001-000123" ? SALE : null }); }
    if (u.includes("/rpc/return_sale")) { const bd = rt.request().postDataJSON(); calls.push(bd);
      const r = { id: bd.p_request_id, at: Date.now(), by: "Caja Larco", reason: bd.p_reason, method: bd.p_method, lines: [{ variantId: "p1M", name: "Blusa Seda Marfil", size: "M", colorName: "Negro", qty: 1, unitPrice: 116.1 }], newItems: [{ variantId: "p1L", name: "Blusa Seda Marfil", size: "L", colorName: "Negro", qty: 1, unitPrice: 129 }], returnedAmount: 116.1, newAmount: 129, difference: -12.9 };
      CUR = { ...SALE, returns: [r], refundedTotal: -12.9, returnStatus: "parcial" }; return rt.fulfill({ json: CUR }); }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4354/staff/returns");
  await p.waitForSelector('input[placeholder="Usuario"]', { timeout: 8000 });
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  console.log("1) abrió:", (await p.innerText("body")).includes("Devolución o cambio"), "| hash:", new URL(p.url()).hash);
  await p.fill('input[placeholder="N.° de la venta (ej. B001-000123)"]', "b001-000999"); await p.click("text=Buscar"); await p.waitForTimeout(500);
  console.log("2) no existe:", (await p.innerText("body")).includes("No encontramos esa venta"));
  await p.fill('input[placeholder="N.° de la venta (ej. B001-000123)"]', "b001-000123"); await p.click("text=Buscar"); await p.waitForTimeout(500);
  let t = await p.innerText("body");
  console.log("3) encontrada:", t.includes("B001-000123 · S/ 303.30"), "| pagó c/u 116.10:", t.includes("pagó S/ 116.10 c/u"));
  await p.getByRole("button", { name: "Más" }).first().click();
  await p.fill('input[placeholder="Busca por nombre o escanea el código"]', "P1-L"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  t = await p.innerText("body");
  console.log("4) cambio por L:", /Blusa Seda Marfil — L\/Negro · S\/ 129/.test(t), "| cobrar 12.90:", /Cobrar a la persona\s*S\/ 12.90/.test(t));
  await p.click("text=Registrar cambio"); await p.waitForTimeout(300);
  console.log("5) pide motivo:", (await p.innerText("body")).includes("Escribe el motivo."));
  await p.fill('input[placeholder^="Motivo"]', "Talla chica");
  await p.screenshot({ path: `${out}/devol-form.png`, fullPage: true });
  await p.click("text=Registrar cambio"); await p.waitForTimeout(800);
  console.log("6) RPC:", JSON.stringify(calls[0]));
  t = await p.innerText("body");
  console.log("7) hecho:", t.includes("Cambio registrado"), "| cobrar:", t.includes("Cobrar S/ 12.90 (Efectivo)"));
  await p.screenshot({ path: `${out}/devol-ok.png` });
  // Comprobantes: detalle con devoluciones
  await p.evaluate(() => { location.hash = "#staff/invoices"; }); await p.waitForTimeout(800);
  await p.click("text=B001-000123"); await p.waitForTimeout(600);
  t = await p.innerText("body");
  console.log("8) detalle muestra devolución:", t.includes("Devoluciones y cambios"), "| botón:", t.includes("Devolución o cambio de prendas"), "| sin anular entera:", !t.includes("Anular (nota de crédito)"));
  await p.evaluate(() => { const el = document.querySelector(".app-content"); el.scrollTop = el.scrollHeight; }); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/devol-detalle.png` });
  await p.evaluate(() => { location.hash = "#staff/reports"; }); await p.waitForTimeout(900);
  t = await p.innerText("body");
  console.log("9) reporte:", t.match(/VENTAS\s*S\/ ?[\d,.]+/i)?.[0], t.match(/Prendas más vendidas[\s\S]{0,120}/)?.[0]?.replace(/\s+/g, " "));
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
