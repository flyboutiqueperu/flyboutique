const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; if (u.startsWith("/img/")) { r.writeHead(200, { "content-type": "image/svg+xml" }); return r.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#8a3b12"/></svg>'); } let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4360);
const mk = (id, name, cat, tag, extra = {}) => ({ id, name, category: cat, price: 129, compareAtPrice: tag === "Oferta" ? 159 : null, tag, status: "active", showOnline: true, description: "Vestido de lino suave.", images: [{ id: "i", url: "http://localhost:4360/img/a.svg" }], variants: [{ id: id + "s", size: "S", colorName: "Negro", colorHex: "#111", stock: 3 }, { id: id + "m", size: "M", colorName: "Rojo", colorHex: "#b11", stock: 1 }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", "Vestidos", "Nuevo", { nameEn: "Linen Dress", descriptionEn: "Soft linen dress." }), mk("p2", "Blusa Seda", "Blusas", "Oferta"), mk("p3", "Falda Plisada", "Faldas", null, { outlet: true })], collections: [], banners: [], settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(2500); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p.goto("http://localhost:4360/"); await p.waitForTimeout(2000);
  console.log("1) inicio ES:", (await p.innerText(".app-header")).replace(/\s+/g, " ").slice(-60));
  await p.click("button[title='English']"); await p.waitForTimeout(500);
  let tx = await p.innerText("body");
  console.log("2) inicio EN:", ["FREE DELIVERY", "Home", "Catalog", "Favorites", "Bag", "Account", "What are you looking for today?", "New collection"].map((w) => `${w}:${tx.includes(w)}`).join(" "), "| html lang:", await p.evaluate(() => document.documentElement.lang));
  await p.screenshot({ path: `${out}/en-inicio.png` });
  const visit = async (path) => { await p.evaluate((x) => { history.pushState(null, "", x); window.dispatchEvent(new PopStateEvent("popstate")); }, path); await p.waitForTimeout(700); };
  const spanish = async (label) => {
    const lines = await p.evaluate(() => {
      const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const attrs = [...document.querySelectorAll("[placeholder],[aria-label],[title]")].map((e) => [e.getAttribute("placeholder"), e.getAttribute("aria-label"), e.getAttribute("title")]).flat().filter(Boolean);
      let n; while ((n = w.nextNode())) { const tx = n.textContent.trim(); if (tx && n.parentElement && getComputedStyle(n.parentElement).display !== "none") out.add(tx); }
      attrs.forEach((a) => out.add(a));
      return [...out];
    });
    const ES = /\b(de|del|la|las|los|el|que|para|tu|tus|con|sin|aún|está|están|más|por|una|un|y|o|en|al|se|te|nos|es|son|hay|desde|hasta|tienda|prenda|prendas|foto|talla|cesta|envío|gratis|pedido|pedidos|correo|celular|dirección|puntos|ver|todo|precio|ordenar|categoría|clienta|cuenta|inicio|catálogo|elige|agotado|nuevo|oferta|cerrar|volver|guardar|buscar)\b/i;
    const sus = lines.filter((l) => ES.test(l) && !/Fly Boutique|Av\. Larco|@flyboutique|Trujillo|Perú|Yape|Plin|S\/|Linen Dress|Vestido Lino|Blusa Seda|Falda Plisada/.test(l) || /[áéíóúñ¿¡]/.test(l) && !/Perú|Trujillo|Larco/.test(l));
    if (sus.length) console.log("  [" + label + "] español visible:", JSON.stringify(sus.slice(0, 25)));
  };
  await spanish("inicio");
  for (const path of ["/catalogo", "/outlet", "/p/p1", "/profile", "/track", "/complaints", "/payments", "/info"]) { await visit(path); await spanish(path); }
  // Ficha: guía de tallas
  await visit("/p/p1"); await p.getByRole("button", { name: /Not sure about your size|Size guide/ }).first().click().catch(() => {}); await p.waitForTimeout(400); await spanish("guía de tallas"); await p.keyboard.press("Escape").catch(() => {}); await p.waitForTimeout(200);
  await p.locator("button", { hasText: /^S$/ }).first().click().catch(() => {}); await p.getByRole("button", { name: /ADD TO BAG|Add to bag/i }).last().click().catch(() => {}); await p.waitForTimeout(500);
  await visit("/catalogo");
  for (const f of ["Category", "Size", "Color", "Price", "Featured", "Sort"]) { await p.locator(".filter-bar button", { hasText: f }).first().click().catch(() => {}); await p.waitForTimeout(250); await spanish("filtro " + f); }
  // Añadir rápido
  await p.getByRole("button", { name: "Add to bag" }).first().click().catch(() => {}); await p.waitForTimeout(400); await spanish("añadir rápido"); await p.keyboard.press("Escape").catch(() => {});
  // Búsqueda
  await visit("/"); await p.click("button:has-text('What are you looking for today?')").catch(() => {}); await p.waitForTimeout(300); await p.keyboard.type("vest"); await p.waitForTimeout(400); await spanish("búsqueda"); await p.keyboard.type("zzzz"); await p.waitForTimeout(300); await spanish("búsqueda sin resultados"); await p.keyboard.press("Escape").catch(() => {});
  // Cesta con prenda: cada forma de entrega y pago
  await visit("/cart"); await spanish("cesta");
  for (const d of ["In-store pickup", "Delivery in Trujillo", "Shipping to another province", "International shipping"]) { await p.click(`text=${d}`).catch(() => {}); await p.waitForTimeout(400); await spanish("cesta · " + d); }
  for (const m of ["Yape", "Plin", "Transferencia", "Bank transfer", "Card", "Tarjeta"]) { await p.locator("button", { hasText: m }).first().click({ timeout: 800 }).catch(() => {}); await p.waitForTimeout(200); }
  await spanish("cesta · pagos");
  await p.screenshot({ path: `${out}/en-cesta.png`, fullPage: true });
  // Club: crear cuenta / entrar
  await visit("/loyalty"); await spanish("club crear"); await p.click("text=I have an account").catch(() => {}); await p.waitForTimeout(300); await spanish("club entrar"); await p.click("text=With password").catch(() => {}); await p.waitForTimeout(300); await spanish("club contraseña");
  // Info: todas las pestañas
  await visit("/info"); for (let i = 0; i < 7; i++) { await p.locator("button").filter({ hasText: /Help|Size guide|Security|Right of|Work with|Returns/ }).nth(i).click({ timeout: 600 }).catch(() => {}); await p.waitForTimeout(150); await spanish("info " + i); }
  const missing = await p.evaluate(() => [...(window.__flyMissingEN || [])]);
  console.log("4) textos sin traducir vistos:", missing.length, JSON.stringify(missing.slice(0, 60)));
  // Texto visible en español que no pasa por t()
  // Staff en español aunque el idioma sea EN
  await p.goto("http://localhost:4360/staff"); await p.waitForTimeout(1500);
  tx = await p.innerText("body");
  console.log("5) staff texto:", JSON.stringify(tx.slice(0, 300)), "| html lang:", await p.evaluate(() => document.documentElement.lang));
  await p.goto("http://localhost:4360/"); await p.waitForTimeout(1500);
  console.log("6) tras volver, recuerda EN:", (await p.innerText("body")).includes("Catalog"));
  await p.click("button[title='Español']"); await p.waitForTimeout(400);
  console.log("7) vuelve a ES:", (await p.innerText("body")).includes("Catálogo"));
  const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1280, height: 800 });
  await p2.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p2.goto("http://localhost:4360/"); await p2.waitForTimeout(1500);
  console.log("8) PC: botón idioma visible:", await p2.locator(".app-nav .nav-lang").isVisible());
  await p2.click(".app-nav .nav-lang button[title='English']"); await p2.waitForTimeout(400);
  await p2.screenshot({ path: `${out}/en-pc.png` });
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
