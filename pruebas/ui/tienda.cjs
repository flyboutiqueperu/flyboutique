const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4332);
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, featured: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog = { products: [mk("p1", "Blusa Seda Marfil", 129, ["XS", "S", "M"]), mk("p2", "Pantalón Sastre", 189, ["S", "M"])], collections: [], banners: [], settings: { cartHoldMinutes: 20 }, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [label, vp] of [["celular", { width: 390, height: 844 }], ["pc", { width: 1366, height: 800 }]]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: label === "celular", hasTouch: label === "celular" });
    await ctx.addInitScript(() => { if (!sessionStorage.getItem("primera")) { sessionStorage.setItem("primera", "1");
      localStorage.setItem("flyboutique:cookieconsent:v1", "none");
      localStorage.setItem("flyboutique:wishlist:v1", JSON.stringify(["p1"]));
      localStorage.setItem("flyboutique:viewed:v1", JSON.stringify(["p2"]));
      localStorage.setItem("flyboutique:clubmember:v1", JSON.stringify({ name: "Otra Persona", phone: "51999999999" }));
      localStorage.setItem("flyboutique:actividad:v1", String(Date.now() - 2 * 3600 * 1000)); } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
    await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url(); if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } }); if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} }); return rt.fulfill({ json: [] }); });
    await p.goto("http://localhost:4332/"); await p.waitForTimeout(1500);
    const ls = await p.evaluate(() => ({ fav: localStorage.getItem("flyboutique:wishlist:v1"), club: localStorage.getItem("flyboutique:clubmember:v1"), vis: localStorage.getItem("flyboutique:viewed:v1") }));
    console.log(label, "1) Datos de la persona anterior (2 h sin uso) borrados:", !ls.fav && !ls.club && !ls.vis);
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    console.log(label, "2) inicio sin desborde:", w[0] <= w[1] + 2);
    await p.screenshot({ path: `${out}/t-inicio-${label}.png` });
    // agregar a la cesta
    await p.goto("http://localhost:4332/#/p/p1"); await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/t-ficha-${label}.png` }); const add = p.getByRole("button", { name: /añadir a la cesta|agregar a la cesta|añadir$/i }).last();
    await add.click().catch((e) => console.log("no pude agregar", e.message)); await p.waitForTimeout(500);
    await p.evaluate(() => { location.hash = "#/cart"; }); await p.waitForTimeout(800);
    let t = await p.innerText("body");
    if (!t.includes("Mi Cesta")) { await p.evaluate(() => { location.hash = "#/carrito"; }); await p.waitForTimeout(600); t = await p.innerText("body"); }
    console.log(label, "3) Aviso de reserva:", t.match(/Te apartamos estas prendas[^\n]*/)?.[0] || "(no visible)");
    await p.screenshot({ path: `${out}/t-cesta-${label}.png` });
    await ctx.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
