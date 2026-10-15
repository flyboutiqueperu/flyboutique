// Prueba de temporadas: mensaje en la franja, nota bajo la portada, figuritas una vez por visita, fechas especiales e inglés. Uso: node pruebas/ui/temporadas.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4399);
const base = { products: [{ id: "p1", name: "Blusa Seda Valentina", slug: "p1", category: "Blusas", price: 100, status: "active", showOnline: true, images: [], variants: [{ id: "v1", size: "S", colorName: "Negro", colorHex: "#111", stock: 5, sku: "V1" }] }], collections: [], banners: [{ id: "b1", active: true, order: 1, title: "Colección", image: "" }], promoCodes: [] };
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const open = async ({ date, settings = {}, lang = "es", reduce = false }) => {
    const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: reduce ? "reduce" : "no-preference" });
    await ctx.addInitScript((l) => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma:v1", l); }, lang);
    const p = await ctx.newPage(); p.setDefaultTimeout(4000);
    p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
    if (date) await p.clock.setFixedTime(new Date(date));
    await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: { ...base, settings } } }) : rt.fulfill({ json: [] }));
    await p.goto("http://localhost:4399/"); await p.waitForTimeout(1500);
    return { p, ctx };
  };
  const note = (p) => p.locator(".season-note").count().then((n) => (n ? p.locator(".season-note").innerText() : ""));
  // 1) Automático, 15 de octubre → Primavera
  let { p, ctx } = await open({ date: "2026-10-15T12:00:00" });
  let n = await note(p);
  check("15-oct: nota de Primavera bajo la portada", /primavera/i.test(n) && n.includes("colores y telas ligeras"));
  check("15-oct: mensaje en la franja negra", (await p.innerText(".app-header")).includes("PRIMAVERA: COLORES Y TELAS LIGERAS"));
  check("15-oct: caen figuritas al entrar", (await p.locator(".season-fx").count()) === 1);
  await p.screenshot({ path: `${out}/temporada-primavera.png` });
  await p.reload(); await p.waitForTimeout(1500);
  check("15-oct: al recargar ya no caen (una vez por visita)", (await p.locator(".season-fx").count()) === 0 && /primavera/i.test(await note(p)));
  await ctx.close();
  // 2) Fechas especiales
  for (const [date, name] of [["2026-12-10T12:00:00", "Navidad"], ["2027-05-08T12:00:00", "Día de la Madre"], ["2027-05-10T12:00:00", "Otoño"], ["2026-11-27T12:00:00", "Black Friday"], ["2026-07-20T12:00:00", "Fiestas Patrias"], ["2026-10-28T12:00:00", "Halloween"], ["2027-02-10T12:00:00", "San Valentín"], ["2027-01-20T12:00:00", "Verano"]]) {
    ({ p, ctx } = await open({ date }));
    n = await note(p);
    check(`${date.slice(0, 10)} → ${name}`, n.toLowerCase().includes(name.toLowerCase()));
    if (name === "Navidad") await p.screenshot({ path: `${out}/temporada-navidad.png` });
    await ctx.close();
  }
  // 3) Apagado, temporada fija, mensaje propio, sin figuritas, menos movimiento e inglés
  ({ p, ctx } = await open({ date: "2026-10-15T12:00:00", settings: { season: { mode: "off" } } }));
  check("Apagado: no hay nota ni mensaje", (await note(p)) === "" && !(await p.innerText(".app-header")).includes("PRIMAVERA"));
  await ctx.close();
  ({ p, ctx } = await open({ date: "2026-10-15T12:00:00", settings: { season: { mode: "navidad", fx: false, msgs: { navidad: { es: "Envíos hasta el 23 de diciembre", en: "Shipping until December 23" } } } } }));
  check("Fija «Navidad» con mensaje propio y sin figuritas", (await note(p)).includes("Envíos hasta el 23 de diciembre") && (await p.locator(".season-fx").count()) === 0);
  await ctx.close();
  ({ p, ctx } = await open({ date: "2026-10-15T12:00:00", reduce: true }));
  check("Menos movimiento: sin figuritas", (await p.locator(".season-fx").count()) === 0);
  await ctx.close();
  ({ p, ctx } = await open({ date: "2026-10-15T12:00:00", lang: "en" }));
  n = await note(p);
  check("Inglés: «Spring: colors and light fabrics»", /spring/i.test(n) && n.includes("Spring: colors and light fabrics"));
  await ctx.close();
  ({ p, ctx } = await open({ date: "2026-10-15T12:00:00", lang: "en", settings: { season: { mode: "navidad", msgs: { navidad: { es: "Envíos hasta el 23", en: "Shipping until the 23rd" } } } } }));
  check("Inglés: usa el mensaje propio en inglés", (await note(p)).includes("Shipping until the 23rd"));
  await ctx.close();
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
