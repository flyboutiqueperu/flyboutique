// Prueba: importar el Excel de TumiSoft (títulos en la fila 2) y subir fotos en lote por código / nombre+color. Uso: node pruebas/ui/importar.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); r.end(fs.readFileSync(f)); }).listen(4398);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const catalog = { products: [], collections: [], banners: [], settings: {}, promoCodes: [] };
const saves = [], ups = [];
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
// Excel como el de TumiSoft: fila 1 con títulos de grupo, fila 2 con los encabezados
const H = ["#", "NOMBRE", "PRECIO DE VENTA", "PRECIO DE COSTO", "UND. MEDIDA", "C. INTERNO", "C. BARRAS", "ACTUALIZACIÓN", "ESTADO", "GRUPO DE UM", "CATEGORIAS", "LISTA 0"];
const data = [["", "", "", "", "", "", "", "", "", "", "CATEGORÍAS", "LISTAS DE PRECIOS"], H,
  [1, "90S LOW RISE JEANS AZUL 34", 149, 0, "NIU", "90LRJA34", "90LRJA340003691366", "", "Activo", "", "PANTALONES", 149],
  [2, "90S LOW RISE JEANS CELESTE 28", 149, 0, "NIU", "9LRJC28", "9LRJC280003690856", "", "Activo", "", "PANTALONES", 149],
  [3, "ALDANA DRESS NEGRO M", 149, 60, "NIU", "ALDRNEM", "ALDRNEMO03692231", "", "Activo", "", "VESTIDOS", 149],
  [4, "ALDANA DRESS PERLA S", 149, 60, "NIU", "ALDRPES", "ALDRPESO03692236", "", "Activo", "", "VESTIDOS", 149],
  [5, "ALYSA TOP BURGUNDY M", "71,2", 0, "NIU", "ALTOBUM", "ALTOBUM000369162", "", "Activo", "", "TOPS", "71,2"]];
const xlsxPath = path.join(out, "tumisoft-prueba.xlsx");
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Worksheet"); XLSX.writeFile(wb, xlsxPath);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAAGwABAF8hY2AAAAAASUVORK5CYII=", "base64");
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("/storage/v1/object/productos/")) { ups.push(u.split("/productos/")[1]); return rt.fulfill({ json: { Key: "productos/x" } }); }
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role: "superadmin", active: true } });
    if (u.includes("/rpc/save_catalog")) { saves.push(rt.request().postDataJSON()); return rt.fulfill({ status: 204, body: "" }); }
    if (u.includes("/rest/v1/product_costs")) { if (rt.request().method() === "POST") saves.push({ cost: rt.request().postDataJSON() }); return rt.fulfill({ status: 201, json: [] }); }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4398/#staff");
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2200);
  await p.goto("http://localhost:4398/#staff/products"); await p.waitForTimeout(1500);
  await p.setInputFiles('input[type=file][accept=".xlsx,.xls,.csv"]', xlsxPath); await p.waitForTimeout(2500);
  const conf = dialogs.find((d) => d.startsWith("Excel de TumiSoft")) || "";
  console.log("  vista previa:", conf.split("\n").slice(0, 6).join(" / "));
  check("reconoce el Excel de TumiSoft y muestra vista previa", conf.includes("5 filas → 3 prendas") && conf.includes("ALDANA DRESS NEGRO M → Aldana Dress · Negro · M"));
  let t = await p.evaluate(() => [...document.querySelectorAll(".app-content")].pop().innerText);
  check("crea las prendas agrupadas", t.includes("90S Low Rise Jeans") && t.includes("Aldana Dress") && t.includes("Alysa Top") && t.includes("3 prendas"));
  const last = JSON.stringify(saves.filter((x) => !x.cost));
  check("se guardan con códigos interno y de barras", last.includes("9LRJC28") && last.includes("ALDRNEMO03692231"));
  check("guarda el costo (privado)", JSON.stringify(saves.filter((x) => x.cost)).includes("60"));
  // Fotos: por código interno, por código con orden y por nombre + color
  await p.setInputFiles('input[type=file][accept="image/*"][multiple]', [
    { name: "ALDANA DRESS NEGRO 2.png", mimeType: "image/png", buffer: PNG },
    { name: "ALDRNEM.png", mimeType: "image/png", buffer: PNG },
    { name: "9LRJC28.png", mimeType: "image/png", buffer: PNG },
    { name: "foto-sin-codigo.png", mimeType: "image/png", buffer: PNG }]);
  await p.waitForTimeout(3500);
  const msg = dialogs.find((d) => /foto\(s\) asignadas/.test(d)) || "";
  console.log("  fotos:", msg.replace(/\n/g, " / "));
  check("asigna 3 fotos y avisa la que no coincide", msg.startsWith("3 foto(s) asignadas") && msg.includes("3 con su color") && msg.includes("foto-sin-codigo.png"));
  const final = saves.filter((x) => !x.cost).pop() || {};
  const prods = JSON.stringify(final);
  check("las fotos quedan con su color (Negro / Celeste)", prods.includes('"colorName":"Negro"') && prods.includes('"colorName":"Celeste"'));
  await p.screenshot({ path: `${out}/importar.png` });
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})();
