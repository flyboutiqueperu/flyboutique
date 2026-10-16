// Prueba de las páginas para Google/WhatsApp: categoría, catálogo y Outlet (api/c.js), sin Vercel ni Supabase. Uso: node pruebas/seo.test.mjs
import { injectListMeta } from "../api/c.js";
import handler from "../api/c.js";
import { buildSitemap } from "../api/sitemap.js";
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Fly Boutique Perú</title><meta name="description" content="general" /><meta property="og:title" content="Fly" /><meta property="og:image" content="x.png" /></head><body><div id="root"></div></body></html>`;
const img = (u) => [{ url: u }];
const data = { settings: {}, products: [
  { id: "v1", name: "Vestido Aldana", category: "Vestidos", price: 159, status: "active", images: img("https://cdn.x/v1.jpg"), variants: [{ stock: 2, sku: "V1" }] },
  { id: "v2", name: "Vestido <Luna>", category: "Vestidos", price: 129.9, status: "active", images: [], variants: [{ stock: 0 }] },
  { id: "b1", name: "Blusa Seda", category: "Blusas", price: 89, status: "active", images: img("https://cdn.x/b1.jpg"), variants: [{ stock: 1 }] },
  { id: "o1", name: "Falda Outlet", category: "Faldas", price: 39, status: "active", outlet: true, images: img("https://cdn.x/o1.jpg"), variants: [{ stock: 1 }] },
  { id: "d1", name: "Borrador", category: "Vestidos", price: 10, status: "borrador", images: [], variants: [{ stock: 5 }] },
] };
let h = injectListMeta(html, data, "vestidos", "https://flyboutique.vercel.app/catalogo/Vestidos");
check("Categoría: título con el nombre real («Vestidos · Fly Boutique Perú»)", h.includes("<title>Vestidos · Fly Boutique Perú</title>") && (h.match(/<title>/g) || []).length === 1);
check("Categoría: descripción con prendas disponibles y precio desde", h.includes("1 prendas disponibles desde S/ 159.00") && !h.includes('content="general"'));
check("Categoría: foto de una prenda con stock y canonical", h.includes('og:image" content="https://cdn.x/v1.jpg"') && h.includes('rel="canonical" href="https://flyboutique.vercel.app/catalogo/Vestidos"'));
check("Categoría: lista para Google sin borradores ni Outlet, texto escapado", h.includes('"numberOfItems":2') && !h.includes("Borrador") && !h.includes("Falda Outlet") && h.includes("Vestido \\u003cLuna>"));
h = injectListMeta(html, data, "outlet", "https://flyboutique.vercel.app/outlet");
check("Outlet: título y solo prendas Outlet", h.includes("<title>Outlet · Fly Boutique Perú</title>") && h.includes("Falda Outlet") && !h.includes("Vestido Aldana"));
h = injectListMeta(html, { ...data, settings: { outletEnabled: false } }, "outlet", "https://flyboutique.vercel.app/outlet");
check("Outlet cerrado: se sirve la tienda normal", h === html);
h = injectListMeta(html, data, "Zapatillas", "https://flyboutique.vercel.app/catalogo/Zapatillas");
check("Categoría que no existe: tienda normal (no inventa)", h === html);
h = injectListMeta(html, data, "", "https://flyboutique.vercel.app/catalogo");
check("Catálogo completo: «Catálogo · Fly Boutique Perú»", h.includes("<title>Catálogo · Fly Boutique Perú</title>") && h.includes('"numberOfItems":3'));
// handler: si falla la tienda, redirige; si falla Supabase, sirve la tienda igual
const mkRes = () => { const r = { headers: {}, statusCode: 200, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ""; } }; return r; };
globalThis.fetch = async (u) => { if (String(u).endsWith("/index.html")) return { text: async () => html }; throw new Error("sin red"); };
let res = mkRes(); await handler({ query: { cat: "Vestidos" }, headers: { host: "flyboutique.vercel.app" } }, res);
check("Sin Supabase: igual sirve la tienda (200, HTML)", res.statusCode === 200 && res.body === html && res.headers["Content-Type"].includes("text/html"));
globalThis.fetch = async () => { throw new Error("caído"); };
res = mkRes(); await handler({ query: { cat: "outlet" }, headers: { host: "flyboutique.vercel.app" } }, res);
check("Sin la tienda: redirige al Outlet de la app", res.statusCode === 302 && res.headers.Location === "/#/outlet");
check("Sitemap sigue con categorías y Outlet", (() => { const s = buildSitemap("https://f.app", data); return s.includes("/catalogo/Vestidos") && s.includes("/outlet") && !s.includes("/p/d1"); })());
console.log(ok ? "TODO OK" : "HAY FALLAS");
process.exit(ok ? 0 : 1);
