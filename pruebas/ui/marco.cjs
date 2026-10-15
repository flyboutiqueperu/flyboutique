const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".css": "text/css" };
let slow = false;
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4356);
const catalog = { products: [{ id: "p1", name: "Blusa", price: 99, status: "active", showOnline: true, images: [], variants: [{ id: "v", size: "S", colorName: "Negro", colorHex: "#111", stock: 3 }] }], collections: [], banners: [], settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h, mob, name] of [[390, 844, true, "movil"], [980, 1700, true, "movil-sin-medir"], [1280, 800, false, "pc"]]) {
    const ctx = await b.newContext({ locale: "es-PE", viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("ERROR:", e.message));
    // catálogo lento: se ve la pantalla de carga
    await p.route("http://fake.supabase.test/**", async (rt) => { if (rt.request().url().includes("store_data")) { await new Promise((r) => setTimeout(r, 1500)); return rt.fulfill({ json: { data: catalog } }); } return rt.fulfill({ json: [] }); });
    await p.route("https://fonts.googleapis.com/**", async (rt) => { await new Promise((r) => setTimeout(r, 4000)); rt.fulfill({ status: 200, contentType: "text/css", body: "" }); });
    await p.goto("http://localhost:4356/", { waitUntil: "commit" }); await p.waitForTimeout(700);
    const st = await p.evaluate(() => { const f = document.querySelector(".app-frame"), cs = getComputedStyle(f), pg = getComputedStyle(document.querySelector(".app-page")); return { border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, pageBg: pg.backgroundColor, frameW: f.getBoundingClientRect().width, win: innerWidth }; });
    console.log(name, "cargando:", JSON.stringify(st));
    await p.screenshot({ path: `${out}/marco-${name}-carga.png` });
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `${out}/marco-${name}.png` });
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
