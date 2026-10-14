// Mapa del sitio para Google: inicio, catálogo, categorías, Outlet (si está abierto) y cada prenda publicada.
import { loadPublicCatalog, webProducts, esc, originOf } from "./_store.js";

export function buildSitemap(origin, data) {
  const prods = webProducts(data);
  const cats = [...new Set(prods.filter((p) => !p.outlet).map((p) => p.category).filter(Boolean))];
  const urls = [
    `${origin}/`, `${origin}/catalogo`,
    ...cats.map((c) => `${origin}/catalogo/${encodeURIComponent(c)}`),
    ...(prods.some((p) => p.outlet) ? [`${origin}/outlet`] : []),
    ...prods.map((p) => `${origin}/p/${encodeURIComponent(p.id)}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

export default async function handler(req, res) {
  let data = null;
  try { data = await loadPublicCatalog(); } catch (e) { /* mapa mínimo */ }
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(buildSitemap(originOf(req), data));
}
