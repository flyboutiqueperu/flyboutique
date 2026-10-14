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
  for (const [name, vp] of [["pc", { width: 1366, height: 700 }], ["celular", { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    await ctx.route("http://fake.supabase.test/**", route);
    const p = await ctx.newPage();
    await p.goto("http://localhost:4326/#caja");
    await p.fill('input[placeholder="Usuario"]', "larco"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
    await p.click("text=Entrar"); await p.waitForTimeout(2500);
    let t = await p.innerText("body");
    console.log(`[${name}] guía se abrió sola:`, t.includes("Cómo hacer una venta"), "| mensaje vendedora:", t.includes("no abrir la caja"));
    try { await p.click(".nav-item >> nth=1", { timeout: 3000 }); console.log("  menú se puede tocar: sí"); await p.click(".nav-item >> nth=0"); } catch (e) { console.log("  menú se puede tocar: NO"); }
    await p.click(".staff-help-btn"); await p.waitForTimeout(400);
    const sc = await p.$eval(".help-steps", (el) => ({ scroll: el.scrollHeight > el.clientHeight + 2 }));
    const ent = await p.$("text=Entendido"); const box = await ent.boundingBox();
    console.log("  al tocar Ayuda → barra deslizable:", sc.scroll, "| botón Entendido visible:", box && box.y + box.height <= vp.height);
    await p.screenshot({ path: process.argv[2] + `/ayuda-${name}.png` });
    await ent.click(); await ctx.close();
  }
  await b.close(); srv.close();
})();