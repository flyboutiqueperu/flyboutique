// Prueba del aviso de cookies: tamaño legible en PC, tablet y celular; traducido; los botones guardan la elección. Uso: node pruebas/ui/cookies.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4387);
const catalog = { products: [], collections: [], banners: [], settings: {}, promoCodes: [] };
let ok = true; const check = (txt, v) => { console.log(v ? "OK " : "FALLA", txt); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [name, vp] of [["pc", { viewport: { width: 1440, height: 900 } }], ["laptop", { viewport: { width: 1280, height: 760 } }], ["tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }], ["movil", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext({ locale: "es-PE", ...vp });
    const p = await ctx.newPage(); p.setDefaultTimeout(5000);
    p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
    await p.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
    await p.goto("http://localhost:4387/"); await p.waitForSelector(".cookie-box", { timeout: 8000 }); await p.waitForTimeout(500);
    const m = await p.evaluate(() => { const box = document.querySelector(".cookie-box").getBoundingClientRect(); const fs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize); return { w: Math.round(box.width), right: Math.round(box.right), bottom: Math.round(box.bottom), text: fs(".cookie-text"), btn: fs(".cookie-btn"), title: fs(".cookie-title"), btnH: Math.round(document.querySelector(".cookie-btn").getBoundingClientRect().height), left: Math.round(box.left), sameRow: document.querySelector(".cookie-btn").getBoundingClientRect().top < document.querySelector(".cookie-text").getBoundingClientRect().bottom, vw: innerWidth, vh: innerHeight }; });
    console.log(`  [${name}]`, JSON.stringify(m));
    if (name === "pc" || name === "laptop") { const mg = Math.max(32, (m.vw - 1240) / 2); check(`${name}: franja a lo ancho con márgenes iguales (izq ${m.left}, der ${m.vw - m.right})`, Math.abs(m.left - mg) <= 1 && Math.abs(m.vw - m.right - mg) <= 1 && m.w >= m.vw - 2 * mg - 2); check(`${name}: letra legible y botones al lado del texto`, m.text >= 14 && m.btn >= 14 && m.title >= 18 && m.btnH >= 44 && m.sameRow); }
    else check(`${name}: ocupa el ancho y no se sale`, m.w === m.vw && m.bottom <= m.vh && m.text >= (name === "tablet" ? 13.5 : 11.5) && m.btnH >= 40);
    await p.screenshot({ path: `${out}/cookies-${name}.png` });
    await p.click("text=Configurar"); await p.waitForTimeout(300);
    check(`${name}: «Configurar» muestra las 3 opciones`, (await p.innerText(".cookie-box")).includes("Estadísticas") && (await p.innerText(".cookie-box")).includes("Marketing"));
    await p.screenshot({ path: `${out}/cookies-${name}-config.png` });
    await p.click("text=Solo necesarias"); await p.waitForTimeout(300);
    check(`${name}: se cierra y guarda`, (await p.locator(".cookie-box").count()) === 0 && (await p.evaluate(() => localStorage.getItem("flyboutique:cookieconsent:v1"))) !== null);
    if (name === "movil") {
      await p.evaluate(() => { localStorage.removeItem("flyboutique:cookieconsent:v1"); localStorage.setItem("flyboutique:idioma:v1", "en"); });
      await p.reload(); await p.waitForSelector(".cookie-box", { timeout: 8000 });
      const t = await p.innerText(".cookie-box");
      check("en inglés: sin texto en español", t.includes("We use necessary cookies") && !/Usamos|Configurar|Aceptar/.test(t));
    }
    await ctx.close();
  }
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
