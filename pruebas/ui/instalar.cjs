// Prueba del aviso automático «Instalar» (Android con un toque, iPhone con pasos). Uso: node pruebas/ui/instalar.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4383);
const mk = (id, name, price) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: [{ id: id + "M", size: "M", colorName: "Negro", colorHex: "#111", stock: 3 }] });
const catalog = { products: [mk("p1", "Vestido Lino", 100)], collections: [], banners: [], settings: {}, promoCodes: [] };
let ok = true; const check = (txt, v) => { console.log(v ? "OK " : "FALLA", txt); if (!v) ok = false; };
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const page = async (b, ua, init) => {
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  return p;
};
// Android: el navegador avisa que se puede instalar (evento simulado)
const fakePrompt = () => { window.__prompted = 0; setTimeout(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); }, 600); };
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  // 1) Android en /caja: aparece solo, un toque instala
  let p = await page(b, null, fakePrompt);
  await p.goto("http://localhost:4383/caja"); await p.waitForTimeout(2500);
  check("Android /caja: aviso aparece solo", await p.locator(".install-sheet").count() === 1 && (await p.innerText(".install-sheet")).includes("Instala «Fly Caja»"));
  await p.screenshot({ path: `${out}/instalar-android.png` });
  await p.click(".install-go"); await p.waitForTimeout(500);
  check("un toque → abre la instalación del celular", (await p.evaluate(() => window.__prompted)) === 1);
  check("el aviso se cierra", await p.locator(".install-sheet").count() === 0);
  await p.reload(); await p.waitForTimeout(2500);
  check("no vuelve a molestar enseguida", await p.locator(".install-sheet").count() === 0);
  await p.context().close();
  // 2) Android sin aviso del navegador (ya instalada o no compatible): no se muestra nada
  p = await page(b, null, null);
  await p.goto("http://localhost:4383/staff"); await p.waitForTimeout(2500);
  check("sin evento de instalación: no aparece", await p.locator(".install-sheet").count() === 0);
  await p.context().close();
  // 3) iPhone Safari en /staff: pasos con flecha
  p = await page(b, IPHONE, null);
  await p.goto("http://localhost:4383/staff"); await p.waitForTimeout(2500);
  const t = await p.locator(".install-sheet").count() ? await p.innerText(".install-sheet") : "";
  check("iPhone: aviso con pasos", t.includes("Instala «Fly Staff»") && t.includes("Compartir") && t.includes("Agregar a pantalla de inicio"));
  check("iPhone: flecha hacia la barra de Safari", await p.locator(".install-arrow").count() === 1);
  await p.screenshot({ path: `${out}/instalar-iphone.png` });
  await p.click('.install-sheet button[aria-label="Cerrar"]'); await p.waitForTimeout(300);
  check("se cierra con la X", await p.locator(".install-sheet").count() === 0);
  await p.context().close();
  // 4) iPhone con Chrome: pide abrir en Safari
  p = await page(b, IPHONE_CHROME, null);
  await p.goto("http://localhost:4383/caja"); await p.waitForTimeout(2500);
  check("iPhone Chrome: pide abrir en Safari", (await p.locator(".install-sheet").count()) === 1 && (await p.innerText(".install-sheet")).includes("abre esta misma página en Safari"));
  await p.context().close();
  // 5) Tienda: no aparece al llegar; sí después de mirar un rato (40 s)
  p = await page(b, IPHONE, null);
  await p.clock.install();
  await p.goto("http://localhost:4383/"); await p.clock.runFor(3000); await p.waitForTimeout(500);
  check("tienda: no aparece al llegar", await p.locator(".install-sheet").count() === 0);
  await p.clock.runFor(41000); await p.waitForTimeout(500);
  check("tienda: aparece después de 40 s", await p.locator(".install-sheet").count() === 1 && (await p.innerText(".install-sheet")).includes("Instala «Fly»"));
  await p.context().close();
  // 6) App ya instalada: nunca aparece
  p = await page(b, IPHONE, () => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q)); });
  await p.goto("http://localhost:4383/staff"); await p.waitForTimeout(2500);
  check("instalada: no aparece", await p.locator(".install-sheet").count() === 0);
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
