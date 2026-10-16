// Prueba: botón «Compartir» en la ficha de la prenda (menú del celular o copiar enlace en la PC). Uso: node pruebas/ui/compartir.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4405);
const catalog = { products: [{ id: "p1", name: "Aldana Dress", slug: "aldana-dress", category: "Vestidos", price: 149, status: "active", showOnline: true, images: [],
  variants: [{ id: "v1", size: "M", colorName: "Negro", colorHex: "#111", stock: 3, sku: "ALD1" }] }], collections: [], banners: [], settings: {}, promoCodes: [] };
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const open = async (mobile, lang = "es") => {
    const ctx = await b.newContext(mobile ? { locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { locale: "es-PE", viewport: { width: 1280, height: 800 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:4405" });
    await ctx.addInitScript(([m, l]) => {
      localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma:v1", l);
      window.__shared = null;
      if (m) navigator.share = async (d) => { window.__shared = d; }; else { try { delete Navigator.prototype.share; } catch (e) { /* nada */ } navigator.share = undefined; }
    }, [mobile, lang]);
    const p = await ctx.newPage(); p.setDefaultTimeout(4000);
    p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
    await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
    await p.goto("http://localhost:4405/p/p1"); await p.waitForTimeout(1800);
    return { p, ctx };
  };
  let { p, ctx } = await open(true);
  await p.click(".pdp-topbar button[aria-label='Compartir']"); await p.waitForTimeout(300);
  const d = await p.evaluate(() => window.__shared);
  check("Celular: abre el menú de compartir con el enlace de la prenda", d && d.url === "http://localhost:4405/p/p1" && d.text.includes("Aldana Dress") && d.text.includes("149"));
  await p.screenshot({ path: `${out}/compartir-celular.png` });
  await ctx.close();
  ({ p, ctx } = await open(false));
  await p.click(".pdp-topbar button[aria-label='Compartir']"); await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check("PC: copia el enlace y avisa «Enlace copiado»", clip.includes("http://localhost:4405/p/p1") && (await p.locator(".share-copied").innerText()).includes("Enlace copiado"));
  await ctx.close();
  ({ p, ctx } = await open(true, "en"));
  await p.click(".pdp-topbar button[aria-label='Share']"); await p.waitForTimeout(300);
  check("Inglés: texto «at Fly Boutique»", ((await p.evaluate(() => window.__shared)) || {}).text?.includes("at Fly Boutique"));
  await ctx.close();
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
