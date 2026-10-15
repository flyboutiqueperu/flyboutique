const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
let fakeNew = false;
const types = { ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const srv = http.createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u === "/img/orig.svg") { r.writeHead(200, { "content-type": "image/svg+xml" }); return r.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#8a3b12"/></svg>'); }
  if (u === "/img/thumb-roto.jpg") { r.writeHead(404); return r.end(); }
  let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  let body = fs.readFileSync(f);
  if (f.endsWith("index.html") && fakeNew && q.url.startsWith("/?v=")) body = Buffer.from(body.toString().replace(/\/assets\/index-[\w-]+\.js/, "/assets/index-NUEVA123.js"));
  r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(body);
}).listen(4359);
const mk = (id, name) => ({ id, name, category: "Blusas", price: 99, status: "active", showOnline: true, images: [{ id: "i", url: "http://localhost:4359/img/orig.svg", thumb: "http://localhost:4359/img/thumb-roto.jpg" }], variants: [{ id: id + "v", size: "S", colorName: "Negro", colorHex: "#111", stock: 3 }] });
const catalog = { products: Array.from({ length: 12 }, (_, i) => mk("p" + i, "Blusa " + i)), collections: [], banners: [], settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p.goto("http://localhost:4359/catalogo"); await p.waitForTimeout(2500);
  const labels = await p.$$eval(".app-nav .nav-item", (xs) => xs.filter((x) => getComputedStyle(x).display !== "none").map((x) => x.innerText.trim()));
  console.log("1) barra abajo celular:", JSON.stringify(labels));
  const srcs = await p.$$eval(".pcard img", (xs) => xs.slice(0, 3).map((x) => x.getAttribute("src").split("/").pop()));
  console.log("2) miniatura rota → original:", JSON.stringify(srcs));
  await p.screenshot({ path: `${out}/nav-catalogo.png` });
  await p.evaluate(() => { const el = document.querySelector(".app-content"); el.scrollTop = 1500; });
  await p.waitForTimeout(200);
  await p.click(".app-nav .nav-item:has-text('Catálogo')"); await p.waitForTimeout(800);
  console.log("3) tocar Catálogo otra vez sube arriba:", await p.evaluate(() => document.querySelector(".app-content").scrollTop));
  await p.click(".app-nav .nav-item:has-text('Inicio')"); await p.waitForTimeout(600);
  console.log("4) Inicio →", new URL(p.url()).pathname);
  console.log("5) manifiesto tienda:", await p.getAttribute('link[rel="manifest"]', "href"));
  await p.goto("http://localhost:4359/staff"); await p.waitForTimeout(1500);
  console.log("6) en staff:", await p.getAttribute('link[rel="manifest"]', "href"), await p.getAttribute('meta[name="apple-mobile-web-app-title"]', "content"), await p.getAttribute('link[rel="apple-touch-icon"]', "href"));
  // versión nueva publicada
  fakeNew = true;
  await p.goto("http://localhost:4359/"); await p.waitForTimeout(1500);
  await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await p.waitForTimeout(1500);
  console.log("7) aviso:", (await p.innerText("body")).includes("Hay una versión nueva de Fly"));
  await p.screenshot({ path: `${out}/nav-actualizar.png` });
  const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1280, height: 800 });
  await p2.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  fakeNew = false; await p2.goto("http://localhost:4359/"); await p2.waitForTimeout(2000);
  const l2 = await p2.$$eval(".app-nav .nav-item", (xs) => xs.filter((x) => getComputedStyle(x).display !== "none").map((x) => x.innerText.trim()));
  console.log("8) barra PC:", JSON.stringify(l2));
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
