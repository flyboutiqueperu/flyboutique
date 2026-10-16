// Prueba de fotos que ya no existen (404): se avisan, se recuerdan, y se pueden cambiar o quitar con confirmación. Uso: node pruebas/ui/fotos-rotas.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => {
  if (q.url.startsWith("/img/")) { r.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*" }); return r.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800"><rect width="1400" height="1800" fill="#333"/></svg>`); }
  if (q.url.startsWith("/gone/")) { r.writeHead(404, { "access-control-allow-origin": "*" }); return r.end(); }
  let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f));
}).listen(4402);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, images) => ({ id, name, slug: id, category: "Blusas", price: 99, status: "active", showOnline: true, images, variants: [{ id: id + "S", size: "S", colorName: "Negro", colorHex: "#111", stock: 3, sku: id.toUpperCase() }] });
const GONE = "http://localhost:4402/gone/falda.jpg";
const catalog = { products: [mk("p1", "Blusa Seda Marfil", [{ id: "i1", url: "http://localhost:4402/img/a.svg" }]), mk("p3", "Falda Plisada Marina", [{ id: "i3", url: GONE }])], collections: [], banners: [], settings: {}, promoCodes: [] };
const saves = []; const dialogs = [];
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("/storage/v1/object/")) return rt.fulfill({ json: { Key: "productos/x" } });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role: "superadmin", active: true } });
    if (u.includes("/rpc/save_catalog")) { saves.push(rt.request().postDataJSON()); return rt.fulfill({ status: 204, body: "" }); }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4402/staff/products");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  check("Aviso: 2 fotos sin versión liviana", (await p.innerText("body")).includes("2 foto(s) sin versión liviana"));
  await p.click("text=Optimizar fotos"); await p.waitForTimeout(3000);
  let t = await p.innerText("body");
  check("Resultado: 1 optimizada y 1 no (error 404)", /Listo: 1 foto\(s\) optimizadas · 1 no se pudieron/.test(t) && t.includes("error 404"));
  check("Aparece «1 foto ya no existe» con la falda y sus botones", (await p.locator(".lost-photos").innerText()).includes("Falda Plisada Marina") && (await p.locator(".lost-photos button:has-text('Quitar foto rota')").count()) === 1);
  await p.reload(); await p.waitForTimeout(2500);
  t = await p.innerText("body");
  check("Al volver ya no reintenta la foto perdida (se recuerda) y sigue avisando", !t.includes("2 foto(s) sin versión liviana") && (await p.locator(".lost-photos").count()) === 1);
  await p.click(".lost-photos button:has-text('Quitar foto rota')"); await p.waitForTimeout(1500);
  check("Pide confirmación antes de quitar", dialogs.some((d) => d.includes("Solo se quita el enlace roto")));
  const last = saves[saves.length - 1];
  const falda = last?.p_data?.products?.find((x) => x.id === "p3");
  check("Se guarda la falda sin la foto rota y la blusa no cambia", falda && falda.images.length === 0 && last.p_data.products.find((x) => x.id === "p1").images.length === 1);
  check("El aviso de foto perdida desaparece", (await p.locator(".lost-photos").count()) === 0);
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
