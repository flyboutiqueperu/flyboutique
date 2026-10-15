// Prueba: verificación de Cloudflare con señal mala → «Reintentar» (sin quitar la verificación). Uso: node pruebas/ui/captcha.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4384);
const catalog = { products: [], collections: [], banners: [], settings: { clubEnabled: true }, promoCodes: [] };
let ok = true; const check = (txt, v) => { console.log(v ? "OK " : "FALLA", txt); if (!v) ok = false; };
const fakeTs = "window.turnstile = { render: (el, o) => { el.innerHTML = '<div class=ts-ok>verificado</div>'; setTimeout(() => o.callback('tok'), 50); return 'w1'; }, remove() {}, reset() {} };";
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  // 1) Cloudflare no carga
  let mode = "falla";
  await p.route("https://challenges.cloudflare.com/**", (rt) => mode === "falla" ? rt.abort() : mode === "lento" ? null : rt.fulfill({ contentType: "text/javascript", body: fakeTs }));
  await p.goto("http://localhost:4384/loyalty"); await p.waitForTimeout(2500);
  let t = await p.innerText("body");
  check("sin Cloudflare: avisa y ofrece Reintentar", t.includes("No se pudo cargar la verificación") && await p.locator(".captcha-retry").count() === 1);
  check("la suma «no eres un robot» NO aparece (el servidor exige la verificación)", !t.includes("no eres un robot"));
  await p.screenshot({ path: `${out}/captcha-falla.png` });
  // 2) vuelve la señal → Reintentar funciona
  mode = "ok"; await p.click(".captcha-retry"); await p.waitForTimeout(1500);
  check("Reintentar carga la verificación", await p.locator(".ts-ok").count() === 1 && await p.locator(".captcha-retry").count() === 0);
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
