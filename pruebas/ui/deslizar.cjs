// Prueba de la tarjeta de prenda: deslizar pasa las fotos del color elegido, los círculos cambian el color sin abrir la prenda,
// «+» respeta el color que se ve, colores sin stock no salen y la fila «Nueva colección» sigue moviéndose. Uso: node pruebas/ui/deslizar.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4404);
const pic = (fill, txt) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${fill}"/><text x="150" y="200" font-size="34" text-anchor="middle" fill="#888">${txt}</text></svg>`);
const v = (id, color, hex, stock = 3) => ["S", "M"].map((size) => ({ id: id + color + size, size, colorName: color, colorHex: hex, stock, sku: id + color + size }));
const im = (id, fill, txt, colorName) => ({ id, url: pic(fill, txt), ...(colorName ? { colorName } : {}) });
const catalog = { products: [
  { id: "p1", name: "Aldana Dress", slug: "aldana-dress", category: "Vestidos", price: 149, status: "active", showOnline: true, tag: "Nuevo",
    images: [im("i1", "#111", "NEGRO 1", "Negro"), im("i2", "#E9E4DA", "PERLA 1", "Perla"), im("i3", "#6D1F2A", "VINO 1", "Vino"), im("i4", "#222", "NEGRO 2", "Negro"), im("i5", "#DDD6C8", "PERLA 2", "Perla")],
    variants: [...v("p1", "Negro", "#111111"), ...v("p1", "Perla", "#E9E4DA"), ...v("p1", "Vino", "#6D1F2A"), ...v("p1", "Azul", "#2A4B8D", 0), ...v("p1", "Coral", "#F08A70")] },
  { id: "p2", name: "Almira Top", slug: "almira-top", category: "Tops", price: 59, status: "active", showOnline: true, tag: "Nuevo",
    images: [im("j1", "#7B8794", "FOTO 1"), im("j2", "#8B7D72", "FOTO 2")], variants: v("p2", "Acero", "#7B8794") },
  { id: "p3", name: "Falda Simple", slug: "falda-simple", category: "Faldas", price: 99, status: "active", showOnline: true, images: [im("k1", "#ccc", "UNA")], variants: v("p3", "Negro", "#111") },
  { id: "p4", name: "Vestido Coralina", slug: "vestido-coralina", category: "Vestidos", price: 189, status: "active", showOnline: true, tag: "Nuevo",
    images: [im("m1", "#F4EFE2", "MARFIL 1", "Marfil"), im("m2", "#F08A70", "CORAL 1", "Coral"), im("m3", "#F4EFE2", "MARFIL 2", "Marfil")],
    variants: [...v("p4", "Coral", "#F08A70"), ...v("p4", "Marfil", "#F4EFE2")] },
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
  let scope = ".product-grid .pcard";
  const card = (name) => p.locator(scope, { hasText: name }).first();
  const src = async (name) => decodeURIComponent((await card(name).locator(".pcard-swipe img").first().getAttribute("src")) || "");
  // Deslizar con el dedo: touchstart → touchmove → touchend. Devuelve si la página bloqueó el movimiento (true = lo usó para las fotos)
  const swipe = (name, dx, dy = 0) => card(name).locator(".pcard-swipe").evaluate((el, [dx, dy]) => {
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [mk(x, y)], changedTouches: [mk(x, y)] }));
    const mv = new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [mk(x + dx / 2, y + dy / 2)], changedTouches: [mk(x + dx / 2, y + dy / 2)] });
    el.dispatchEvent(mv);
    el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [mk(x + dx, y + dy)], changedTouches: [mk(x + dx, y + dy)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [mk(x + dx, y + dy)] }));
    return mv.defaultPrevented;
  }, [dx, dy]);
  const dots = (name) => card(name).locator(".pcard-dots span").count();
  const colorBtns = (name) => card(name).locator(".pcard-colors button").evaluateAll((bs) => bs.map((x) => x.getAttribute("aria-label")));
  check("Aldana en Negro: 2 puntitos (2 fotos de Negro)", (await dots("Aldana Dress")) === 2 && (await src("Aldana Dress")).includes("NEGRO 1"));
  const cb = await colorBtns("Aldana Dress");
  check("Círculos: solo colores con stock (Azul agotado no sale)", cb.length === 4 && !cb.some((x) => x.includes("Azul")));
  await swipe("Aldana Dress", -120); await p.waitForTimeout(250);
  check("Deslizar a la izquierda → 2.ª foto de Negro", (await src("Aldana Dress")).includes("NEGRO 2"));
  check("No abrió la prenda al deslizar", !p.url().includes("/p/"));
  await swipe("Aldana Dress", -20, -150); await p.waitForTimeout(250);
  check("Mover hacia arriba (bajar la página) no cambia la foto", (await src("Aldana Dress")).includes("NEGRO 2"));
  await card("Aldana Dress").locator("button[aria-label='Ver en Perla']").click(); await p.waitForTimeout(250);
  check("Tocar el color Perla → 1.ª foto de Perla, sin abrir la prenda", (await src("Aldana Dress")).includes("PERLA 1") && !p.url().includes("/p/"));
  await swipe("Aldana Dress", -120); await p.waitForTimeout(250);
  check("Deslizar → 2.ª foto de Perla", (await src("Aldana Dress")).includes("PERLA 2"));
  await p.screenshot({ path: `${out}/deslizar.png` });
  await swipe("Aldana Dress", 120); await p.waitForTimeout(250);
  check("Deslizar a la derecha → vuelve a la 1.ª de Perla", (await src("Aldana Dress")).includes("PERLA 1"));
  await card("Aldana Dress").locator("button[aria-label='Ver en Coral']").click(); await p.waitForTimeout(250);
  check("Color sin foto (Coral): NO abre la prenda, queda marcado", !p.url().includes("/p/") && (await card("Aldana Dress").locator("button[aria-label='Ver en Coral']").getAttribute("aria-pressed")) === "true");
  await card("Aldana Dress").locator("button[aria-label='Ver en Vino']").click(); await p.waitForTimeout(250);
  check("Vino (una sola foto): sin puntitos", (await src("Aldana Dress")).includes("VINO 1") && (await dots("Aldana Dress")) === 0);
  check("Almira (un color, 2 fotos): deslizar pasa a la 2.ª foto", (await swipe("Almira Top", -120), await p.waitForTimeout(250), (await src("Almira Top")).includes("FOTO 2")));
  check("Almira: un solo color → sin círculos", (await card("Almira Top").locator(".pcard-colors").count()) === 0);
  check("Falda con una sola foto: sin puntitos", (await dots("Falda Simple")) === 0);
  const css = await card("Aldana Dress").locator(".pcard-swipe img").first().evaluate((el) => { const c = getComputedStyle(el); const rule = [...document.querySelectorAll("style")].some((st) => /\.pcard-swipe img[^}]*-webkit-touch-callout:\s*none/.test(st.textContent)); return [rule, c.userSelect]; });
  check("Mantener el dedo sobre la foto no abre el menú de iPhone (touch-callout none)", css[0] === true && css[1] === "none");
  const ctxBlocked = await card("Aldana Dress").locator(".pcard-swipe img").first().evaluate((el) => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; });
  check("En celular, el menú de la foto (mantener presionado) queda bloqueado", ctxBlocked);
  // «+» con el color que se ve
  await card("Vestido Coralina").locator("button[aria-label='Ver en Marfil']").click(); await p.waitForTimeout(200);
  await card("Vestido Coralina").locator("button[aria-label='Añadir a la cesta']").click(); await p.waitForTimeout(400);
  const sheet = await p.innerText(".sheet-panel");
  check("«+» abre con el color que se ve en la tarjeta (Marfil), no cambia a otro", /Color\s*—\s*Marfil/i.test(sheet));
  check("La foto chica del «+» es la del color elegido", decodeURIComponent((await p.locator(".sheet-panel img").first().getAttribute("src")) || "").includes("MARFIL"));
  await p.locator(".sheet-panel button").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.keyboard.press("Escape"); await p.goto("http://localhost:4404/catalogo"); await p.waitForTimeout(1500);
  await card("Aldana Dress").locator("button[aria-label='Ver en Perla']").click(); await p.waitForTimeout(200);
  await card("Aldana Dress").locator(".pcard-swipe img").first().click(); await p.waitForTimeout(600);
  check("Tocar la foto abre la prenda en el color elegido (Perla)", p.url().includes("/p/") && (await p.innerText("body")).includes("Perla"));
  // Fila «Nueva colección»: deslizar pasa fotos y, en la última, el dedo vuelve a mover la fila
  await p.goto("http://localhost:4404/"); await p.waitForTimeout(1800);
  scope = ".nuevos-row > div";
  await card("Aldana Dress").scrollIntoViewIfNeeded();
  check("Nueva colección: la tarjeta tiene puntitos de fotos", (await dots("Aldana Dress")) === 2);
  const used = await swipe("Aldana Dress", -120); await p.waitForTimeout(250);
  check("Nueva colección: deslizar pasa a la 2.ª foto (y no mueve la fila)", used && (await src("Aldana Dress")).includes("NEGRO 2"));
  const used2 = await swipe("Aldana Dress", -120); await p.waitForTimeout(250);
  check("En la última foto, el dedo vuelve a mover la fila", !used2 && (await src("Aldana Dress")).includes("NEGRO 2"));
  const used3 = await swipe("Falda Simple", -120).catch(() => false);
  check("Prenda con una sola foto: deslizar mueve la fila", !used3);
  await p.screenshot({ path: `${out}/deslizar-inicio.png` });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
