const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4353);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "administrador";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["XS", "S", "M", "L"]), mk("p2", "Pantalón Sastre", 189, ["S", "M"]), mk("p3", "Vestido Midi", 219, ["M"]), mk("p4", "Top Lino", 79, ["S"])], collections: [], banners: [], settings: { cartHoldMinutes: 20 }, promoCodes: [] };
const CUSTS = [
  { phone: "51911111111", data: { name: "Lucía Torres", phone: "51911111111", email: "lu@x.com", points: 120, createdAt: Date.now() - 9e8, marketing: { optIn: true, at: Date.now() - 5e8, via: "registro web" } } },
  { phone: "51922222222", data: { name: "Carlos Ruiz", phone: "51922222222", email: "", points: 0, createdAt: Date.now() - 8e8 } },
  { phone: "g:ana@gmail.com", data: { name: "Ana Google", phone: "", email: "ana@gmail.com", points: 0 } },
];
const SALES = [{ data: { id: "s1", serie: "B001", numero: 1, status: "emitido", channel: "tienda", createdAt: Date.now() - 86400000, customerPhone: "51911111111", items: [], total: 250 } }];
const calls = [];
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); window.turnstile = { render: (el, o) => { setTimeout(() => o.callback("tok"), 50); return "w1"; }, remove() {}, reset() {} }; });
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role, active: true } });
    if (u.includes("/rest/v1/sales")) return rt.fulfill({ json: SALES });
    if (u.includes("/rest/v1/customers")) return rt.fulfill({ json: u.includes("phone") ? CUSTS : CUSTS.map((c) => ({ data: c.data })) });
    if (u.includes("/rpc/staff_set_marketing")) { calls.push(rt.request().postDataJSON()); return rt.fulfill({ json: false }); }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4353/caja");
  await p.waitForSelector('input[placeholder="Usuario"]', { timeout: 8000 });
  console.log("1) /caja abre acceso staff, dirección:", new URL(p.url()).pathname + new URL(p.url()).hash);
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.evaluate(() => { location.hash = "#staff/customers"; }); await p.waitForTimeout(1200);
  let t = await p.innerText("body");
  console.log("2) Clientas:", t.match(/\d+ registradas[^\n]*/)?.[0]);
  console.log("   Lucía 250:", /Lucía Torres[\s\S]{0,80}S\/ ?250/.test(t), "| Carlos sin respuesta:", /Carlos Ruiz[\s\S]{0,80}Sin respuesta/.test(t), "| Ana g: sin +g:", !t.includes("+g:"));
  await p.click("text=Carlos Ruiz"); await p.waitForTimeout(300);
  await p.click("text=Dar de baja"); await p.waitForTimeout(300);
  console.log("3) Sin motivo pide nota:", (await p.innerText("body")).includes("Escribe cómo lo pidió"));
  await p.fill('input[placeholder="¿Cómo lo pidió? (obligatorio)"]', "Lo pidió en tienda");
  await p.getByRole("button", { name: "Acepta publicidad", exact: true }).click(); await p.waitForTimeout(600);
  console.log("4) RPC:", JSON.stringify(calls), "| ahora:", (await p.innerText("body")).match(/\d+ registradas[^\n]*/)?.[0]);
  await p.screenshot({ path: `${out}/clientas.png` });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("text=Descargar las que tienen permiso")]);
  console.log("5) Excel:", dl.suggestedFilename());
  // Tienda: registro con casilla
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => console.log("ERROR TIENDA:", e.message));
  const reg = [];
  await p2.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url(); if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } }); if (u.includes("register_customer")) { const bd = rt.request().postDataJSON(); reg.push(bd); return "p_marketing" in bd && reg.length === 1 ? rt.fulfill({ status: 404, json: { code: "PGRST202", message: "not found" } }) : rt.fulfill({ json: { name: "Nueva", phone: bd.p_phone, email: "", points: 0, existing: false } }); } return rt.fulfill({ json: [] }); });
  await p2.goto("http://localhost:4353/loyalty"); await p2.waitForTimeout(1500);
  t = await p2.innerText("body");
  console.log("6) Texto neutro:", t.includes("no eres un robot"), "| casilla:", t.includes("Quiero recibir novedades"));
  await p2.fill('input[placeholder="Nombre completo *"]', "Nueva Persona");
  await p2.fill('input[placeholder="Celular (WhatsApp) *"]', "987654321");
  await p2.fill('input[placeholder="Correo *"]', "n@x.com");
  const sum = t.match(/robot: (\d) \+ (\d)/); if (sum) await p2.fill("input >> nth=-1", String(+sum[1] + +sum[2]));
  await p2.check("input[type=checkbox] >> nth=-1");
  await p2.screenshot({ path: `${out}/registro.png`, fullPage: true });
  await p2.click("text=Registrarme"); await p2.waitForTimeout(1200);
  console.log("7) llamadas registro:", JSON.stringify(reg.map((r) => r.p_marketing)));
  console.log("8) cuadro publicidad sin confirmar:", (await p2.innerText("body")).includes("Para cambiarlo aquí, confirma tu cuenta"));
  await p2.screenshot({ path: `${out}/club-dentro.png`, fullPage: true });
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
