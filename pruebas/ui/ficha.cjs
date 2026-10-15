const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml" };
const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${c}"/><circle cx="200" cy="250" r="80" fill="#fff"/></svg>`;
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; if (u.startsWith("/img/")) { r.writeHead(200, { "content-type": "image/svg+xml" }); return r.end(svg(u.includes("a") ? "#8a3b12" : "#123b8a")); } let f = path.join(dist, u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4355);
const prod = { id: "p1", name: "Vestido Lino", slug: "p1", category: "Vestidos", price: 199, status: "active", showOnline: true,
  images: [{ id: "i1", url: "http://localhost:4355/img/a.svg" }, { id: "i2", url: "http://localhost:4355/img/b.svg" }],
  variants: [{ id: "v1", size: "S", colorName: "Negro", colorHex: "#111", stock: 2, sku: "V-S-N" }, { id: "v2", size: "M", colorName: "Negro", colorHex: "#111", stock: 3, sku: "V-M-N" },
             { id: "v3", size: "S", colorName: "Rojo", colorHex: "#b11", stock: 1, sku: "V-S-R" }, { id: "v4", size: "M", colorName: "Rojo", colorHex: "#b11", stock: 0, sku: "V-M-R" }] };
const catalog = { products: [prod], collections: [], banners: [], settings: {}, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p.goto("http://localhost:4355/p/p1"); await p.waitForTimeout(1800);
  const txt = () => p.innerText("body");
  // Talla M en Negro, subir cantidad a 3, cambiar a Rojo
  await p.locator("button", { hasText: /^M$/ }).first().click();
  await p.getByRole("button", { name: "Más" }).first().click(); await p.getByRole("button", { name: "Más" }).first().click();
  console.log("1) Negro M cantidad:", (await txt()).match(/Cantidad\s*(\d)/)?.[1]);
  await p.getByRole("button", { name: "Rojo", exact: true }).first().click(); await p.waitForTimeout(200);
  let t = await txt();
  console.log("2) Rojo: aviso:", t.includes("La talla M no está disponible en Rojo"), "| talla:", t.match(/Talla: ([^\n]+)/)?.[1], "| botón:", /elige una talla/i.test(t));
  const guide = p.locator(".pdp-buybar button");
  console.log("3) botón «Elige una talla» activo (lleva a las tallas):", await guide.isEnabled());
  await guide.click(); await p.waitForTimeout(150);
  console.log("3b) al tocarlo, las tallas palpitan:", await p.evaluate(() => !!document.querySelector(".size-nudge")));
  await p.locator("button", { hasText: /^S$/ }).first().click(); await p.waitForTimeout(200);
  t = await txt();
  console.log("4) Rojo S: cantidad", t.match(/Cantidad\s*(\d)/)?.[1], "| agregar:", /agregar a la cesta/i.test(t), "| aviso borrado:", !t.includes("no está disponible en Rojo"));
  await p.getByRole("button", { name: "Negro", exact: true }).first().click(); await p.waitForTimeout(200);
  console.log("5) volver a Negro mantiene S:", (await txt()).match(/Talla: ([^\n]+)/)?.[1]);
  await p.screenshot({ path: `${out}/ficha-color.png` });
  // Visor: abrir y pellizcar
  await p.getByRole("button", { name: "Ver foto en grande" }).first().click(); await p.waitForTimeout(600);
  const area = await p.locator("img[alt='Vestido Lino']").last().boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const cx = area.x + area.width / 2, cy = area.y + area.height / 2;
  const tp = (pts) => pts.map(([x, y], i) => ({ x, y, id: i }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp([[cx - 30, cy], [cx + 30, cy]]) });
  for (let k = 1; k <= 6; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp([[cx - 30 - k * 15, cy], [cx + 30 + k * 15, cy]]) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(300);
  const info = await p.evaluate(() => ({ vv: window.visualViewport.scale, tf: [...document.querySelectorAll("img")].pop().style.transform, w: document.documentElement.scrollWidth }));
  console.log("6) pellizco agranda:", info.tf, "| zoom de página:", info.vv, "| ancho:", info.w);
  await p.screenshot({ path: `${out}/visor-zoom.png` });
  // Pellizco hacia adentro (achicar) → vuelve a 1, la página no se achica
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp([[cx - 120, cy], [cx + 120, cy]]) });
  for (let k = 1; k <= 8; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp([[cx - 120 + k * 14, cy], [cx + 120 - k * 14, cy]]) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(300);
  const info2 = await p.evaluate(() => ({ vv: window.visualViewport.scale, tf: [...document.querySelectorAll("img")].pop().style.transform }));
  console.log("7) achicar:", info2.tf, "| zoom de página:", info2.vv);
  // Deslizar a la siguiente foto
  const before = await p.innerText("body");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp([[cx + 100, cy]]) });
  for (let k = 1; k <= 5; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp([[cx + 100 - k * 40, cy]]) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(300);
  console.log("8) deslizar:", before.match(/(\d) \/ 2/)?.[0], "→", (await p.innerText("body")).match(/(\d) \/ 2/)?.[0], "| texto ayuda:", (await p.innerText("body")).includes("Pellizca o toca dos veces"));
  await p.getByRole("button", { name: "Cerrar" }).click(); await p.waitForTimeout(300);
  console.log("9) al cerrar, zoom de página:", await p.evaluate(() => window.visualViewport.scale), "| ancho:", await p.evaluate(() => document.documentElement.scrollWidth));
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
