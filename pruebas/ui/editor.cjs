// Prueba del editor de prendas: secciones desplegables con resumen, tallas ordenadas (30, 32, 34), − + de stock,
// colores rápidos, orden de fotos y que al guardar no se pierda una venta hecha mientras se editaba.
// Uso: node pruebas/ui/editor.cjs <carpeta>   (EQUIPO=movil para celular)
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const movil = process.env.EQUIPO === "movil";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4416);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
// Jean con tallas guardadas en desorden (34 antes que 30 y 32)
const jean = { id: "pj", name: "Jean Mom", slug: "pj", category: "Jeans", price: 120, status: "active", showOnline: true,
  images: [{ id: "i1", url: gif, colorName: "Azul" }, { id: "i2", url: gif + "#2", colorName: null }],
  variants: ["34", "30", "32"].map((s) => ({ id: "pj" + s, size: s, colorName: "Azul", colorHex: "#2A4B8D", stock: 5, sku: "JM-" + s })) };
let server = { products: [jean], collections: [], banners: [], settings: {}, promoCodes: [] };
const saves = [];
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext(movil ? { locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { locale: "es-PE", viewport: { width: 1366, height: 768 }, hasTouch: true });
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
    if (u.includes("/rpc/save_catalog")) { const bd = rt.request().postDataJSON(); saves.push(bd); server = { ...server, products: bd.p_data.products }; return rt.fulfill({ json: null }); }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4416/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2200);
  await p.evaluate(() => { location.hash = "#staff/products"; }); await p.waitForTimeout(900);
  await p.locator("div", { has: p.locator("text=Jean Mom") }).filter({ has: p.locator('button[title="Duplicar"]') }).last().locator("button:has(svg.lucide-pencil)").click();
  await p.waitForTimeout(700);
  const body = () => p.innerText("body");
  check("Editar: secciones cerradas con su resumen", (await p.locator(".ed-sec").count()) === 7 && (await p.locator(".ed-sec.is-open").count()) === 0 && (await body()).includes("S/ 120"));
  const sumTallas = await p.locator(".ed-sec", { hasText: "Tallas y colores" }).locator(".ed-sec-sum").innerText();
  check("Resumen de tallas en orden: 30 · 32 · 34 (" + sumTallas + ")", /^30 · 32 · 34/.test(sumTallas));
  check("Resumen de stock: 15 unidades", (await p.locator(".ed-sec", { hasText: "Stock por talla" }).locator(".ed-sec-sum").innerText()).includes("15 unidades"));
  // Tallas: agregar 28 y XS → quedan ordenadas
  await p.locator(".ed-sec-btn", { hasText: "Tallas y colores" }).click();
  await p.locator("button", { hasText: /^\+ 28$/ }).click();
  await p.fill('input[placeholder="Otra talla: 38, 40…"]', "31"); await p.press('input[placeholder="Otra talla: 38, 40…"]', "Enter");
  const sizes = await p.$$eval(".ed-size", (els) => els.map((e) => e.innerText.trim()));
  check("Agregar 28 y 31: quedan 28, 30, 31, 32, 34 (" + sizes.join(",") + ")", sizes.join(",") === "28,30,31,32,34");
  await p.click('button[aria-label="Quitar talla 31"]');
  // Color rápido «Negro» con su tono
  await p.locator("button", { hasText: /^Negro$/ }).click();
  check("Color rápido «Negro» se agrega con su tono", await p.locator('.ed-color', { hasText: "Negro" }).count() === 1 && (await p.inputValue('input[aria-label="Tono de Negro"]')) === "#111111");
  // Stock con − +
  await p.locator(".ed-sec-btn", { hasText: "Stock por talla" }).click();
  const rows = await p.locator(".ed-stock-color").first().locator(".ed-stock-row span").allInnerTexts();
  check("Stock por talla en orden ascendente (" + rows.join(",") + ")", rows.join(",") === "28,30,32,34");
  await p.click('button[aria-label="Stock 30 Azul: más"]'); await p.click('button[aria-label="Stock 30 Azul: más"]');
  await p.click('button[aria-label="Stock 34 Azul: menos"]');
  await p.click('button[aria-label="Stock 28 Negro: más"]');
  check("− + cambian el stock (30 → 7, 34 → 4)", (await p.inputValue('input[aria-label="Stock 30 Azul"]')) === "7" && (await p.inputValue('input[aria-label="Stock 34 Azul"]')) === "4");
  const btnH = await p.locator('button[aria-label="Stock 30 Azul: más"]').evaluate((e) => e.getBoundingClientRect().height);
  check("Botones − + grandes para el dedo (≥ 40 px)", btnH >= 40);
  // Fotos: mover la 2.ª a portada
  await p.locator(".ed-sec-btn", { hasText: "Fotos y videos" }).click();
  await p.locator(".ed-photo").nth(1).locator('button[aria-label="Mover a la izquierda"]').click();
  check("Mover foto: la 2.ª pasa a ser PORTADA", (await p.locator(".ed-photo").first().locator("select").inputValue()) === "");
  // Mientras se edita, se vende 1 del 30 en caja (el panel lo recibe por la recarga)
  server = JSON.parse(JSON.stringify(server)); server.products[0].variants.find((v) => v.size === "30").stock = 4;
  await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await p.waitForTimeout(900);
  await p.locator("button", { hasText: "Guardar producto" }).click(); await p.waitForTimeout(900);
  const saved = saves[saves.length - 1]?.p_data?.products?.find((x) => x.id === "pj");
  const st = (s, c = "Azul") => saved?.variants.find((v) => v.size === s && v.colorName === c)?.stock;
  check("Guardado: talla 30 = 4 vendidas… 4 − 0 + 2 = 6 (no pisa la venta)", st("30") === 6);
  check("Guardado: talla 34 = 4, 32 = 5, Negro 28 = 1, ids conservados", st("34") === 4 && st("32") === 5 && st("28", "Negro") === 1 && saved?.variants.find((v) => v.size === "30" && v.colorName === "Azul")?.id === "pj30");
  check("Delta enviado al servidor solo por lo cambiado (30: +2, 34: −1)", saves[saves.length - 1]?.p_stock_deltas?.pj30 === 2 && saves[saves.length - 1]?.p_stock_deltas?.pj34 === -1);
  check("Guardado: la foto movida quedó primera", saved?.images?.[0]?.id === "i2");
  // Tienda: las tallas salen en orden
  await p.goto("http://localhost:4416/p/pj"); await p.waitForTimeout(1800);
  const tallas = await p.$$eval("button", (bs) => bs.map((x) => x.innerText.trim()).filter((x) => /^(28|30|32|34)$/.test(x)));
  check("Tienda: tallas en orden (" + tallas.join(",") + ")", tallas.length >= 3 && tallas.join(",") === [...tallas].sort((a, b) => a - b).join(","));
  // Nuevo producto: secciones necesarias abiertas
  await p.goto("http://localhost:4416/#staff/products"); await p.waitForTimeout(1500);
  await p.locator("button", { hasText: /^\s*Nuevo\s*$/ }).first().click(); await p.waitForTimeout(600);
  check("Nuevo: «Datos», «Precio», «Tallas» y «Stock» abiertas", (await p.locator(".ed-sec.is-open").count()) === 4);
  await p.screenshot({ path: `${out}/editor${movil ? "-movil" : ""}.png`, fullPage: true });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
