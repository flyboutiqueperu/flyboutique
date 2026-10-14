// Ficha de producto con su título, descripción, foto y precio dentro del HTML:
// así Google la indexa y WhatsApp/Facebook muestran la vista previa. Si algo falla, se sirve la tienda normal.
import { loadPublicCatalog, webProducts, esc, originOf, SITE_NAME } from "./_store.js";

const firstImage = (p) => (p.images || []).find((m) => m && m.type !== "video" && typeof m.url === "string" && m.url.startsWith("http"))?.url || "";

export function injectProductMeta(html, p, url) {
  const title = `${p.name} · ${SITE_NAME}`;
  const desc = (p.description || `${p.name} en ${SITE_NAME}. ${p.category || "Moda"} · S/ ${Number(p.price).toFixed(2)}.`).replace(/\s+/g, " ").slice(0, 160);
  const img = firstImage(p);
  const inStock = (p.variants || []).some((v) => Number(v.stock) > 0);
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: desc, category: p.category || undefined,
    image: img ? [img] : undefined, sku: p.variants?.[0]?.sku || p.id, brand: { "@type": "Brand", name: "Fly Boutique" },
    offers: { "@type": "Offer", url, priceCurrency: "PEN", price: Number(p.price).toFixed(2), availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", itemCondition: "https://schema.org/NewCondition" },
  };
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="product" />`,
    `<meta property="og:title" content="${esc(p.name)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    img ? `<meta property="og:image" content="${esc(img)}" />` : "",
    `<meta property="product:price:amount" content="${Number(p.price).toFixed(2)}" />`,
    `<meta property="product:price:currency" content="PEN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].filter(Boolean).join("\n    ");
  return html
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta name="description"[^>]*>/, "")
    .replace(/<meta property="og:(title|description|type|image)"[^>]*>/g, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}

export default async function handler(req, res) {
  const id = String(req.query?.id || "");
  const origin = originOf(req);
  let html;
  try {
    const r = await fetch(`${origin}/index.html`);
    html = await r.text();
  } catch (e) {
    res.statusCode = 302; res.setHeader("Location", `/#/p/${encodeURIComponent(id)}`); res.end(); return;
  }
  try {
    const data = await loadPublicCatalog();
    const p = webProducts(data).find((x) => x.id === id);
    if (p) html = injectProductMeta(html, p, `${origin}/p/${encodeURIComponent(id)}`);
  } catch (e) { /* se sirve la tienda sin datos extra */ }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.end(html);
}
