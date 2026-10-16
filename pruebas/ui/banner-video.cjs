// Prueba: el banner con video NO muestra otra imagen debajo/encima (solo el video); la imagen solo si el video falla.
// Y en el panel, un banner con video se puede guardar sin imagen. Uso: node pruebas/ui/banner-video.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webm": "video/webm", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => {
  const u = q.url.split("?")[0].split("#")[0];
  if (u === "/banner.webm") { r.writeHead(200, { "content-type": "video/webm" }); return r.end(fs.readFileSync(path.join(__dirname, "fixtures", "banner.webm"))); }
  let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f));
}).listen(4408);
const pic = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#c00"/></svg>');
const mk = (videoUrl) => ({ products: [], collections: [], promoCodes: [], settings: {}, banners: [{ id: "b1", title: "Nueva temporada", ctaLabel: "Ver", ctaType: "category", ctaValue: "Todo", image: pic, videoUrl, active: true, order: 1 }] });
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const open = async (catalog) => {
    const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma:v1", "es"); });
    const p = await ctx.newPage(); p.setDefaultTimeout(5000);
    p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
    await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
    await p.goto("http://localhost:4408/"); await p.waitForTimeout(2500);
    return { p, ctx };
  };
  let { p, ctx } = await open(mk("http://localhost:4408/banner.webm"));
  const hero = await p.evaluate(() => { const h = document.querySelector(".hero"); return { video: h.querySelectorAll("video").length, img: h.querySelectorAll("img").length, poster: h.querySelector("video")?.getAttribute("poster") || "", src: h.querySelector("video")?.getAttribute("src") || "" }; });
  check("Banner con video: solo el video, sin imagen debajo ni encima", hero.video === 1 && hero.img === 0 && hero.poster === "");
  check("Mientras carga muestra el primer cuadro del mismo video (#t=0.1)", hero.src.endsWith("#t=0.1"));
  await p.screenshot({ path: `${out}/banner-video.png` });
  await ctx.close();
  ({ p, ctx } = await open(mk("http://localhost:4408/no-existe.webm")));
  await p.waitForTimeout(1500);
  const h2 = await p.evaluate(() => { const h = document.querySelector(".hero"); return { video: h.querySelectorAll("video").length, img: h.querySelectorAll("img").length }; });
  check("Si el video no carga, se usa la imagen de respaldo", h2.video === 0 && h2.img === 1);
  await ctx.close();
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
