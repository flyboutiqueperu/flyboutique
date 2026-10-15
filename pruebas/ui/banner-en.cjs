// Prueba: textos del banner (los escribe el panel) en inglés. Uso: node pruebas/ui/banner-en.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4392);
const img = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="13"><rect width="10" height="13" fill="#555"/></svg>');
const banners = [
  { id: "b1", active: true, order: 1, title: "Piezas con carácter, hechas para volar", ctaLabel: "Ver colección", image: img },
  { id: "b2", active: true, order: 2, title: "Remate de invierno", titleEn: "Winter clearance", ctaLabel: "Comprar", ctaLabelEn: "Shop", image: img },
  { id: "b3", active: true, order: 3, title: "Texto sin traducción conocida", ctaLabel: "Mirar", image: img },
];
const catalog = { products: [], collections: [], banners, settings: {}, promoCodes: [] };
let ok = true; const check = (txt, v) => { console.log(v ? "OK " : "FALLA", txt); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma:v1", "en"); });
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p.goto("http://localhost:4392/"); await p.waitForTimeout(1500);
  const hero = async () => p.evaluate(() => document.body.innerText);
  let t = await hero();
  check("banner 1 (texto conocido) sale en inglés", t.includes("Pieces with character, made to fly") && /SHOP THE COLLECTION|See collection|VIEW COLLECTION/i.test(t) && !t.includes("Piezas con carácter"));
  await p.screenshot({ path: `${out}/banner-en.png` });
  const dots = p.locator('button[aria-label^="Banner"], button[aria-label^="Ir al banner"]');
  const n = await dots.count();
  if (n >= 2) { await dots.nth(1).click(); await p.waitForTimeout(900); t = await hero(); check("banner 2 usa su título y botón en inglés del panel", t.includes("Winter clearance") && /SHOP/i.test(t) && !t.includes("Remate de invierno")); }
  else console.log("  (no encontré los puntitos del carrusel)");
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
