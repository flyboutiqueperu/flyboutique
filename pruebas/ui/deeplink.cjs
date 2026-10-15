const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4337);
const mk = (id, name, price, extra = {}) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, featured: true, tag: "Nuevo", images: [], variants: [{ id: id + "M", size: "M", colorName: "Negro", colorHex: "#111", stock: 3, sku: id.toUpperCase() + "M" }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", 100), mk("p2", "Blusa Archivo", 40, { outlet: true, compareAtPrice: 120, tag: null })], collections: [], banners: [], settings: { localShipping: { price: 12, freeFrom: 120 } }, promoCodes: [{ code: "FLY10", type: "percent", value: 10, active: true }] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [label, vp] of [["celular", { width: 390, height: 844 }], ["pc", { width: 1366, height: 860 }]]) {
    const ctx = await b.newContext({ locale: "es-PE", viewport: vp, isMobile: label === "celular" });
    await ctx.addInitScript(() => { try { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); } catch (e) { /* about:blank no tiene localStorage */ } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
    await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url(); if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } }); if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} }); return rt.fulfill({ json: [] }); });
    await p.goto("http://localhost:4337/#/outlet"); await p.waitForTimeout(1500);
    let t = await p.innerText("body");
    console.log(label, "Enlace directo #/outlet abre la sección:", t.includes("Outlet") && t.includes("Blusa Archivo"));
    await p.goto("about:blank"); await p.goto("http://localhost:4337/#/catalogo"); await p.waitForTimeout(1500);
    t = await p.innerText("body");
    console.log(label, "Enlace directo #/catalogo abre el catálogo:", t.includes("Todo el catálogo"));
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
