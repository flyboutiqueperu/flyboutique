const { chromium } = require("playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const dist = path.join(__dirname, "dist"), out = process.argv[2];
const types = { ".js": "text/javascript", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { if (q.url.startsWith("/img/")) { r.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*" }); return r.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800"><rect width="1400" height="1800" fill="#8a3b12"/></svg>`); } let f = path.join(dist, q.url.split("?")[0].split("#")[0]); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html"); r.writeHead(200, { "content-type": types[path.extname(f)] || "text/html" }); r.end(fs.readFileSync(f)); }).listen(4357);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const role = process.argv[3] || "administrador";
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", aal: "aal2", role: "authenticated", exp, email: "ana@staff.flyboutique.pe", amr: [{ method: "totp", timestamp: 1 }] })}.sig`;
const user = { id: "u1", email: "ana@staff.flyboutique.pe", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, factors: [{ id: "f1", factor_type: "totp", status: "verified" }] };
const mk = (id, name, price, sizes) => ({ id, name, slug: id, category: "Blusas", price, status: "active", showOnline: true, images: [], variants: sizes.map((s, i) => ({ id: id + s, size: s, colorName: "Negro", colorHex: "#111", stock: 3 + i, sku: (id + "-" + s).toUpperCase() })) });
const catalog0 = { products: [mk("p1", "Blusa Seda Marfil", 129, ["XS", "S", "M", "L"]), mk("p2", "Pantalón Sastre", 189, ["S", "M"]), mk("p3", "Vestido Midi", 219, ["M"]), mk("p4", "Top Lino", 79, ["S"])], collections: [], banners: [], settings: { cartHoldMinutes: 20 }, promoCodes: [] };

const IMG = "http://localhost:4357/img/a.svg";
catalog0.products[0].images = [{ id: "i1", url: IMG }, { id: "i2", url: IMG.replace("a.svg", "b.svg"), thumb: "http://localhost:4357/img/b-t.svg" }];
const catalog = catalog0; const saves = []; const ups = [];
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ locale: "es-PE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("flyboutique:cookieconsent:v1", "none"));
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("ERROR:", e.message));
  await p.route("http://fake.supabase.test/**", async (rt) => {
    const u = rt.request().url();
    if (u.includes("/auth/v1/token")) return rt.fulfill({ json: { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user } });
    if (u.includes("/auth/v1/user")) return rt.fulfill({ json: user });
    if (u.includes("/auth/v1/")) return rt.fulfill({ json: {} });
    if (u.includes("/storage/v1/object/productos/")) { ups.push(u.split("/productos/")[1]); return rt.fulfill({ json: { Key: "productos/x" } }); }
    if (u.includes("store_data")) return rt.fulfill({ json: { data: catalog } });
    if (u.includes("staff_profiles")) return rt.fulfill({ json: { user_id: "u1", username: "ana", name: "Ana Admin", role, active: true } });
    if (u.includes("/rpc/save_catalog")) { saves.push(rt.request().postDataJSON()); return rt.fulfill({ status: 204, body: "" }); }
    return rt.fulfill({ json: [] });
  });
  await p.goto("http://localhost:4357/staff/products");
  await p.waitForSelector('input[placeholder="Usuario"]');
  await p.fill('input[placeholder="Usuario"]', "ana"); await p.fill('input[placeholder="Contraseña"]', "clave1234"); await p.click("text=Entrar");
  await p.waitForTimeout(2500);
  let t = await p.innerText("body");
  console.log("1) aviso:", t.match(/\d+ foto\(s\) sin versión liviana/)?.[0]);
  await p.click("text=Optimizar fotos"); await p.waitForTimeout(2500);
  t = await p.innerText("body");
  console.log("2) resultado:", t.match(/Listo:[^\n]*/)?.[0], "| subidas:", ups.length);
  const sv = saves[saves.length - 1];
  const imgs = sv?.p_data?.products?.find((x) => x.id === "p1")?.images;
  console.log("3) guardado:", JSON.stringify(imgs?.map((m) => ({ url: m.url.split("/").pop(), thumb: m.thumb ? "sí" : "no" }))), "| solo cambió:", JSON.stringify(sv?.p_changed));
  // Tienda: la tarjeta usa la miniatura
  const p2 = await ctx.newPage();
  catalog.products[0].images[0].thumb = "http://localhost:4357/img/a-t.svg";
  await p2.route("http://fake.supabase.test/**", (rt) => rt.request().url().includes("store_data") ? rt.fulfill({ json: { data: catalog } }) : rt.fulfill({ json: [] }));
  await p2.goto("http://localhost:4357/catalogo"); await p2.waitForTimeout(1500);
  const srcs = await p2.$$eval("img", (xs) => xs.map((x) => x.getAttribute("src")).filter(Boolean));
  console.log("4) imágenes en catálogo:", JSON.stringify(srcs.map((x) => x.split("/").pop()).slice(0, 4)));
  await b.close(); srv.close();
})().catch((e) => { console.log("FALLO:", e.message); process.exit(1); });
