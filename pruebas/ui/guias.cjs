const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4340);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const catalog = { products: [{ id: "p1", name: "Blusa Seda", slug: "b", category: "Blusas", price: 129, status: "active", images: [], variants: [{ id: "v1", size: "M", colorName: "Negro", stock: 9, sku: "BS-M-NE", stockBy: { principal: 4, almacen: 5 } }] }], collections: [], banners: [], settings: { company: { legalName: "Fly Boutique S.A.C." } }, promoCodes: [] };
let TR = []; const calls = [];
const run = async (b, role, fn) => {
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
  const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("  ERROR:", e.message));
  p.on("dialog", (d) => d.accept());
  await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: role === "almacen" ? "Rosa Almacén" : "Carla Caja", role, active: true } });
    if (u.includes("/rest/v1/stock_transfers")) return rt.fulfill({ json: TR });
    if (u.includes("/rpc/create_transfer")) { const bd = rt.request().postDataJSON(); calls.push(["crear", bd]); const t = { id: 1, code: "T001-000001", from_loc: bd.p_from, to_loc: bd.p_to, status: "en_camino", items: bd.p_items.map((i) => ({ ...i, name: "Blusa Seda", size: "M", color: "Negro", sku: "BS-M-NE", received: null })), note: bd.p_note, created_at: new Date().toISOString(), created_by: "Rosa Almacén" }; TR = [t]; return rt.fulfill({ json: t }); }
    if (u.includes("/rpc/receive_transfer")) { const bd = rt.request().postDataJSON(); calls.push(["recibir", bd]); const t = { ...TR[0], status: "recibido", items: TR[0].items.map((i) => ({ ...i, received: bd.p_received[i.variantId] })), received_at: new Date().toISOString(), received_by: "Carla Caja", receive_note: bd.p_note }; TR = [t]; return rt.fulfill({ json: t }); }
    if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
    return rt.fulfill({ json: [] }); });
  await p.goto("http://localhost:4340/#staff");
  await p.waitForSelector('input[placeholder="Usuario"]'); await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2000);
  await fn(p); await ctx.close();
};
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  await run(b, "almacen", async (p) => {
    await p.getByText("Traslados", { exact: true }).last().click(); await p.waitForTimeout(500);
    await p.click("text=Nueva guía"); await p.waitForTimeout(300);
    const t0 = await p.innerText("body"); console.log("A1) Desde Almacén hacia Larco por defecto:", /Desde[\s\S]*Almacén/.test(t0));
    await p.fill('input[placeholder^="Escanea"]', "BS-M-NE"); await p.press('input[placeholder^="Escanea"]', "Enter"); await p.waitForTimeout(300);
    await p.fill('input[aria-label="Cantidad de Blusa Seda"]', "7"); await p.waitForTimeout(200);
    console.log("A2) Más de lo que hay bloquea:", await p.isDisabled("text=/Emitir guía/"));
    await p.fill('input[aria-label="Cantidad de Blusa Seda"]', "3"); await p.fill('input[placeholder^="Ej. reposición"]', "Reposición finde");
    await p.click("text=/Emitir guía/"); await p.waitForTimeout(700);
    const t = await p.innerText("body");
    console.log("A3) Guía emitida:", t.includes("GUÍA DE TRASLADO INTERNO") && t.includes("T001-000001"), "| enviada:", JSON.stringify(calls[0][1]));
    await p.screenshot({ path: `${out}/guia-emitida.png`, fullPage: true });
  });
  await run(b, "cajero", async (p) => {
    await p.getByText("Traslados", { exact: true }).last().click(); await p.waitForTimeout(600);
    console.log("C1) Cajero ve guía en camino:", (await p.innerText("body")).includes("En camino (1)"));
    await p.click("text=T001-000001 · Almacén → Larco"); await p.waitForTimeout(300);
    await p.click("text=Recibir en Larco"); await p.waitForTimeout(300);
    await p.fill('input[aria-label="Recibidas de Blusa Seda"]', "2"); await p.waitForTimeout(200);
    console.log("C2) Faltante pide motivo (botón bloqueado):", await p.isDisabled("text=Confirmar recepción"));
    await p.fill('input[placeholder^="Ej. llegó"]', "Una con mancha"); await p.click("text=Confirmar recepción"); await p.waitForTimeout(700);
    const t = await p.innerText("body");
    console.log("C3) Recibida:", t.includes("RECIBIDA") || t.includes("Recibida"), "| faltan:", t.includes("Faltaron 1 prendas"), "| enviado al servidor:", JSON.stringify(calls[1][1]));
    await p.screenshot({ path: `${out}/guia-recibida.png`, fullPage: true });
  });
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
