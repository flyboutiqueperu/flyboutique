// Prueba de las 3 apps instalables (tienda, Fly Staff, Fly Caja) y de dónde se ve el Outlet. Uso: node pruebas/ui/apps.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4381);
const mk = (id, name, price, extra = {}) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: [{ id: id + "M", size: "M", colorName: "Negro", colorHex: "#111", stock: 3 }], ...extra });
const catalog = { products: [mk("p1", "Vestido Lino", 100, { tag: "Nuevo" }), mk("p2", "Blusa Archivo", 40, { outlet: true, compareAtPrice: 120 })], collections: [], banners: [], settings: {}, promoCodes: [] };
let ok = true; const check = (txt, v) => { console.log(v ? "OK " : "FALLA", txt); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  p.on("dialog", (d) => { console.log("  [alerta]", d.message().split("\n")[0]); d.accept(); });
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  const man = () => p.evaluate(() => [document.querySelector('link[rel="manifest"]').getAttribute("href"), document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content, document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")]);
  const body = () => p.evaluate(() => document.body.innerText);

  await p.goto("http://localhost:4381/caja"); await p.waitForTimeout(1800);
  let m = await man(); check("/caja usa manifest-caja: " + m.join(" | "), m[0] === "/manifest-caja.webmanifest" && m[1] === "Fly Caja" && m[2] === "/icons/caja-apple-touch-icon.png");
  check("/caja queda en #caja", p.url().endsWith("/#caja"));
  check("botón «Instalar «Fly Caja» en este equipo»", (await body()).includes("Instalar «Fly Caja» en este equipo"));
  await p.screenshot({ path: `${out}/apps-caja.png` });
  await p.click(".staff-install"); await p.waitForTimeout(300);
  const mj = JSON.parse(await (await p.request.get("http://localhost:4381/manifest-caja.webmanifest")).text());
  check("manifest-caja: id /caja, start /caja", mj.id === "/caja" && mj.start_url === "/caja" && mj.icons.length === 3);
  for (const ic of mj.icons) check("ícono existe " + ic.src, fs.existsSync(path.join(dist, ic.src)));

  const p2 = await ctx.newPage(); await p2.route("http://fake.supabase.test/**", (rt) => rt.fulfill({ json: [] }));
  await p2.goto("http://localhost:4381/staff"); await p2.waitForTimeout(1800);
  m = await p2.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute("href"));
  check("/staff usa manifest-staff: " + m, m === "/manifest-staff.webmanifest");
  check("botón «Fly Staff»", (await p2.evaluate(() => document.body.innerText)).includes("Instalar «Fly Staff» en este equipo"));
  await p2.close();

  const p3 = await ctx.newPage(); await p3.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p3.goto("http://localhost:4381/"); await p3.waitForTimeout(2000);
  m = await p3.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute("href"));
  check("tienda usa manifest normal: " + m, m === "/manifest.webmanifest");
  const top = await p3.evaluate(() => { const c = document.querySelector(".outlet-card"); return c ? c.getBoundingClientRect().top : null; });
  check("tarjeta Outlet visible arriba en el inicio (y=" + top + ")", top !== null && top < 900);
  await p3.screenshot({ path: `${out}/apps-inicio.png` });
  await p3.goto("http://localhost:4381/catalogo"); await p3.waitForTimeout(1500);
  const chip = p3.locator(".filter-bar button", { hasText: "OUTLET" });
  check("chip OUTLET en el catálogo", await chip.count() === 1);
  await chip.click(); await p3.waitForTimeout(800);
  check("el chip abre el Outlet", (await p3.evaluate(() => document.body.innerText)).includes("Blusa Archivo") && p3.url().includes("/outlet"));
  await p3.screenshot({ path: `${out}/apps-outlet.png` });

  catalog.settings.outletEnabled = false;
  await p3.goto("http://localhost:4381/"); await p3.waitForTimeout(1500);
  check("Outlet cerrado: sin tarjeta", await p3.locator(".outlet-card").count() === 0);
  await p3.goto("http://localhost:4381/catalogo"); await p3.waitForTimeout(1200);
  check("Outlet cerrado: sin chip", await p3.locator(".filter-bar button", { hasText: "OUTLET" }).count() === 0);
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
