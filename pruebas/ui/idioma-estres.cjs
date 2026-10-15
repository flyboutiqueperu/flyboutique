// Prueba de estrés del idioma: en cada pantalla de la tienda se cambia ES↔EN 10 veces seguidas.
// Revisa: sin errores, la pantalla no queda en blanco, la cesta no se pierde y el staff sigue en español.
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist");
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; if (u.startsWith("/img/")) { r.writeHead(200, { "content-type": "image/svg+xml" }); return r.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#555"/></svg>'); } let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": u.endsWith(".js") ? "text/javascript" : u.endsWith(".css") ? "text/css" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4364);
const img = "http://localhost:4364/img/a.svg";
const mk = (id, name, cat, extra = {}) => ({ id, name, category: cat, price: 129, compareAtPrice: id === "p2" ? 159 : null, status: "active", showOnline: true, description: "Vestido de lino.", images: [{ id: "i" + id, url: img }, { id: "j" + id, url: img }], variants: [{ id: id + "s", size: "S", colorName: "Negro", colorHex: "#111", stock: 3 }, { id: id + "m", size: "M", colorName: "Rojo", colorHex: "#b11", stock: 1 }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", "Vestidos", { nameEn: "Linen Dress" }), mk("p2", "Blusa Seda", "Blusas"), mk("p3", "Falda", "Faldas", { outlet: true })], collections: [], banners: [{ id: "b1", active: true, order: 1, title: "Nueva colección", image: img }, { id: "b2", active: true, order: 2, title: "Ofertas", image: img }], settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  let fallas = 0;
  for (const [equipo, opts] of [["celular", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["PC", { viewport: { width: 1366, height: 860 } }]]) {
    const ctx = await b.newContext({ locale: "es-PE", ...opts });
    await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
    const p = await ctx.newPage(); p.setDefaultTimeout(4000);
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::/.test(m.text())) errs.push(m.text()); });
    await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
    await p.goto("http://localhost:4364/"); await p.waitForTimeout(1500);
    const visit = async (u) => { await p.evaluate((x) => { history.pushState(null, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, u); await p.waitForTimeout(600); };
    // Algo en la cesta para revisar que no se pierde
    await visit("/p/p1"); await p.locator("button:visible", { hasText: /agregar a la cesta/i }).first().click(); await p.waitForTimeout(500);
    const flip = async () => { for (let i = 0; i < 10; i++) { const btn = p.locator(`button[title='${i % 2 ? "Español" : "English"}']:visible`).first(); if (!(await btn.count())) return false; await btn.click(); await p.waitForTimeout(60); } return true; };
    for (const [name, go] of [["inicio", () => visit("/")], ["catálogo", () => visit("/catalogo")], ["outlet", () => visit("/outlet")], ["ficha", () => visit("/p/p1")], ["cesta", () => visit("/cart")], ["cuenta", () => visit("/profile")], ["rastreo", () => visit("/track")], ["reclamaciones", () => visit("/complaints")], ["info", () => visit("/info")]]) {
      await go(); const n0 = errs.length;
      const ok = await flip(); await p.waitForTimeout(300);
      const txt = (await p.innerText("body")).trim();
      const lang = await p.evaluate(() => document.documentElement.lang);
      const bag = await p.evaluate(() => document.body.innerText.match(/(Cesta|Bag)\s*\((\d+)\)/)?.[2] || [...document.querySelectorAll(".badge-bump")].map((x) => x.textContent)[0] || "");
      const bien = ok && txt.length > 100 && errs.length === n0 && lang === "es";
      if (!bien) fallas++;
      console.log(`[${equipo}] ${name}: ${bien ? "ok" : "PROBLEMA"} | botón ES/EN: ${ok} | termina en: ${lang} | texto: ${txt.length} letras | cesta: ${bag}${errs.length > n0 ? " | errores: " + errs.slice(n0).join(" / ") : ""}`);
    }
    // Panel del staff: siempre en español aunque la tienda quede en inglés
    await visit("/"); await p.locator("button[title='English']:visible").first().click(); await p.waitForTimeout(200);
    await p.goto("http://localhost:4364/#staff"); await p.waitForTimeout(1500);
    const st = await p.innerText("body");
    const stOk = /Acceso Staff/.test(st) && (await p.locator("button[title='English']:visible").count()) === 0;
    if (!stOk) fallas++;
    console.log(`[${equipo}] staff en español y sin botón de idioma: ${stOk}`);
    await ctx.close();
  }
  console.log(fallas ? `RESULTADO: ${fallas} problemas` : "RESULTADO: todo bien");
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
