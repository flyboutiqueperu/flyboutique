const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4343);
const mk = (id, name, price, extra = {}) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, featured: true, tag: "Nuevo", images: [], variants: [{ id: id + "M", size: "M", colorName: "Negro", colorHex: "#111", stock: 3, sku: id.toUpperCase() + "M" }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", 100), mk("p2", "Blusa Archivo", 40, { outlet: true, compareAtPrice: 120, tag: null })], collections: [], banners: [], settings: { localShipping: { price: 12, freeFrom: 120 } }, promoCodes: [{ code: "FLY10", type: "percent", value: 10, active: true }] };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [label, vp] of [["celular", { width: 390, height: 844 }], ["pc", { width: 1366, height: 860 }]]) {
    const ctx = await b.newContext({ locale: "es-PE", viewport: vp, isMobile: label === "celular" });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
    await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url(); if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } }); if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} }); return rt.fulfill({ json: [] }); });
    const go = async (u) => { await p.goto("http://localhost:4343" + u); await p.waitForTimeout(1300); return { path: await p.evaluate(() => location.pathname + location.search + location.hash), title: await p.title(), body: await p.innerText("body") }; };
    let r = await go("/p/p1"); console.log(label, "1) /p/p1 abre la ficha:", r.body.includes("Vestido Lino"), "| título:", r.title);
    r = await go("/#/p/p1"); console.log(label, "2) enlace viejo #/p/p1 → ", r.path, r.body.includes("Vestido Lino"));
    r = await go("/outlet"); console.log(label, "3) /outlet:", r.body.includes("Blusa Archivo"), "| título:", r.title);
    r = await go("/catalogo/Blusas"); console.log(label, "4) /catalogo/Blusas:", r.path);
    r = await go("/cualquier-cosa"); console.log(label, "5) dirección desconocida → inicio:", r.title);
    await p.goto("http://localhost:4343/"); await p.waitForTimeout(1200);
    await p.getByText("Vestido Lino").first().click(); await p.waitForTimeout(500);
    console.log(label, "6) al abrir una prenda la dirección queda:", await p.evaluate(() => location.pathname));
    await p.goBack(); await p.waitForTimeout(500); console.log(label, "7) atrás vuelve a:", await p.evaluate(() => location.pathname));
    r = await go("/#staff"); console.log(label, "8) /#staff abre el acceso del staff:", r.body.includes("Acceso Staff"));
    r = await go("/#caja"); console.log(label, "9) /#caja abre el acceso del staff:", r.body.includes("Acceso Staff"));
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
