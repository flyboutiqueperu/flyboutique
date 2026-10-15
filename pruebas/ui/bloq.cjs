const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4326);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u-caja", aal: "aal1", role: "authenticated", exp, email: "larco@staff.flyboutique.pe" })}.sig`;
const user = { id: "u-caja", email: "larco@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [] };
const catalog = { products: [], collections: [], banners: [], settings: {}, promoCodes: [] };
const route = async (rt) => {
  const u = rt.request().url();
  if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
  if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
  if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
  if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
  if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u-caja", username: "larco", name: "Caja Larco", role: "vendedora_tienda", active: true } });
  if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
  return rt.fulfill({ json: [] });
};
const loggedIn = async (p) => { try { await p.waitForSelector("text=/Caja/", { timeout: 6000 }); return (await p.innerText("body")).includes("Cerrar sesión"); } catch (e) { return false; } };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 1366, height: 700 } });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  await ctx.route("http://fake.supabase.test/**", route);
  const p = await ctx.newPage();
  await p.goto("http://localhost:4326/#caja");
  await p.fill('input[placeholder="Usuario"]', "larco"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
  await p.click("text=Entrar"); await p.waitForTimeout(2500);
  const t = await p.innerText("body");
  // La guía ya NO se abre sola: solo al tocar «Ayuda».
  console.log("ROL vendedora_pc: guía cerrada al entrar (no se abre sola):", !/Cómo (usar la caja|hacer una venta)/.test(t), "| caja cerrada:", t.includes("está cerrada"));
  await p.screenshot({ path: process.argv[2] + "/bloq-pc.png" });
  try { await p.click("button.staff-help-btn", { timeout: 3000 }); await p.waitForTimeout(400); } catch (e) { console.log("  no se puede tocar Ayuda"); }
  console.log("  Ayuda abre la guía:", /Cómo (usar la caja|hacer una venta)/.test(await p.innerText("body")));
  await p.screenshot({ path: process.argv[2] + "/bloq-pc-antes.png" }); const ent = await p.$("text=Entendido"); console.log("  botón Entendido visible:", ent ? await ent.isVisible() : false); if (ent) { try { await ent.click({ timeout: 3000 }); } catch (e) { console.log("  no se puede tocar Entendido"); } await p.waitForTimeout(400); console.log("  guía cerrada tras Entendido:", !/Cómo (usar la caja|hacer una venta)/.test(await p.innerText("body"))); }
  // ¿se puede tocar el menú?
  const nav = await p.$$(".nav-item"); console.log("  botones de menú visibles:", nav.length);
  try { await p.click(".nav-item >> nth=1", { timeout: 3000 }); console.log("  tocar menú: OK"); } catch (e) { console.log("  tocar menú: BLOQUEADO →", e.message.split("\n")[0].slice(0, 160)); }
  await b.close(); srv.close();
})();