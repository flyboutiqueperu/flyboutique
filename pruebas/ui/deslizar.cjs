// Prueba: deslizar la foto de una tarjeta cambia de color (o de foto) sin abrir la prenda. Uso: node pruebas/ui/deslizar.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4404);
const pic = (fill, txt) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${fill}"/><text x="150" y="200" font-size="34" text-anchor="middle" fill="#888">${txt}</text></svg>`);
const v = (id, color, hex) => ["S", "M"].map((size) => ({ id: id + color + size, size, colorName: color, colorHex: hex, stock: 3, sku: id + color + size }));
const catalog = { products: [
  { id: "p1", name: "Aldana Dress", slug: "aldana-dress", category: "Vestidos", price: 149, status: "active", showOnline: true,
    images: [{ id: "i1", url: pic("#111", "NEGRO"), colorName: "Negro" }, { id: "i2", url: pic("#E9E4DA", "PERLA"), colorName: "Perla" }, { id: "i3", url: pic("#6D1F2A", "VINO"), colorName: "Vino" }],
    variants: [...v("p1", "Negro", "#111111"), ...v("p1", "Perla", "#E9E4DA"), ...v("p1", "Vino", "#6D1F2A")] },
  { id: "p2", name: "Almira Top", slug: "almira-top", category: "Tops", price: 59, status: "active", showOnline: true,
    images: [{ id: "j1", url: pic("#7B8794", "FOTO 1") }, { id: "j2", url: pic("#8B7D72", "FOTO 2") }], variants: v("p2", "Acero", "#7B8794") },
  { id: "p3", name: "Falda Simple", slug: "falda-simple", category: "Faldas", price: 99, status: "active", showOnline: true, images: [{ id: "k1", url: pic("#ccc", "UNA") }], variants: v("p3", "Negro", "#111") },
], collections: [], banners: [], settings: {}, promoCodes: [] };
let ok = true; const check = (t, val) => { console.log(val ? "OK " : "FALLA", t); if (!val) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); });
  const p = await ctx.newPage(); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p.goto("http://localhost:4404/catalogo"); await p.waitForTimeout(1800);
  const card = (name) => p.locator(".product-grid .pcard", { hasText: name }).first();
  const src = async (name) => decodeURIComponent((await card(name).locator(".pcard-swipe img, img").first().getAttribute("src")) || "");
  const swipe = (name, dx, dy = 0) => card(name).locator(".pcard-swipe").evaluate((el, [dx, dy]) => {
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [mk(x, y)], changedTouches: [mk(x, y)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [mk(x + dx, y + dy)] }));
  }, [dx, dy]);
  check("Aldana: 3 puntitos sobre la foto (3 colores con foto)", (await card("Aldana Dress").locator(".pcard-dots span").count()) === 3);
  check("Empieza en Negro", (await src("Aldana Dress")).includes("NEGRO"));
  await swipe("Aldana Dress", -120); await p.waitForTimeout(250);
  check("Deslizar a la izquierda → Perla", (await src("Aldana Dress")).includes("PERLA"));
  check("No abrió la prenda al deslizar", !p.url().includes("/p/"));
  await swipe("Aldana Dress", -120); await p.waitForTimeout(250);
  check("Otra vez → Vino", (await src("Aldana Dress")).includes("VINO"));
  await swipe("Aldana Dress", 120); await p.waitForTimeout(250);
  check("Deslizar a la derecha → vuelve a Perla", (await src("Aldana Dress")).includes("PERLA"));
  await swipe("Aldana Dress", -20, -150); await p.waitForTimeout(250);
  check("Mover hacia arriba (bajar la página) no cambia el color", (await src("Aldana Dress")).includes("PERLA"));
  await p.screenshot({ path: `${out}/deslizar.png` });
  check("Almira (un color, 2 fotos): deslizar pasa a la 2.ª foto", (await swipe("Almira Top", -120), await p.waitForTimeout(250), (await src("Almira Top")).includes("FOTO 2")));
  check("Falda con una sola foto: sin puntitos", (await card("Falda Simple").locator(".pcard-dots").count()) === 0);
  await card("Aldana Dress").locator("img").first().click(); await p.waitForTimeout(600);
  check("Tocar la foto abre la prenda en el color elegido (Perla)", p.url().includes("/p/") && (await p.innerText("body")).includes("Perla"));
  await p.goto("http://localhost:4404/"); await p.waitForTimeout(1800);
  check("Fila «Nueva colección»: sin deslizar color (la fila se sigue moviendo)", (await p.locator(".nuevos-row .pcard-swipe").count()) === 0);
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
