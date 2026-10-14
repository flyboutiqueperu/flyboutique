const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; if (u.startsWith("/img/")) { r.writeHead(200, { "content-type": "image/svg+xml" }); return r.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#8a3b12"/></svg>'); } let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4360);
const mk = (id, name, cat, tag, extra = {}) => ({ id, name, category: cat, price: 129, compareAtPrice: tag === "Oferta" ? 159 : null, tag, status: "active", showOnline: true, description: "Vestido de lino suave.", images: [{ id: "i", url: "http://localhost:4360/img/a.svg" }], variants: [{ id: id + "s", size: "S", colorName: "Negro", colorHex: "#111", stock: 3 }, { id: id + "m", size: "M", colorName: "Rojo", colorHex: "#b11", stock: 1 }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", "Vestidos", "Nuevo", { nameEn: "Linen Dress", descriptionEn: "Soft linen dress." }), mk("p2", "Blusa Seda", "Blusas", "Oferta"), mk("p3", "Falda Plisada", "Faldas", null, { outlet: true })], collections: [], banners: [], settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma:v1", "en"); });
  const p = await ctx.newPage(); p.setDefaultTimeout(3000); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url(); if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } }); if (u.includes("set_reservation")) return rt.fulfill({ json: 3 }); return rt.fulfill({ json: [] }); });
  await p.goto("http://localhost:4360/p/p1"); await p.waitForTimeout(1800);
  const btns = await p.$$eval("button", (xs) => xs.map((x) => x.innerText.trim()).filter((x) => /bag/i.test(x)));
  console.log("botones:", JSON.stringify(btns));
  await p.locator("button:visible", { hasText: "Add to bag" }).last().click();
  await p.waitForTimeout(800);
  await p.evaluate(() => { history.pushState(null, "", "/cart"); window.dispatchEvent(new PopStateEvent("popstate")); }); await p.waitForTimeout(1200);
  const spanish = async (label) => {
    const lines = await p.evaluate(() => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const pe = n.parentElement; if (!pe || /STYLE|SCRIPT/.test(pe.tagName)) continue; const tx = n.textContent.trim(); if (tx) out.add(tx); } document.querySelectorAll("[placeholder],[aria-label],[title],option").forEach((e) => { ["placeholder", "aria-label", "title"].forEach((a) => e.getAttribute(a) && out.add(e.getAttribute(a))); }); return [...out]; });
    const ES = /\b(de|del|la|las|los|el|que|para|tu|tus|con|sin|aún|está|más|por|una|un|y|o|en|al|se|te|es|hay|desde|hasta|tienda|prenda|prendas|foto|talla|cesta|envío|gratis|pedido|correo|celular|dirección|puntos|ver|todo|precio|elige|agotado|cerrar|volver|guardar|buscar|número|operación|pago|tarjeta|transferencia)\b/i;
    const sus = lines.filter((l) => (ES.test(l) || /[áéíóúñ¿¡]/.test(l)) && !/^(ES|EN|Español)$|Perú|Trujillo|Larco|Linen Dress|Vestido|Blusa|Falda|Yape|Plin/.test(l));
    console.log("  [" + label + "]", sus.length ? JSON.stringify(sus.slice(0, 30)) : "ok");
  };
  await spanish("cesta");
  for (const d of ["In-store pickup", "Delivery in Trujillo", "Shipping to another province", "International shipping"]) { await p.locator("button", { hasText: d }).first().click(); await p.waitForTimeout(500); await spanish(d); }
  await p.locator("button", { hasText: "Delivery in Trujillo" }).first().click(); await p.waitForTimeout(300);
  for (const m of ["Yape", "Plin", "Transfer", "Card"]) { const loc = p.locator("button", { hasText: m }); if (await loc.count()) { await loc.first().click(); await p.waitForTimeout(300); await spanish("pago " + m); } }
  await p.screenshot({ path: `${out}/en-cesta.png`, fullPage: true });
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
