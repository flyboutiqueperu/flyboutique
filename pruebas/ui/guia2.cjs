const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((q, r) => { let f = path.join(dist, decodeURIComponent(q.url.split("?")[0].split("#")[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4327);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal1", role: "authenticated", exp, email: "larco@staff.flyboutique.pe" })}.sig`;
const user = { id: "u1", email: "larco@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const I = "http://localhost:4327/img/";
const prod = (id, name, cat, price, img, sku) => ({ id, name, slug: id, category: cat, price, status: "active", images: [{ id: id + "i", url: I + img, type: "image" }], variants: ["S", "M", "L"].map((sz) => ({ id: `${id}-${sz}`, size: sz, colorName: "Negro", colorHex: "#111", stock: 4, sku: `${sku}-${sz}` })) });
const catalog = { products: [prod("p1", "Blusa Seda Valentina", "Blusas", 119, "blusa.svg", "BLU"), prod("p2", "Vestido Noche Imperial", "Vestidos", 259, "vestido.svg", "VES"), prod("p3", "Blazer Entallado Sofía", "Abrigos", 199, "saco.svg", "BLA")], collections: [], banners: [],
  settings: { company: { legalName: "Fly Boutique S.A.C.", ruc: "20123456789", address: "Av. Larco 126, Trujillo", phone: "51978687704", email: "flyboutiqueperu@gmail.com" }, stores: [{ id: "principal", name: "Tienda Larco", address: "Av. Larco 126, Trujillo" }] }, promoCodes: [] };
const now = new Date();
let cash = null;
const openCash = { id: "s1", store_id: "principal", status: "abierta", opened_by_name: "Caja Larco", opened_seller: "MA01 · María Alvarado", opened_at: new Date(now - 5 * 3600e3).toISOString(), opening_amount: 100,
  byMethod: { Efectivo: 498, Yape: 259, Tarjeta: 199 }, entradas: 0, salidas: 15, cashSales: 498, expectedCash: 583, salesCount: 5,
  bySeller: { "MA01 · María Alvarado": { ventas: 3, total: 576, porMetodo: { Efectivo: 318, Yape: 259 } }, "LU01 · Lucía Torres": { ventas: 2, total: 380, porMetodo: { Efectivo: 180, Tarjeta: 199 } } },
  movements: [{ id: "m1", type: "salida", amount: 15, reason: "Taxi para envío", seller: "LU01 · Lucía Torres", created_at: new Date(now - 2 * 3600e3).toISOString() }] };
const order = { id: "o1", serie: "B001", numero: 231, channel: "online", source: "web", status: "emitido", paymentStatus: "pendiente_validacion", fulfillment: "pendiente", deliveryMethod: "local", paymentMethod: "Yape", paymentRef: "48213", customerName: "Andrea Ruiz", customerPhone: "51987654321", deliveryAddress: "Calle Los Pinos 145, Víctor Larco", items: [{ productId: "p2", variantId: "p2-M", name: "Vestido Noche Imperial", size: "M", colorName: "Negro", qty: 1, unitPrice: 259 }], subtotal: 259, total: 271, shipping: 12, createdAt: Date.now() - 3 * 3600e3 };
const route = async (rt) => {
  const u = rt.request().url();
  if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
  if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
  if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
  if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
  if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "larco", name: "Caja Larco", role: "cajero", active: true } });
  if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: cash });
  if (u.includes("/rpc/open_cash")) { cash = openCash; return rt.fulfill({ json: cash }); }
  if (u.includes("/rest/v1/sellers")) return rt.fulfill({ json: [{ code: "LU01", name: "Lucía Torres" }, { code: "MA01", name: "María Alvarado" }] });
  if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: [{ data: order }] });
  if (u.includes("/rpc/pos_sale")) { const b = rt.request().postDataJSON().p_sale; return rt.fulfill({ json: { ...b, id: "sale_9", serie: "B001", numero: 232, subtotal: 259, discount: 0, total: 259, status: "emitido", source: "pos", cashierName: "Caja Larco", earnedPoints: 259, createdAt: Date.now() } }); }
  return rt.fulfill({ json: [] });
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 1180, height: 780 } });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  await ctx.route("http://fake.supabase.test/**", route);
  const p = await ctx.newPage();
  const shot = async (name) => { await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${name}.png` }); console.log("captura:", name); };
  await p.goto("http://localhost:4327/#staff");
  await p.fill('input[placeholder="Usuario"]', "larco"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForSelector("text=está cerrada");
  await p.click("button[title='María Alvarado (MA01)']"); await p.click("text=S/ 100");
  await shot("caja-cerrada");
  await p.click("text=Abrir caja"); await p.waitForSelector("text=Caja abierta");
  await shot("caja-abierta");
  await p.click("button[title^='Cambio de turno']"); await p.waitForTimeout(300);
  await p.click("button[title='María Alvarado (MA01)'] >> nth=0"); await p.fill('input[inputmode="decimal"] >> nth=0', "583"); await p.waitForTimeout(200);
  await p.fill('input[placeholder="583.00"]', "200"); await p.click("button[title='Lucía Torres (LU01)'] >> nth=1");
  await p.evaluate(() => window.scrollTo(0, 0)); await p.locator('text="Cerrar el día"').scrollIntoViewIfNeeded(); // en cambio de turno el formulario se titula «Cambio de turno»
  await shot("cambio-turno");
  await p.click("button[title^='Cerrar caja']"); await p.waitForTimeout(300);
  await p.click("button[title='Lucía Torres (LU01)'] >> nth=0"); await p.fill('input[inputmode="decimal"] >> nth=0', "580"); await p.fill('input[placeholder^="Motivo de la diferencia"]', "Vuelto mal dado en una venta");
  await p.locator("text=Cierre y arqueo").scrollIntoViewIfNeeded();
  await shot("cierre");
  await p.click(".nav-item >> text=Vender"); await p.waitForSelector("text=Vestido Noche Imperial");
  await p.fill('input[placeholder="Lector de códigos o buscar producto"]', "VES-M"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  const add = await p.$("text=/^Agregar/"); if (add) await add.click();
  await shot("venta");
  await p.click("text=/Cobrar/"); await p.waitForTimeout(400);
  await p.fill('input[placeholder="DNI (8 dígitos) *"]', "45678912"); await p.fill('input[placeholder="Nombres y apellidos *"]', "Lucía Ramírez Vega"); await p.fill('input[type="email"]', "lucia@correo.com");
  await p.click("button[title='Atendió María Alvarado (MA01)']");
  await p.click("button:has-text('Efectivo')"); await p.waitForTimeout(200);
  await p.fill('input[placeholder="259.00"]', "300"); await p.waitForTimeout(200);
  await shot("cobro");
  await p.click("text=/Registrar venta/"); await p.waitForSelector(".receipt-doc");
  await shot("comprobante");
  await p.click("text=Nueva venta"); await p.click(".nav-item >> text=Pedidos"); await p.waitForSelector("text=Andrea Ruiz");
  await shot("pedidos");
  await p.click(".staff-help-btn").catch(() => {}); await shot("ayuda-pedidos-chk"); await p.click("text=Entendido").catch(() => {});
  await p.goto("http://localhost:4327/#staff/manual"); await p.waitForTimeout(1500); await shot("manual-chk");
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
