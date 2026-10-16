// Prueba de «Avísame cuando vuelva» (SQL 29): la tienda pide el aviso por una talla agotada y el panel muestra la lista,
// arriba la que ya tiene stock, con WhatsApp y «Marcar avisado». Uso: node pruebas/ui/avisame.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4406);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const v = (id, color, hex, size, stock) => ({ id: id + color + size, size, colorName: color, colorHex: hex, stock, sku: id + color + size });
const catalog = { products: [
  { id: "p1", name: "Aldana Dress", slug: "aldana-dress", category: "Vestidos", price: 149, status: "active", showOnline: true, images: [], variants: [v("p1", "Negro", "#111", "S", 0), v("p1", "Negro", "#111", "M", 2), v("p1", "Perla", "#eee", "S", 3)] },
  { id: "p2", name: "Falda Simple", slug: "falda-simple", category: "Faldas", price: 99, status: "active", showOnline: true, images: [], variants: [v("p2", "Negro", "#111", "S", 0)] },
], collections: [], banners: [], settings: {}, promoCodes: [] };
let alerts = [
  { id: 1, product_id: "p2", product_name: "Falda Simple", color: "Negro", size: "S", contact: "988777666", contact_type: "celular", name: null, lang: "es", status: "pendiente", created_at: new Date(Date.now() - 3600e3).toISOString() },
  { id: 2, product_id: "p1", product_name: "Aldana Dress", color: "Perla", size: "S", contact: "999888777", contact_type: "celular", name: "Lucía", lang: "es", status: "pendiente", created_at: new Date(Date.now() - 7200e3).toISOString() },
];
const calls = []; let ok = true; const check = (t, val) => { console.log(val ? "OK " : "FALLA", t); if (!val) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma:v1", "es"); });
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  p.on("dialog", (d) => d.accept());
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role: "administrador", active: true } });
    if (u.includes("/rpc/request_stock_alert")) { const bd = rt.request().postDataJSON(); calls.push(bd); if (!/^9\d{8}$|@/.test(String(bd.p_contact).replace(/\s/g, ""))) return rt.fulfill({ status: 400, json: { code: "P0001", message: "CONTACTO_INVALIDO" } }); return rt.fulfill({ json: "ok" }); }
    if (u.includes("/rpc/staff_stock_alerts")) { const st = rt.request().postDataJSON().p_status; return rt.fulfill({ json: alerts.filter((a) => st === "todos" || a.status === st) }); }
    if (u.includes("/rpc/set_stock_alert_status")) { const bd = rt.request().postDataJSON(); alerts = alerts.map((a) => a.id === bd.p_id ? { ...a, status: bd.p_status, handled_by: "Ana Admin" } : a); return rt.fulfill({ status: 204, body: "" }); }
    if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
    return rt.fulfill({ json: [] });
  });
  // 1) Tienda: talla S agotada en Negro → «¿Agotada tu talla? Avísame cuando vuelva»
  await p.goto("http://localhost:4406/p/p1"); await p.waitForTimeout(1800);
  check("Ficha: aparece «¿Agotada tu talla? Avísame cuando vuelva» (S en Negro está agotada)", (await p.locator(".avisame-link").innerText()).includes("Avísame"));
  await p.click(".avisame-link"); await p.waitForTimeout(400);
  const sheet = p.locator(".stock-alert");
  check("Se abre con la talla agotada (S) elegida", (await sheet.locator('button[aria-pressed="true"]').innerText()).trim() === "S");
  await sheet.locator('input[aria-label="Tu celular o correo"]').fill("12"); 
  check("Con un celular incompleto el botón queda apagado", await sheet.locator("button:has-text('Avisarme')").isDisabled());
  await sheet.locator('input[aria-label="Tu celular o correo"]').fill("999 888 777");
  await sheet.locator('input[aria-label="Tu nombre (opcional)"]').fill("Ana");
  await sheet.locator("button:has-text('Avisarme')").click(); await p.waitForTimeout(600);
  const c = calls[0] || {};
  check("Envía prenda, color, talla y contacto al servidor", c.p_product_id === "p1" && c.p_color === "Negro" && c.p_size === "S" && c.p_contact === "999 888 777" && c.p_name === "Ana");
  check("Confirma «¡Listo! Te avisaremos…»", (await sheet.innerText()).includes("Te avisaremos apenas vuelva la talla S"));
  await p.screenshot({ path: `${out}/avisame-tienda.png` });
  // 2) Prenda agotada entera → botón «Avísame» en el aviso de agotado
  await p.goto("http://localhost:4406/p/p2"); await p.waitForTimeout(1500);
  check("Prenda agotada: botón «Avísame» junto a «agotado por ahora»", (await p.locator(".avisame-link").count()) >= 1);
  // 3) Panel: Más → Avísame cuando vuelva
  await p.goto("http://localhost:4406/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  await p.goto("http://localhost:4406/#staff/avisos"); await p.waitForTimeout(1500);
  const txt = await p.locator(".avisos-screen").innerText();
  check("Panel: lista con «1 ya tiene stock»", txt.includes("1 ya tiene stock"));
  const first = await p.locator(".avisos-screen .aviso-stock").first().innerText();
  check("Arriba la que ya tiene stock (Aldana Perla S: «Ya hay 3»)", /ya hay 3/i.test(first) && txt.indexOf("Aldana Dress") < txt.indexOf("Falda Simple"));
  const wa = await p.locator(".avisos-screen a:has-text('WhatsApp')").first().getAttribute("href");
  check("WhatsApp al 51 + celular con el mensaje y el enlace de la prenda", wa.startsWith("https://wa.me/51999888777?text=") && decodeURIComponent(wa).includes("Hola Lucía") && decodeURIComponent(wa).includes("/p/p1"));
  await p.screenshot({ path: `${out}/avisame-panel.png` });
  await p.locator(".avisos-screen button:has-text('Marcar avisado')").first().click(); await p.waitForTimeout(800);
  check("«Marcar avisado» lo saca de pendientes", !(await p.locator(".avisos-screen").innerText()).includes("Aldana Dress") && alerts.find((a) => a.id === 2).status === "avisado");
  await p.click(".avisos-screen button:has-text('Avisados')"); await p.waitForTimeout(800);
  check("En «Avisados» sale con quién lo hizo", (await p.locator(".avisos-screen").innerText()).includes("Avisado por Ana Admin"));
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
