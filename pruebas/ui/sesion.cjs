const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4325);
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
  if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u-caja", username: "larco", name: "Caja Larco", role: "cajero", active: true } });
  if (u.includes("/rpc/current_cash")) return rt.fulfill({ json: null });
  return rt.fulfill({ json: [] });
};
const loggedIn = async (p) => { try { await p.waitForSelector("text=/Caja/", { timeout: 6000 }); return (await p.innerText("body")).includes("Cerrar sesión"); } catch (e) { return false; } };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const remember of [false, true]) {
    const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 1280, height: 820 } });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    await ctx.route("http://fake.supabase.test/**", route);
    let p = await ctx.newPage();
    await p.goto("http://localhost:4325/#staff");
    await p.fill('input[placeholder="Usuario"]', "larco"); await p.fill('input[placeholder="Contraseña"]', "clave1234");
    if (remember) await p.check('input[type="checkbox"]');
    await p.click("text=Entrar");
    console.log(`[${remember ? "con" : "sin"} "mantener"] dentro:`, await loggedIn(p));
    if (!remember) {
      await p.waitForTimeout(500);
      // La guía ya no aparece sola: solo al tocar «Ayuda».
      console.log("  guía NO aparece sola:", !(await p.innerText("body")).includes("Cómo usar la caja"));
      await p.click(".staff-help-btn"); await p.waitForTimeout(400);
      console.log("  «Ayuda» abre la guía de la caja:", (await p.innerText("body")).includes("Cómo usar la caja"));
      await p.screenshot({ path: `${out}/guia-caja.png` });
      await p.click("text=Entendido");
    }
    await p.close(); p = await ctx.newPage(); await p.goto("http://localhost:4325/#staff"); await p.waitForTimeout(2500);
    const t = await p.innerText("body");
    console.log("  tras cerrar y abrir la página → sigue dentro:", t.includes("Cerrar sesión"), "| pide usuario:", t.includes("Acceso Staff"));
    if (t.includes("Cerrar sesión")) { await p.click("text=Cerrar sesión"); await p.waitForTimeout(800); console.log("  tras 'Cerrar sesión' vuelve al acceso del staff:", (await p.innerText("body")).includes("Acceso Staff")); }
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
