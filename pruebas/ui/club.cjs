const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png" };
const srv = http.createServer((q, r) => { let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4333);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: "c1", role: "authenticated", exp, email: "lucia@gmail.com", amr: [{ method: "otp", timestamp: 1 }] })}.sig`;
const user = { id: "c1", email: "lucia@gmail.com", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} };
const catalog = { products: [], collections: [], banners: [], settings: { loyalty: { enabled: true } }, promoCodes: [] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); const sent = []; const calls = [];
  p.on("pageerror", (e) => console.log("ERROR EN PÁGINA:", e.message));
  await p.route("http://fake.supabase.test/**", (rt) => { const u = rt.request().url();
    if (u.includes("/auth/v1/token?grant_type=password")) { const bd = rt.request().postDataJSON(); calls.push("pass"); if (bd.password !== "clave1234") return rt.fulfill({ status: 400, json: { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" } }); return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } }); }
    if (u.includes("/auth/v1/user") && rt.request().method() === "PUT") { calls.push("updateUser"); return rt.fulfill({ json: user }); }
    if (u.includes("mark_customer_password")) { calls.push("mark"); return rt.fulfill({ status: 204, body: "" }); }
    if (u.includes("/auth/v1/otp")) { sent.push(rt.request().postDataJSON()); return rt.fulfill({ json: {} }); }
    if (u.includes("/auth/v1/verify")) { const bd = rt.request().postDataJSON(); if (bd.token !== "123456") return rt.fulfill({ status: 403, json: { code: 403, msg: "Token has expired or is invalid" } }); return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } }); }
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("register_google_customer")) return rt.fulfill({ json: { name: "Lucía Torres", email: "lucia@gmail.com", phone: "51987654321", points: 250, existing: true } });
    if (u.includes("customer_points")) return rt.fulfill({ json: 250 });
    return rt.fulfill({ json: [] }); });
  await p.goto("http://localhost:4333/"); await p.waitForTimeout(1200); await p.evaluate(() => { location.hash = "#/loyalty"; }); await p.waitForTimeout(800);
  await p.click("text=Ya tengo cuenta"); await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/club-entrar.png` });
  await p.click("text=Con contraseña"); await p.fill('input[placeholder="Tu correo *"]', "lucia@gmail.com"); await p.click("button:has-text('Entrar') >> nth=-1"); await p.waitForTimeout(200);
  console.log("0a) Sin contraseña avisa:", (await p.innerText("body")).includes("Falta la contraseña"));
  await p.fill('input[placeholder="Contraseña *"]', "mala"); await p.click("button:has-text('Entrar') >> nth=-1"); await p.waitForTimeout(500);
  console.log("0b) Contraseña mala:", (await p.innerText("body")).match(/Correo o contraseña incorrectos[^.]*\)/)?.[0]);
  await p.screenshot({ path: `${out}/club-clave.png` });
  await p.click("text=¿Olvidaste tu contraseña?"); await p.waitForTimeout(200);
  await p.click("text=Recibir código en mi correo"); await p.waitForTimeout(200);
  console.log("1) Sin correo avisa:", (await p.innerText("body")).includes("Escribe tu correo completo"));
  await p.fill('input[placeholder="Tu correo *"]', "Lucia@Gmail.com"); await p.click("text=Recibir código en mi correo"); await p.waitForTimeout(500);
  console.log("2) Pidió código para:", sent[0]?.email, "| pantalla pide código:", (await p.innerText("body")).includes("Te enviamos un código"));
  await p.fill('input[placeholder="000000"]', "111111"); await p.click("button:has-text('Entrar') >> nth=-1"); await p.waitForTimeout(500);
  console.log("3) Código malo avisa:", (await p.innerText("body")).includes("Código incorrecto"));
  await p.screenshot({ path: `${out}/club-codigo.png` });
  await p.fill('input[placeholder="000000"]', "123456"); await p.click("button:has-text('Entrar') >> nth=-1"); await p.waitForTimeout(1500);
  const t = await p.innerText("body");
  console.log("4) Entró y ve su cuenta:", t.includes("Lucía") || t.includes("Lucia"), "| puntos 250:", t.includes("250"));
  await p.click("text=Crear o cambiar mi contraseña"); await p.fill('input[placeholder="Nueva contraseña (mín. 8) *"]', "clave1234"); await p.fill('input[placeholder="Repite la contraseña *"]', "clave1235"); await p.click("text=Guardar contraseña"); await p.waitForTimeout(200);
  console.log("5) No coinciden avisa:", (await p.innerText("body")).includes("no coinciden"));
  await p.fill('input[placeholder="Repite la contraseña *"]', "clave1234"); await p.click("text=Guardar contraseña"); await p.waitForTimeout(700);
  console.log("6) Guardó contraseña:", (await p.innerText("body")).includes("La próxima vez puedes entrar"), calls.join(","));
  await p.screenshot({ path: `${out}/club-dentro.png`, fullPage: true });
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
