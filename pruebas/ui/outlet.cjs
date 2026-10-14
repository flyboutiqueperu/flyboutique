const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4334);
const mk = (id, name, price, extra = {}) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, featured: true, tag: "Nuevo", images: [], variants: [{ id: id + "M", size: "M", colorName: "Negro", colorHex: "#111", stock: 3, sku: id.toUpperCase() + "M" }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", 100), mk("p2", "Blusa Archivo", 40, { outlet: true, compareAtPrice: 120, tag: null })], collections: [], banners: [], settings: { localShipping: { price: 12, freeFrom: 120 } }, promoCodes: [{ code: "FLY10", type: "percent", value: 10, active: true }] };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [label, vp] of [["celular", { width: 390, height: 844 }], ["pc", { width: 1366, height: 860 }]]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: label === "celular" });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
    await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url(); if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } }); if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} }); return rt.fulfill({ json: [] }); });
    await p.goto("http://localhost:4334/"); await p.waitForTimeout(1500);
    let t = await p.innerText("body");
    console.log(label, "1) Inicio sin la prenda Outlet:", !t.includes("Blusa Archivo"), "| acceso OUTLET:", t.includes("OUTLET"));
    await p.evaluate(() => { location.hash = "#/catalogo"; }); await p.waitForTimeout(700);
    console.log(label, "2) Catálogo sin Outlet:", !(await p.innerText("body")).includes("Blusa Archivo"));
    await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
    await p.getByText(/Últimas unidades a precio final/).first().click(); await p.waitForTimeout(700);
    t = await p.innerText("body");
    console.log(label, "3) Sección Outlet muestra la prenda y reglas:", t.includes("Blusa Archivo") && t.includes("Venta final"));
    await p.screenshot({ path: `${out}/outlet-${label}.png` });
    // cesta: vestido 100 + blusa outlet 40, cupón 10% → 10; delivery: 100 < 120 → 12; total 142
    for (const id of ["p1", "p2"]) { await p.evaluate((x) => { location.hash = "#/p/" + x; }, id); await p.waitForTimeout(900); if (id === "p2") console.log(label, "4) Ficha Outlet con reglas:", (await p.innerText("body")).includes("Sin cambios ni devoluciones")); await p.getByRole("button", { name: /añadir a la cesta|agregar a la cesta|añadir$/i }).last().click(); await p.waitForTimeout(400); }
    await p.evaluate(() => { location.hash = "#/cart"; }); await p.waitForTimeout(700);
    await p.fill('input[placeholder="Código promocional"]', "FLY10"); await p.click("text=Aplicar"); await p.waitForTimeout(300);
    await p.click("text=Delivery en Trujillo"); await p.waitForTimeout(300);
    t = await p.innerText("body");
    console.log(label, "5) Cesta: descuento", t.match(/Descuento[^\n]*\n?[^\n]*S\/\s?\d+/)?.[0]?.replace(/\s+/g, " "), "| envío", t.match(/Env[ií]o\s*\n?\s*(S\/\s?\d+|Gratis)/)?.[1], "| total", t.match(/Total\s*\n?\s*S\/\s?[\d.]+/)?.[0]?.replace(/\s+/g, " "));
    await p.screenshot({ path: `${out}/outlet-cesta-${label}.png`, fullPage: true });
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
