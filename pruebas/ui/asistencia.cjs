// Prueba de asistencia y sueldos: marcar con PIN (teclado en pantalla y lector de llavero = escribir + Enter),
// cálculo de la quincena con la regla del Excel, marca incompleta, ajuste, Excel y permisos. Uso: node pruebas/ui/asistencia.cjs <carpeta>
const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = process.env.DIST || path.join(__dirname, "dist"), out = process.argv[2] || "/tmp";
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4421);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const people = [{ id: 1, name: "Nicolle", active: true, daily_hours: 8, break_minutes: 0, base_quincena: 615, hour_rate: null, has_pin: true, tag: null }, { id: 2, name: "Gabriela", active: true, daily_hours: 4, break_minutes: 0, base_quincena: 307.5, hour_rate: null, has_pin: true, tag: "0006930684" }];
// Quincena 1–15 del mes actual en Lima: día 2 Nicolle 08:49–17:43 (+0:54), día 3 Nicolle 09:10–17:00 (−0:10), día 4 Nicolle solo entrada (incompleta), día 2 Gabriela 09:00–13:15 (+0:15)
const now = new Date(); const ym = now.toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 7);
const at = (d, hm) => new Date(`${ym}-${String(d).padStart(2, "0")}T${hm}:00-05:00`).toISOString();
let marks = [[1, 1, "entrada", at(2, "08:49")], [2, 1, "salida", at(2, "17:43")], [3, 1, "entrada", at(3, "09:10")], [4, 1, "salida", at(3, "17:00")], [5, 1, "entrada", at(4, "08:55")], [6, 2, "entrada", at(2, "09:00")], [7, 2, "salida", at(2, "13:15")]]
  .map(([id, person_id, kind, a]) => ({ id, person_id, kind, at: a, source: "pin", voided: false }));
let adjs = []; const calls = []; let role = "superadmin";
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  let ctx, p;
  const openPage = async () => {
  ctx = await b.newContext({ locale: "es-PE", viewport: { width: 1280, height: 900 }, acceptDownloads: true, timezoneId: "America/Lima" });
  await ctx.addInitScript(() => { localStorage.setItem("flyboutique:cookieconsent:v1", "none"); });
  p = await ctx.newPage(); p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => { console.log("ERROR EN PÁGINA:", e.message); ok = false; });
  p.on("dialog", (d) => d.accept());
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url(); const body = rt.request().postDataJSON?.() || {};
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: { products: [], collections: [], banners: [], settings: {}, promoCodes: [] } } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana", role, active: true } });
    if (u.includes("/rpc/att_")) calls.push([u.split("/rpc/")[1], body]);
    if (u.includes("/rpc/att_clock")) return rt.fulfill({ json: body.p_code === "4821" || body.p_code === "0006930684" ? { ok: true, id: 99, name: body.p_code === "4821" ? "Nicolle" : "Gabriela", kind: "entrada", at: new Date().toISOString(), repeat: false } : { ok: false, error: "CODIGO_INVALIDO" } });
    if (u.includes("/rpc/att_today")) return rt.fulfill({ json: [{ name: "Nicolle", kind: "entrada", at: new Date().toISOString() }] });
    if (u.includes("/rpc/att_people_list")) return rt.fulfill({ json: people });
    if (u.includes("/rpc/att_marks_range")) return rt.fulfill({ json: marks });
    if (u.includes("/rpc/att_adjustments_list")) return rt.fulfill({ json: adjs });
    if (u.includes("/rpc/att_save_adjustment")) { adjs.push({ id: 5, person_id: body.p_person, kind: body.p_kind, amount: body.p_amount, note: body.p_note }); return rt.fulfill({ json: { id: 5 } }); }
    if (u.includes("/rpc/att_add_mark")) { marks.push({ id: 50, person_id: body.p_person, kind: body.p_kind, at: body.p_at, source: "manual", voided: false }); return rt.fulfill({ json: { id: 50 } }); }
    return rt.fulfill({ json: [] });
  });
  };
  await openPage();
  const login = async () => { await p.goto("http://localhost:4421/#staff"); await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar"); await p.waitForTimeout(2200); };
  await login();
  // Marcar
  check("Botón «Marcar» arriba en el panel", (await p.locator(".tb-clock").count()) === 1);
  await p.locator(".tb-clock").click(); await p.waitForTimeout(700);
  for (const d of ["4", "8", "2", "1"]) await p.click(`.att-pad button[aria-label="${d}"]`);
  await p.click('.att-pad button[aria-label="Marcar"]'); await p.waitForTimeout(500);
  check("PIN con el teclado → «Entrada · hora — ¡Buen turno, Nicolle!»", (await p.locator(".att-result.is-ok").innerText()).includes("Nicolle") && calls.some((c) => c[0] === "att_clock" && c[1].p_code === "4821"));
  await p.keyboard.type("0006930684"); await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  check("Lector de llavero (escribe + Enter) marca a Gabriela sin tocar nada", (await p.locator(".att-result.is-ok").innerText()).includes("Gabriela"));
  await p.keyboard.type("9999"); await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  check("Código malo → aviso claro", (await p.locator(".att-result.is-err").innerText()).includes("no reconocido"));
  check("Lista «Hoy» y quién está en la tienda", (await p.locator(".att-kiosk").innerText()).includes("En la tienda ahora: Nicolle"));
  await p.screenshot({ path: `${out}/asistencia-marcar.png` });
  // Sueldos
  await p.evaluate(() => { location.hash = "#staff/sueldos"; }); await p.waitForTimeout(1200);
  if (now.getDate() > 15) { await p.click('button[aria-label="Quincena anterior"]'); await p.waitForTimeout(800); }
  const tot = await p.locator(".pay-person").allInnerTexts();
  // Nicolle: 615 + (54 − 10)/60 × 5.125 = 618.76 ; Gabriela: 307.5 + 15/60 × 5.125 = 308.78
  check("Nicolle: S/ 618.76 (54 min − 10 min al valor hora 5.125) y avisa 1 día incompleto (" + tot[0].replace(/\n/g, " ") + ")", tot[0].includes("618.76") && tot[0].includes("1 día(s) con marca incompleta"));
  check("Gabriela (4 h): S/ 308.78", tot[1].includes("308.78"));
  check("Total de la quincena S/ 927.54", (await p.locator(".q-total").innerText()).includes("927.54"));
  await p.locator(".pay-person").first().locator("button").first().click(); await p.waitForTimeout(300);
  check("Detalle por día con «falta» en la salida incompleta", (await p.locator(".pay-person.is-open").innerText()).includes("falta"));
  // Ajuste: ausencia de 1 día (8 h × 5.125 = 41.00)
  await p.locator(".pay-person.is-open button", { hasText: "1 día =" }).click();
  await p.locator(".pay-person.is-open button", { hasText: "Agregar" }).click(); await p.waitForTimeout(700);
  check("Ausencia de 1 día resta S/ 41.00 → S/ 577.76", (await p.locator(".pay-person").first().innerText()).includes("577.76"));
  // Marca olvidada
  await p.locator(".pay-person.is-open button", { hasText: "+ marca" }).nth(3).click(); await p.waitForTimeout(300);
  await p.fill('input[aria-label="Hora de la marca"]', "17:55"); await p.fill('input[aria-label="Motivo"]', "olvidó marcar");
  await p.click("button:has-text('Guardar marca')"); await p.waitForTimeout(800);
  check("Marca olvidada se guarda con motivo (salida)", calls.some((c) => c[0] === "att_add_mark" && c[1].p_kind === "salida" && c[1].p_note === "olvidó marcar"));
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("button:has-text('Descargar Excel')")]);
  check("Descarga el Excel de la quincena", /sueldos-quincena-.*\.xlsx/.test(dl.suggestedFilename()));
  await p.screenshot({ path: `${out}/asistencia-sueldos.png`, fullPage: true });
  // Cajero: marca, pero no ve sueldos
  role = "cajero"; await ctx.close(); await openPage(); await login();
  await p.evaluate(() => { location.hash = "#staff/sueldos"; }); await p.waitForTimeout(900);
  check("Cajero no abre «Asistencia y sueldos»", !(await p.innerText("body")).includes("Asistencia y sueldos"));
  await p.locator(".tb-clock").click(); await p.waitForTimeout(600);
  check("Cajero sí puede abrir «Marcar asistencia»", (await p.locator(".att-kiosk").count()) === 1);
  console.log(ok ? "TODO OK" : "HAY FALLAS");
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
