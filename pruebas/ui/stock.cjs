// Prueba de Stock y Productos: tarjetas con foto/colores/tallas, categorías con casillas, «Mostrar más», buscador por palabra,
// «atrás» paso a paso (cierra la hoja, luego la prenda; no salta a Ventas), guía de fotos y calendario. Uso: node pruebas/ui/stock.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const movil = process.env.EQUIPO === "movil";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4418);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const mk = (i, name, cat, colors, sizes, stock = 4) => ({ id: "p" + i, name, slug: "p" + i, category: cat, price: 99, status: "active", showOnline: true,
  images: colors.map((c, k) => ({ id: `i${i}${k}`, url: `${gif}#${i}${k}`, colorName: c[0] })),
  variants: colors.flatMap(([c, h]) => sizes.map((s) => ({ id: `p${i}${c}${s}`, size: s, colorName: c, colorHex: h, stock, sku: `P${i}${c.slice(0, 2).toUpperCase()}${s}` }))) });
const products = [mk(1, "Amira Dress", "Vestidos", [["Negro", "#111111"], ["Rojo", "#B3261E"]], ["M", "S", "L"], 4), mk(2, "Blusa Rojiza", "Blusas", [["Beige", "#D9C7A7"]], ["S"], 1), mk(3, "Jean Mom", "Jeans", [["Azul", "#2A4B8D"]], ["34", "30", "32"], 0)];
for (let i = 4; i <= 70; i++) products.push(mk(i, `Prenda ${i}`, i % 2 ? "Tops" : "Faldas", [["Blanco", "#FFFFFF"]], ["S", "M"], 5));
const server = { products, collections: [], banners: [], settings: {}, promoCodes: [] };
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext(movil ? { locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { locale: "es-PE", viewport: { width: 1366, height: 800 } });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); localStorage.setItem("flyboutique:idioma", "es"); });
  const p = await ctx.newPage(); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  p.on("dialog", (d) => d.accept());
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: JSON.parse(JSON.stringify(server)) } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana", role: "superadmin", active: true } });
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4418/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2200);
  // Ir a Ventas y luego a Stock (para probar que «atrás» no vuelve a Ventas mientras hay pasos abiertos)
  await p.evaluate(() => { location.hash = "#staff/pos"; }); await p.waitForTimeout(700);
  await p.evaluate(() => { location.hash = "#staff/stock"; }); await p.waitForTimeout(900);
  check("Stock: tarjetas con foto, colores y unidades (muestra 30 de 70)", (await p.locator(".stock-card").count()) === 30 && (await p.locator(".show-more").count()) === 1);
  await p.locator(".show-more").click(); await p.waitForTimeout(300);
  check("«Mostrar más» carga otras 30", (await p.locator(".stock-card").count()) >= 60);
  // Categorías con casillas (varias a la vez)
  await p.locator(".cat-picker-btn").click();
  await p.locator(".check-row", { hasText: "Vestidos" }).locator("input").check();
  await p.locator(".check-row", { hasText: "Jeans" }).locator("input").check();
  await p.waitForTimeout(200);
  check("Categorías Vestidos + Jeans: 2 prendas", (await p.locator(".stock-card").count()) === 2);
  // Desplegar el Jean: tallas en orden y en rojo las agotadas
  await p.locator(".stock-card-btn", { hasText: "Jean Mom" }).click(); await p.waitForTimeout(250);
  const sizes = await p.locator(".stock-card.is-open .stock-size div:first-child").allInnerTexts();
  check("Tallas del Jean en orden 30, 32, 34 (" + sizes.join(",") + ")", sizes.join(",") === "30,32,34");
  check("Agotadas marcadas", (await p.locator(".stock-card.is-open .stock-size.t-out").count()) === 3);
  // Tocar una talla abre el movimiento; atrás cierra la hoja, otra vez atrás cierra la prenda, y sigue en Stock
  await p.locator(".stock-card.is-open .stock-size").first().click(); await p.waitForTimeout(300);
  const sheetOpen = await p.locator("text=Tipo de movimiento").count() + await p.locator(".sheet-panel").count();
  check("Tocar la talla abre «movimiento»", sheetOpen > 0);
  await p.goBack(); await p.waitForTimeout(400);
  check("Atrás: cierra la hoja y la prenda sigue abierta", (await p.locator(".sheet-panel").count()) === 0 && (await p.locator(".stock-card.is-open").count()) === 1 && (await p.evaluate(() => location.hash)) === "#staff/stock");
  await p.goBack(); await p.waitForTimeout(400);
  check("Atrás otra vez: cierra la prenda y sigue en Stock (no salta a Ventas)", (await p.locator(".stock-card.is-open").count()) === 0 && (await p.evaluate(() => location.hash)) === "#staff/stock");
  // Historial de movimientos y atrás
  await p.locator("button", { hasText: "Historial de movimientos" }).click(); await p.waitForTimeout(400);
  await p.goBack(); await p.waitForTimeout(400);
  check("Atrás desde el historial vuelve a Stock", (await p.locator(".stock-card").count()) > 0 && (await p.evaluate(() => location.hash)) === "#staff/stock");
  await p.goBack(); await p.waitForTimeout(500);
  check("Ahora sí, atrás vuelve a Ventas", (await p.evaluate(() => location.hash)) === "#staff/pos");
  // Productos: buscar «rojo» trae solo las que tienen esa palabra (no «Rojiza»), con el color resaltado
  await p.evaluate(() => { location.hash = "#staff/products"; }); await p.waitForTimeout(900);
  await p.fill('input[aria-label="Buscar prendas"]', "rojo"); await p.waitForTimeout(300);
  const names = await p.locator(".color-line").count();
  check("Buscar «rojo»: 1 prenda (Amira, por su color), no «Blusa Rojiza»", names === 1 && !(await p.innerText("body")).includes("Blusa Rojiza") && (await p.locator(".color-hit", { hasText: "Rojo" }).count()) === 1);
  check("La lista muestra colores con unidades y tallas en orden", (await p.locator(".color-line").first().innerText()).includes("Tallas: S · M · L"));
  await p.fill('input[aria-label="Buscar prendas"]', ""); await p.waitForTimeout(200);
  check("Sin el texto del sistema anterior", !(await p.innerText("body")).toLowerCase().includes("tumisoft"));
  await p.locator(".guide-btn").click(); await p.waitForTimeout(400);
  const g = await p.locator(".photo-guide").innerText();
  check("Guía de fotos con ejemplos reales (código → prenda · color)", g.includes("Amira Dress · Negro") && g.includes("P1NEM-2.jpg") && g.includes("Descargar lista"));
  await p.screenshot({ path: `${out}/stock-guia${movil ? "-movil" : ""}.png` });
  await p.goBack(); await p.waitForTimeout(400);
  check("Atrás cierra la guía y sigue en Productos", (await p.locator(".photo-guide").count()) === 0 && (await p.evaluate(() => location.hash)) === "#staff/products");
  // Calendario desplegable en Registro de actividad
  await p.evaluate(() => { location.hash = "#staff/activity"; }); await p.waitForTimeout(900);
  await p.locator(".cal-btn").first().click(); await p.waitForTimeout(200);
  const hasCal = await p.locator(".cal-panel").count();
  const dow = hasCal ? await p.locator(".cal-panel").innerText() : "";
  check("Calendario con mes, días de la semana y números", hasCal === 1 && /L\s*M\s*M\s*J\s*V\s*S\s*D/.test(dow.replace(/\n/g, " ")));
  await p.screenshot({ path: `${out}/calendario${movil ? "-movil" : ""}.png` });
  await p.locator(".cal-grid button:not([disabled])").first().click(); await p.waitForTimeout(300);
  check("Elegir un día cierra el calendario y lo muestra en el botón", (await p.locator(".cal-panel").count()) === 0 && !(await p.locator(".cal-btn").first().innerText()).includes("Elegir día"));
  // Stock en captura
  await p.evaluate(() => { location.hash = "#staff/stock"; }); await p.waitForTimeout(900);
  await p.locator(".stock-card-btn").first().click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/stock${movil ? "-movil" : ""}.png` });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
