// Importar el listado de productos que descarga TumiSoft (Excel «Listado de productos»).
// Cada fila de TumiSoft es UNA combinación: el nombre trae la prenda, el color y la talla juntos
// («90S LOW RISE JEANS AZUL 34», «ALDANA DRESS NEGRO M», «ALMIRA TOP ACERO STANDARD»).
// Aquí se separan y se agrupan las filas en prendas con sus combinaciones (talla × color).
// Funciones puras (sin React ni Supabase) para poder probarlas: node pruebas/importar.test.mjs

const sinAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const keyOf = (s) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

// Encabezados de TumiSoft → nombres internos
const HEADERS = {
  NOMBRE: "nombre", "PRECIO DE VENTA": "precio", "PRECIO DE COSTO": "costo", "UND MEDIDA": "unidad", "C INTERNO": "interno",
  "C BARRAS": "barras", ACTUALIZACION: "actualizacion", ESTADO: "estado", CATEGORIAS: "categoria", "LISTA 0": "lista0", STOCK: "stock",
  "STOCK ACTUAL": "stock", EXISTENCIA: "stock", EXISTENCIAS: "stock", SALDO: "stock", CANTIDAD: "stock", "STOCK TOTAL": "stock",
};
export const isTumiSoft = (headers) => { const k = headers.map(keyOf); return k.includes("NOMBRE") && (k.includes("C INTERNO") || k.includes("C BARRAS")); };

// Tallas que pueden ir al final del nombre
const SIZES = new Set(["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "STANDARD", "ESTANDAR", "STD", "UNICA", "UNICO", "U", "TU", "A", "B", "C", "D", "DD"]);
const isSize = (w) => SIZES.has(w) || /^(2[0-9]|3[0-9]|4[0-8])$/.test(w) || /^\d{1,2}[/-]\d{1,2}$/.test(w);
const sizeLabel = (w) => (["STANDARD", "ESTANDAR", "STD", "UNICA", "UNICO", "U", "TU"].includes(w) ? "Única" : w);

// Colores (español e inglés) con un tono aproximado para el puntito de color
export const COLOR_HEX = {
  NEGRO: "#111111", BLACK: "#111111", BLANCO: "#FFFFFF", WHITE: "#FFFFFF", "OFF WHITE": "#F5F1E8", HUESO: "#EEE7DA", CREMA: "#F3E9D2", IVORY: "#F4EFE2", MARFIL: "#F4EFE2",
  BEIGE: "#D9C7A7", NUDE: "#E3C3A8", CAMEL: "#B98B57", ARENA: "#D8C3A0", TOPO: "#8B7D72", TAUPE: "#8B7D72", MARRON: "#6B4A35", CAFE: "#6B4A35", CHOCOLATE: "#4E3426", BROWN: "#6B4A35",
  GRIS: "#9A9A9A", GREY: "#9A9A9A", GRAY: "#9A9A9A", PLOMO: "#7D7D7D", ACERO: "#7B8794", HUMO: "#8C8C8C", PERLA: "#E9E4DA", PEARL: "#E9E4DA", PLATA: "#C0C0C0", PLATEADO: "#C0C0C0", SILVER: "#C0C0C0",
  DORADO: "#C9A54A", GOLD: "#C9A54A", AZUL: "#2A4B8D", BLUE: "#2A4B8D", MARINO: "#1C2A48", NAVY: "#1C2A48", CELESTE: "#9CC3E6", JEAN: "#4A6A93", DENIM: "#4A6A93", INDIGO: "#3F3D8A",
  VERDE: "#3E7B4F", GREEN: "#3E7B4F", VERDOSO: "#8A9A7B", OLIVA: "#6B6B3A", OLIVE: "#6B6B3A", MILITAR: "#5B5E3C", MENTA: "#A8DCC6", JADE: "#3E9A7B", AGUA: "#7FD1C7",
  ROJO: "#B3261E", RED: "#B3261E", VINO: "#6D1F2A", WINE: "#6D1F2A", BURGUNDY: "#6A1B2D", GUINDA: "#6A1B2D", CORAL: "#F08A70", ROSADO: "#F2A7B8", ROSA: "#F2A7B8", PINK: "#F2A7B8",
  FUCSIA: "#D63384", LILA: "#B9A1D6", MORADO: "#6A3D8F", LAVANDA: "#C8B8E6", AMARILLO: "#F2D33A", YELLOW: "#F2D33A", MAIZ: "#F2D16B", MOSTAZA: "#C99A2E", NARANJA: "#EE7E2D",
  DURAZNO: "#F6B98F", MELON: "#F4A582", TERRACOTA: "#B5583A", LADRILLO: "#A0462E", TURQUESA: "#2BB3B1", MULTICOLOR: "#BBBBBB", ESTAMPADO: "#BBBBBB", PRINT: "#BBBBBB", ANIMAL: "#9C7A4F",
};
const isColorWord = (w) => Object.prototype.hasOwnProperty.call(COLOR_HEX, w) || ["CLARO", "OSCURO", "BEBE", "PALO", "VIEJO", "NEON"].includes(w);
const titleWord = (w) => (/\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
export const titleCase = (s) => String(s || "").trim().split(/\s+/).map(titleWord).join(" ");

// «90S LOW RISE JEANS AZUL 34» → { base: "90S LOW RISE JEANS", color: "AZUL", size: "34" }
export function splitName(nombre) {
  const words = keyOf(nombre).split(" ").filter(Boolean);
  let size = null, color = null;
  if (words.length > 1 && isSize(words[words.length - 1])) size = sizeLabel(words.pop());
  const cw = [];
  while (words.length > 1 && isColorWord(words[words.length - 1]) && cw.length < 3) cw.unshift(words.pop());
  if (cw.length && !Object.prototype.hasOwnProperty.call(COLOR_HEX, cw[0]) && words.length) { /* «PALO ROSA» etc. */ }
  if (cw.length) color = cw.join(" ");
  return { base: words.join(" "), color, size };
}
const num = (v) => { if (typeof v === "number") return v; const s = String(v ?? "").trim().replace(/\s/g, ""); if (!s) return NaN; return Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "")); };
const colorHexOf = (color) => { if (!color) return "#948C7E"; const ws = color.split(" "); for (const w of ws) if (COLOR_HEX[w]) return COLOR_HEX[w]; return "#948C7E"; };

// Categoría de TumiSoft → categoría de la tienda (las que no se conocen quedan con su nombre en formato título)
export const CATEGORY_MAP = { PANTALONES: "Pantalones", PANTALON: "Pantalones", JEANS: "Jeans", VESTIDOS: "Vestidos", VESTIDO: "Vestidos", FALDAS: "Faldas", FALDA: "Faldas", BLUSAS: "Blusas", BLUSA: "Blusas",
  TOPS: "Tops", TOP: "Tops", POLOS: "Tops", ACCESORIOS: "Accesorios", ACCESORIO: "Accesorios", JOYERIA: "Joyería", BISUTERIA: "Joyería", CALZADO: "Calzado", ZAPATOS: "Calzado", ABRIGOS: "Abrigos",
  CASACAS: "Abrigos", CHAQUETAS: "Abrigos", SHORTS: "Shorts", ENTERIZOS: "Enterizos", BODIES: "Bodies", BODYS: "Bodies", "TEEN LIFE": "Teen Life", CARTERAS: "Carteras", BOLSOS: "Carteras", BELLEZA: "Belleza", MAQUILLAJE: "Belleza" };
export const mapCategory = (c) => { const k = keyOf(c); return CATEGORY_MAP[k] || (k ? titleCase(k) : "Accesorios"); };

/**
 * rows: filas del Excel (objetos con los encabezados originales).
 * existing: productos actuales del catálogo (para actualizar en vez de duplicar).
 * Devuelve { products (nuevos y actualizados, con variantes), costs [{productId, cost}], summary, samples }.
 * No cambia el stock de combinaciones que ya existen (salvo que el archivo traiga una columna de stock).
 */
export function parseTumiSoft(rows, existing = [], { genId = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`, slugify = (s) => keyOf(s).toLowerCase().replace(/ /g, "-") } = {}) {
  const norm = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [HEADERS[keyOf(k)] || keyOf(k).toLowerCase(), v])));
  const byCode = new Map(); // código interno o de barras → { product, variant }
  existing.forEach((p) => (p.variants || []).forEach((v) => { [v.sku, v.barcode].filter(Boolean).forEach((c) => byCode.set(keyOf(c), { p, v })); }));
  const bySlug = new Map(existing.map((p) => [p.slug || slugify(p.name), p]));
  const out = new Map(); // slug → producto resultante
  const costs = new Map();
  const summary = { filas: 0, ignoradas: 0, nuevas: 0, actualizadas: 0, combinaciones: 0, combinacionesNuevas: 0, conStock: 0, categorias: new Set(), precioDistinto: [] };
  const samples = [];
  for (const r of norm) {
    const nombre = String(r.nombre || "").trim();
    if (!nombre) { summary.ignoradas++; continue; }
    summary.filas++;
    const { base, color, size } = splitName(nombre);
    const interno = String(r.interno || "").trim(), barras = String(r.barras || "").trim();
    const hit = byCode.get(keyOf(interno)) || byCode.get(keyOf(barras));
    const slug = hit ? (hit.p.slug || slugify(hit.p.name)) : slugify(base || nombre);
    const price = num(r.precio) > 0 ? num(r.precio) : num(r.lista0);
    const cost = num(r.costo);
    const activo = !/inactiv|anulad|baja/i.test(String(r.estado || "activo"));
    const categoria = mapCategory(r.categoria);
    summary.categorias.add(categoria);
    if (samples.length < 12) samples.push({ nombre, prenda: titleCase(base || nombre), color: color ? titleCase(color) : "Único", talla: size || "Única", codigo: interno || barras });
    let prod = out.get(slug);
    if (!prod) {
      const prev = hit?.p || bySlug.get(slug);
      prod = prev ? { ...prev, variants: [...(prev.variants || [])] } : {
        id: genId("prod"), name: titleCase(base || nombre), slug, category: categoria, description: "", price: price || 0, compareAtPrice: null,
        status: activo ? "active" : "borrador", tag: null, images: [], collectionIds: [], variants: [], minStock: 3, createdAt: Date.now(), updatedAt: Date.now(),
      };
      prod._new = !prev;
      prod._prices = [];
      if (prev) { prod.category = categoria || prev.category; prod.updatedAt = Date.now(); }
      out.set(slug, prod);
    }
    if (price > 0) prod._prices.push(price);
    if (cost > 0) costs.set(prod.id, cost);
    const colorName = color ? titleCase(color) : "Único";
    const sizeName = size || "Única";
    const stock = r.stock !== undefined && String(r.stock).trim() !== "" && !Number.isNaN(num(r.stock)) ? Math.max(0, Math.round(num(r.stock))) : null;
    let v = prod.variants.find((x) => (interno && keyOf(x.sku) === keyOf(interno)) || (barras && x.barcode && keyOf(x.barcode) === keyOf(barras)))
      || prod.variants.find((x) => keyOf(x.colorName) === keyOf(colorName) && keyOf(x.size) === keyOf(sizeName));
    if (v) {
      const i = prod.variants.indexOf(v);
      v = { ...v, sku: interno || v.sku, barcode: barras || v.barcode, colorName: v.colorName || colorName, size: v.size || sizeName, ...(stock !== null ? { stock } : {}) };
      prod.variants[i] = v;
    } else {
      prod.variants.push({ id: genId("var"), size: sizeName, colorName, colorHex: colorHexOf(color), stock: stock ?? 0, sku: interno || barras || `${slug}-${sizeName}-${colorName}`.toUpperCase(), ...(barras ? { barcode: barras } : {}) });
      summary.combinacionesNuevas++;
    }
    if (stock !== null) summary.conStock++;
    summary.combinaciones++;
    if (!activo && prod._new) prod.status = "borrador";
  }
  const products = [...out.values()].map((p) => {
    const prices = p._prices; delete p._prices;
    const isNew = p._new; delete p._new;
    if (prices.length) {
      const counts = {}; prices.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
      const common = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
      if (Object.keys(counts).length > 1) summary.precioDistinto.push(`${p.name}: ${Object.keys(counts).join(" / ")}`);
      p.price = common;
    }
    if (isNew) summary.nuevas++; else summary.actualizadas++;
    return p;
  });
  return { products, costs: [...costs.entries()].map(([productId, cost]) => ({ productId, cost })), summary: { ...summary, categorias: [...summary.categorias] }, samples };
}

// Fotos en lote: «9LRJC28.jpg», «9LRJC28-2.jpg», «ALDANA DRESS NEGRO 1.jpg» → prenda + color + orden
export function matchPhoto(fileName, products) {
  const raw = keyOf(String(fileName).replace(/\.[^.]+$/, ""));
  let order = 0;
  let words = raw.split(" ");
  const m = /^(\d{1,2})$/.exec(words[words.length - 1] || "");
  const codeWhole = raw.replace(/ /g, "");
  // 1) Código exacto (interno o de barras), con o sin número de orden al final
  const tryCode = (code) => { for (const p of products) for (const v of p.variants || []) if ([v.sku, v.barcode].filter(Boolean).some((c) => keyOf(c).replace(/ /g, "") === code)) return { product: p, colorName: v.colorName }; return null; };
  let hit = tryCode(codeWhole);
  if (!hit && m && words.length > 1) { const c = words.slice(0, -1).join(""); hit = tryCode(c); if (hit) order = Number(m[1]); }
  if (hit) return { ...hit, order };
  // 2) Nombre de la prenda + color (+ número de orden), sin importar la talla
  if (m && words.length > 1) { order = Number(m[1]); words = words.slice(0, -1); }
  const text = words.join(" ");
  let best = null;
  for (const p of products) {
    const pn = keyOf(p.name);
    if (!text.startsWith(pn)) continue;
    const rest = text.slice(pn.length).trim();
    const restNoSize = rest.split(" ").filter((w) => w && !isSize(w)).join(" ");
    const colors = [...new Set((p.variants || []).map((v) => v.colorName))];
    const col = colors.find((c) => keyOf(c) === restNoSize) || (restNoSize ? null : colors.length === 1 ? colors[0] : null);
    if (restNoSize && !col) continue;
    if (!best || pn.length > keyOf(best.product.name).length) best = { product: p, colorName: col || null, order };
  }
  return best;
}
