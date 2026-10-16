// Prueba: al eliminar una prenda no «vuelve a aparecer» si la recarga automática llega mientras se guarda,
// y «Duplicar» crea la copia sin código de barras ni stock. Uso: node pruebas/ui/borrar.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4415);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name) => ({ id, name, slug: id, category: "Blusas", price: 99, status: "active", showOnline: true, images: [], variants: [{ id: id + "S", size: "S", colorName: "Negro", colorHex: "#111", stock: 4, sku: id.toUpperCase() + "-S", barcode: "775" + id }] });
// Lo que tiene el servidor: cambia solo cuando termina save_catalog (que tarda 2,5 s)
let server = { products: [mk("pa", "Blusa Amanda"), mk("pb", "Falda Bruna")], collections: [], banners: [], settings: {}, promoCodes: [] };
const saves = [];
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 1280, height: 900 } });
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
    if (u.includes("/rpc/save_catalog")) {
      const bd = rt.request().postDataJSON(); saves.push(bd);
      await new Promise((r) => setTimeout(r, 2500));
      server = { ...server, products: bd.p_data.products };
      return rt.fulfill({ json: null });
    }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4415/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2200);
  await p.evaluate(() => { location.hash = "#staff/products"; }); await p.waitForTimeout(900);
  const names = () => p.evaluate(() => document.body.innerText);
  check("Lista con las dos prendas", (await names()).includes("Blusa Amanda") && (await names()).includes("Falda Bruna"));
  // Eliminar «Blusa Amanda» y, mientras se guarda, la ventana vuelve a tener el foco (recarga automática)
  const card = p.locator("div", { has: p.locator("text=Blusa Amanda") }).filter({ has: p.locator('button[aria-label="Eliminar"]') }).last();
  await card.locator('button[aria-label="Eliminar"]').click();
  await p.waitForTimeout(200);
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForTimeout(1200);
  check("Mientras se guarda, la prenda eliminada NO vuelve a aparecer", !(await names()).includes("Blusa Amanda"));
  await p.waitForTimeout(2000);
  check("El servidor recibió la eliminación", saves.length === 1 && (saves[0].p_deleted || []).includes("pa"));
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForTimeout(800);
  check("Después de guardar y recargar sigue eliminada", !(await names()).includes("Blusa Amanda") && (await names()).includes("Falda Bruna"));
  // Duplicar «Falda Bruna»
  await p.click('button[title="Duplicar"]');
  await p.waitForTimeout(400);
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForTimeout(800);
  check("La copia aparece en la lista (y no desaparece con la recarga)", (await names()).includes("Falda Bruna (copia)"));
  await p.waitForTimeout(2500);
  const copy = (saves[1]?.p_data?.products || []).find((x) => x.name === "Falda Bruna (copia)");
  check("La copia queda en borrador, sin código de barras y sin stock", !!copy && copy.status === "borrador" && copy.variants.every((v) => !v.barcode && Number(v.stock) === 0 && v.id !== "pbS"));
  const orig = (saves[1]?.p_data?.products || []).find((x) => x.id === "pb");
  check("La original conserva su código y stock", orig?.variants[0].barcode === "775pb" && orig?.variants[0].stock === 4);
  await p.screenshot({ path: `${out}/borrar.png` });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
