// Prueba de fluidez: fotos con brillo mientras cargan (internet lento simulado), portada que rota/desliza,
// botón que guía a la talla, botón que brilla y cesta que salta. Uso: node pruebas/ui/fluidez.cjs <carpeta-capturas>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".css": "text/css" };
const colors = { a: "#2b2b2b", b: "#7a5c43", c: "#9aa4b1" };
const srv = http.createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u.startsWith("/img/")) { const k = u.slice(5, 6); return setTimeout(() => { r.writeHead(200, { "content-type": "image/svg+xml" }); r.end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${colors[k] || "#555"}"/></svg>`); }, 4000); }
  let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f));
}).listen(4362);
const img = (k) => `http://localhost:4362/img/${k}.svg`;
const mk = (id, name, k) => ({ id, name, category: "Vestidos", price: 129, status: "active", showOnline: true, description: "Vestido de lino.", images: [{ id: "i" + id, url: img(k) }], variants: [{ id: id + "s", size: "S", colorName: "Negro", colorHex: "#111", stock: 3 }, { id: id + "m", size: "M", colorName: "Negro", colorHex: "#111", stock: 2 }, { id: id + "rs", size: "S", colorName: "Rojo", colorHex: "#b11", stock: 2 }] });
const banners = [
  { id: "b1", active: true, order: 1, title: "Nueva colección", image: img("a"), ctaType: "category", ctaValue: "Todo" },
  { id: "b2", active: true, order: 2, title: "Ofertas de temporada", image: img("b"), ctaType: "category", ctaValue: "Todo" },
  { id: "b3", active: true, order: 3, title: "Video de campaña", image: img("c"), videoUrl: "http://localhost:4362/video.mp4", ctaType: "category", ctaValue: "Todo" },
];
const catalog = { products: [mk("p1", "Vestido Lino", "a"), mk("p2", "Blusa Seda", "b")], collections: [], banners, settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "es-PE" });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p.goto("http://localhost:4362/", { waitUntil: "commit" }); await p.waitForSelector(".hero img"); await p.waitForTimeout(300);
  const heroCls = () => p.evaluate(() => document.querySelector(".hero img")?.className);
  console.log("1) Foto de portada mientras carga (brillo):", await heroCls());
  await p.screenshot({ path: `${out}/fluidez-cargando.png` });
  await p.waitForTimeout(4200);
  console.log("1b) Foto de portada al llegar (aparece suave):", await heroCls(), "| prioridad:", await p.evaluate(() => document.querySelector(".hero img")?.getAttribute("fetchpriority")));
  await p.screenshot({ path: `${out}/fluidez-cargada.png` });
  const title = () => p.evaluate(() => [...document.querySelectorAll(".hero div")].find((d) => /Nueva colección|Ofertas de temporada|Video de campaña/.test(d.textContent) && d.children.length === 0)?.textContent);
  console.log("2) Título inicial:", await title());
  await p.waitForTimeout(6300);
  console.log("2b) Tras 6 s rota solo a:", await title());
  const box = await p.locator(".hero").boundingBox();
  const swipe = async (dx) => p.evaluate(([x, y, dx]) => { const el = document.querySelector(".hero"); const T = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [T(x)], changedTouches: [T(x)], bubbles: true })); el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [T(x + dx)], bubbles: true })); }, [box.x + 200, box.y + 100, dx]);
  await swipe(-120); await p.waitForTimeout(400);
  console.log("3) Deslizar a la izquierda pasa a:", await title(), "| video del banner:", await p.evaluate(() => !!document.querySelector(".hero video")));
  await swipe(120); await p.waitForTimeout(400);
  console.log("3b) Deslizar a la derecha vuelve a:", await title());
  await p.click('button[aria-label="Banner 1"]'); await p.waitForTimeout(400);
  console.log("4) Tocar el primer puntito:", await title());
  await p.evaluate(() => { history.pushState(null, "", "/p/p1"); window.dispatchEvent(new PopStateEvent("popstate")); }); await p.waitForTimeout(1200);
  const buy = p.locator(".pdp-buybar button");
  await p.locator("button", { hasText: /^M$/ }).first().click(); await p.waitForTimeout(150);
  await p.locator('button[aria-label*="Rojo"], button[title*="Rojo"]').first().click(); await p.waitForTimeout(300);
  console.log("5) Sin talla, el botón dice:", (await buy.innerText()).trim(), "| se puede tocar:", await buy.isEnabled());
  await buy.click(); await p.waitForTimeout(150);
  console.log("5b) Al tocarlo, las tallas palpitan:", await p.evaluate(() => !!document.querySelector(".size-nudge")));
  await p.screenshot({ path: `${out}/fluidez-talla.png` });
  await p.locator(".size-nudge button", { hasText: "S" }).first().click(); await p.waitForTimeout(150);
  console.log("6) Con talla elegida, el botón brilla:", await p.evaluate(() => document.querySelector(".pdp-buybar button")?.className), "|", (await buy.innerText()).trim());
  await buy.click(); await p.waitForTimeout(800);
  console.log("7) La cesta salta al añadir:", await p.evaluate(() => !!document.querySelector(".badge-bump")));
  console.log("8) Errores en la página:", errs.length ? errs : "ninguno");
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message.split("\n")[0]); process.exit(1); });
