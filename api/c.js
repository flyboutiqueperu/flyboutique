// Página de categoría (/catalogo/<categoría>), del catálogo completo (/catalogo) o del Outlet (/outlet) con su título,
// descripción y foto dentro del HTML: así Google la indexa con su nombre y WhatsApp/Facebook muestran una vista previa.
// Si algo falla, se sirve la tienda normal (la app dibuja la categoría igual).
import { loadPublicCatalog, webProducts, esc, originOf, SITE_NAME } from "./_store.js";

const firstImage = (p) => (p.images || []).find((m) => m && m.type !== "video" && typeof m.url === "string" && m.url.startsWith("http"))?.url || "";
const inStock = (p) => (p.variants || []).some((v) => Number(v.stock) > 0);

// cat: nombre de la categoría, "" = todo el catálogo, "outlet" = sección Outlet
export function injectListMeta(html, data, cat, url) {
  const all = webProducts(data);
  const isOutlet = cat === "outlet";
  const list = isOutlet ? all.filter((p) => p.outlet) : all.filter((p) => !p.outlet && (!cat || String(p.category || "").toLowerCase() === cat.toLowerCase()));
  if (!list.length && cat) return html; // categoría inexistente o vacía: la tienda normal
  const label = isOutlet ? "Outlet" : cat || "Catálogo";
  const realCat = !isOutlet && cat ? (list[0]?.category || cat) : label;
  const available = list.filter(inStock);
  const priced = available.length ? available : list;
  const min = priced.length ? Math.min(...priced.map((p) => Number(p.price) || 0)) : 0;
  const title = `${realCat} · ${SITE_NAME}`;
  const desc = (isOutlet
    ? `Outlet de ${SITE_NAME}: últimas unidades a precio final. ${available.length} prendas disponibles${min ? ` desde S/ ${min.toFixed(2)}` : ""}.`
    : `${realCat} en ${SITE_NAME}: ${available.length} prendas disponibles${min ? ` desde S/ ${min.toFixed(2)}` : ""}. Envíos a todo el Perú.`).slice(0, 160);
  const img = (available.find(firstImage) || list.find(firstImage)) ? firstImage(available.find(firstImage) || list.find(firstImage)) : "";
  const origin = url.replace(/^(https?:\/\/[^/]+).*$/, "$1");
  const ld = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: title, description: desc, url,
    mainEntity: { "@type": "ItemList", numberOfItems: list.length, itemListElement: list.slice(0, 30).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${origin}/p/${encodeURIComponent(p.id)}`, name: p.name })) },
  };
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    img ? `<meta property="og:image" content="${esc(img)}" />` : "",
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].filter(Boolean).join("\n    ");
  return html
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta name="description"[^>]*>/, "")
    .replace(/<meta property="og:(title|description|type|image|url)"[^>]*>/g, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}

export default async function handler(req, res) {
  const cat = String(req.query?.cat || "");
  const origin = originOf(req);
  const path = cat === "outlet" ? "/outlet" : cat ? `/catalogo/${encodeURIComponent(cat)}` : "/catalogo";
  let html;
  try {
    const r = await fetch(`${origin}/index.html`);
    html = await r.text();
  } catch (e) {
    res.statusCode = 302; res.setHeader("Location", cat === "outlet" ? "/#/outlet" : `/#${path}`); res.end(); return;
  }
  try {
    const data = await loadPublicCatalog();
    if (data) html = injectListMeta(html, data, cat, `${origin}${path}`);
  } catch (e) { /* se sirve la tienda sin datos extra */ }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.end(html);
}
