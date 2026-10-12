import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Home, LayoutGrid, ShoppingBag, Star, User, Search, Heart, X, Plus, Minus, Eye, ChevronUp,
  ChevronRight, ChevronDown, Sparkles, MapPin, Bell, Award, Gift, Ticket, Trash2, Check,
  LogOut, CreditCard, Package, Settings2, SlidersHorizontal, ArrowUpDown,
  Mail, Pencil, Upload, Image as ImageIcon, KeyRound, LayoutDashboard,
  Layers, AlertCircle, ArrowLeft, Link as LinkIcon, ShieldCheck, Loader2,
  MessageCircle, Download, FileSpreadsheet, ShoppingCart, Menu, BarChart3, Undo2, Receipt, Scan,
} from "lucide-react";
import * as XLSX from "xlsx";
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient.js";

/* ------------------------------------------------------------------ */
/*  DESIGN TOKENS — monochrome editorial, one burgundy accent          */
/* ------------------------------------------------------------------ */
const C = {
  // Identidad oficial de Fly: blanco y negro. El único color fuera de esa paleta es un rojo
  // contenido, usado solo con función práctica (ofertas, errores) — nunca como color de marca.
  ink: "#111111", inkSoft: "#3A3A3A", paper: "#FFFFFF", paperDeep: "#F4F4F4",
  line: "#E3E3E3", stone: "#8F8F8F", white: "#FFFFFF", accent: "#B3261E",
  accentSoft: "#F6E3E1", brass: "#4A4A4A", brassSoft: "#F0F0F0",
  scrim: "#000000", // negro fijo para superposiciones (degradado de banner, fondo de modales) — no cambia con el tema
};
const FONT_DISPLAY = "'Archivo', 'Helvetica Neue', Arial, sans-serif";
const FONT_BODY = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const imgGrade = { filter: "saturate(0.9) contrast(1.04)" };
const STORAGE_KEY = "flyboutique:catalog:v1";
const WISHLIST_KEY = "flyboutique:wishlist:v1";
const CLUB_KEY = "flyboutique:clubmember:v1";
const VIEWED_KEY = "flyboutique:viewed:v1";
const MAX_VIEWED = 10;
const SESSION_KEY = "flyboutique:session:v1";
const COOKIE_CONSENT_KEY = "flyboutique:cookieconsent:v1";
const STORE_WHATSAPP = "51978687704"; // wa.me/c/51978687704 — el mismo número del Instagram de Fly Boutique
const STORE_EMAIL = "flyboutiqueperu@gmail.com";

/* ------------------------------------------------------------------ */
/*  DATA MODEL (documented — this is what maps to real DB tables)      */
/* ------------------------------------------------------------------ */
// Product   { id, name, slug, category, collectionIds:[], description,
//             price, compareAtPrice, status:'active'|'agotado'|'borrador',
//             tag:'Nuevo'|'Oferta'|'Bestseller'|null,
//             images:[{id,url}], variants:[{id,size,colorName,colorHex,stock,sku}],
//             createdAt, updatedAt }
// Banner    { id, eyebrow, title, subtitle, image, ctaLabel,
//             ctaType:'category'|'collection'|'none', ctaValue, active, order }
// Collection{ id, name, slug, description, cover, productIds:[], featured, order }

const CATEGORY_OPTIONS = ["Vestidos", "Blusas", "Pantalones", "Faldas", "Abrigos", "Accesorios", "Calzado"];
const genId = (p = "id") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (n) => `S/ ${Number(n || 0).toFixed(0)}`;

const seedProduct = (id, name, price, oldPrice, category, tag, img, sizes, colors, stockPattern, minStock = 3) => ({
  id, name, slug: slugify(name), category, collectionIds: [],
  description: `${name} — pieza de la colección Fly Boutique, diseñada para durar y para lucir.`,
  price, compareAtPrice: oldPrice, status: "active", tag: tag || null, minStock,
  images: [{ id: genId("img"), url: img }],
  variants: sizes.flatMap((s, si) => colors.map((c, ci) => ({
    id: genId("var"), size: s, colorName: c.n, colorHex: c.h,
    stock: stockPattern ? stockPattern(si, ci) : 12, sku: `${slugify(name)}-${s}-${slugify(c.n)}`.toUpperCase(),
  }))),
  createdAt: Date.now(), updatedAt: Date.now(),
});

const SEED_PRODUCTS = [
  { ...seedProduct("p1", "Vestido Midi Coralina", 189, null, "Vestidos", "Nuevo",
    "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=500&q=80&auto=format",
    ["S", "M", "L", "XL"], [{ n: "Coral", h: "#E0937F" }, { n: "Marfil", h: "#EFE4D6" }]),
    images: [
      { id: genId("img"), url: "https://images.unsplash.com/photo-1683660107856-cdad7a562d12?w=800&q=80&auto=format", colorName: "Coral", type: "image" },
      { id: genId("img"), url: "https://images.unsplash.com/photo-1726608870576-3cb08f5617b8?w=800&q=80&auto=format", colorName: "Marfil", type: "image" },
    ] },
  seedProduct("p2", "Blusa Seda Valentina", 119, null, "Blusas", "Bestseller",
    "https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?w=500&q=80&auto=format",
    ["S", "M", "L"], [{ n: "Marfil", h: "#F3EDE3" }, { n: "Negro", h: "#1C1918" }]),
  seedProduct("p3", "Pantalón Palazzo Aurora", 145, null, "Pantalones", "Nuevo",
    "https://images.unsplash.com/photo-1509631179647-0177331693ae?w=500&q=80&auto=format",
    ["S", "M", "L", "XL"], [{ n: "Beige", h: "#D9C4A8" }, { n: "Negro", h: "#1C1918" }]),
  seedProduct("p4", "Falda Plisada Marina", 99, null, "Faldas", null,
    "https://images.unsplash.com/photo-1583496661160-fb5886a13d77?w=500&q=80&auto=format",
    ["S", "M", "L"], [{ n: "Camel", h: "#C29A6C" }, { n: "Negro", h: "#1C1918" }], () => 0),
  seedProduct("p5", "Vestido Noche Imperial", 259, 320, "Vestidos", "Oferta",
    "https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=500&q=80&auto=format",
    ["S", "M", "L"], [{ n: "Vino", h: "#6B2A38" }, { n: "Negro", h: "#1C1918" }]),
  seedProduct("p6", "Cardigan Punto Otoño", 135, null, "Abrigos", null,
    "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=500&q=80&auto=format",
    ["S", "M", "L", "XL"], [{ n: "Camel", h: "#C29A6C" }, { n: "Crema", h: "#EEE4D2" }]),
  { ...seedProduct("p7", "Bolso Estructurado Luna", 165, null, "Accesorios", "Nuevo",
    "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500&q=80&auto=format",
    ["Única"], [{ n: "Cognac", h: "#A2643B" }, { n: "Negro", h: "#1C1918" }]),
    images: [
      { id: genId("img"), url: "https://images.unsplash.com/photo-1732613842353-0fccc5b72d51?w=800&q=80&auto=format", colorName: "Cognac", type: "image" },
      { id: genId("img"), url: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=500&q=80&auto=format", colorName: "Negro", type: "image" },
    ] },
  seedProduct("p8", "Sandalias Tacón Trujillo", 139, 179, "Calzado", "Oferta",
    "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=500&q=80&auto=format",
    ["35", "36", "37", "38", "39"], [{ n: "Nude", h: "#D6B393" }, { n: "Negro", h: "#1C1918" }], (si, ci) => (si === 4 ? 0 : 8)),
  { ...seedProduct("p9", "Blazer Entallado Sofía", 199, null, "Abrigos", "Nuevo",
    "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=500&q=80&auto=format",
    ["S", "M", "L"], [{ n: "Beige", h: "#D9C4A8" }, { n: "Negro", h: "#1C1918" }]),
    images: [
      { id: genId("img"), url: "https://videos.pexels.com/video-files/19863106/19863106-uhd_1440_2560_30fps.mp4", type: "video", colorName: "Beige" },
      { id: genId("img"), url: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=500&q=80&auto=format", type: "image", colorName: "Beige" },
      { id: genId("img"), url: "https://images.unsplash.com/photo-1617182397327-a05d5c3e2abb?w=800&q=80&auto=format", type: "image", colorName: "Negro" },
    ] },
  seedProduct("p10", "Aretes Perla Dorada", 59, null, "Accesorios", "Bestseller",
    "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=500&q=80&auto=format",
    ["Única"], [{ n: "Dorado", h: "#C6A24B" }]),
  seedProduct("p11", "Top Lino Tulipán", 89, 115, "Blusas", "Oferta",
    "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=500&q=80&auto=format",
    ["S", "M", "L", "XL"], [{ n: "Marfil", h: "#F3EDE3" }, { n: "Terracota", h: "#BD6E51" }]),
  seedProduct("p12", "Jean Recto Tiro Alto", 159, null, "Pantalones", null,
    "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=500&q=80&auto=format",
    ["26", "27", "28", "29", "30"], [{ n: "Azul Clásico", h: "#48586E" }, { n: "Negro", h: "#1C1918" }]),
];

const SEED_COLLECTIONS = [
  { id: "col1", name: "Oficina con Carácter", slug: "oficina-con-caracter", description: "Piezas estructuradas para el trabajo, sin perder personalidad.",
    cover: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=700&q=80&auto=format", productIds: ["p9", "p12", "p10"], featured: true, order: 1 },
  { id: "col2", name: "Cena de Viernes", slug: "cena-de-viernes", description: "Para las noches que sí importan.",
    cover: "https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=700&q=80&auto=format", productIds: ["p5", "p7"], featured: true, order: 2 },
];

const SEED_BANNERS = [
  { id: "ban1", eyebrow: "Colección primavera", title: "Piezas con carácter, hechas para volar", subtitle: "",
    image: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80&auto=format",
    videoUrl: "https://videos.pexels.com/video-files/19863106/19863106-uhd_1440_2560_30fps.mp4",
    ctaLabel: "Ver colección", ctaType: "category", ctaValue: "Todo", active: true, order: 1 },
];

const SEED_REVIEWS = {
  p1: [
    { id: "rev1", author: "Camila R.", rating: 5, text: "La tela es hermosa y cae increíble, se ve mucho más caro de lo que cuesta.", photo: null, createdAt: Date.now() - 86400000 * 5 },
    { id: "rev2", author: "Fiorella T.", rating: 4, text: "Me encantó el color coral, la talla M me quedó perfecta.", photo: null, createdAt: Date.now() - 86400000 * 12 },
  ],
  p9: [{ id: "rev3", author: "Andrea M.", rating: 5, text: "El blazer es una inversión — combina con todo y se siente premium.", photo: null, createdAt: Date.now() - 86400000 * 3 }],
};

const SEED_PROMOCODES = [{ id: "promo1", code: "FLY10", type: "percent", value: 10, clubOnly: false, active: true, createdAt: Date.now() }];

const DEFAULT_SETTINGS = { culqiPublicKey: "", yapeNumber: "", plinNumber: "", bankName: "", bankAccount: "", bankCCI: "" };

const seedCatalog = () => ({
  products: SEED_PRODUCTS, collections: SEED_COLLECTIONS, banners: SEED_BANNERS,
  staff: [], stockMovements: [], sales: [], nextBoletaNumber: 1, nextFacturaNumber: 1,
  reviews: SEED_REVIEWS, settings: DEFAULT_SETTINGS, promoCodes: SEED_PROMOCODES, customers: [], reservations: [],
});

const normalizeCatalog = (c) => ({
  products: (c.products || []).map((p) => ({ minStock: 3, featured: true, showOnline: true, ...p })),
  collections: c.collections || [],
  banners: c.banners || [],
  staff: c.staff || [],
  stockMovements: c.stockMovements || [],
  sales: c.sales || [],
  nextBoletaNumber: c.nextBoletaNumber || 1,
  nextFacturaNumber: c.nextFacturaNumber || 1,
  reviews: c.reviews || {},
  settings: { ...DEFAULT_SETTINGS, ...(c.settings || {}) },
  promoCodes: c.promoCodes && c.promoCodes.length ? c.promoCodes : SEED_PROMOCODES,
  customers: c.customers || [],
  reservations: c.reservations || [],
});

const RESERVATION_MINUTES = 15;
// Stock "reservado" por otras clientas que lo tienen en su carrito ahora mismo (no cuenta el propio carrito).
const reservedByOthers = (catalog, variantId, mySessionId) => {
  const now = Date.now();
  return (catalog.reservations || [])
    .filter((r) => r.variantId === variantId && r.sessionId !== mySessionId && r.expiresAt > now)
    .reduce((sum, r) => sum + r.qty, 0);
};
const availableStock = (catalog, variant, mySessionId) => Math.max(0, (variant?.stock || 0) - reservedByOthers(catalog, variant?.id, mySessionId));

/* ------------------------------------------------------------------ */
/*  STAFF / ROLES                                                       */
/* ------------------------------------------------------------------ */
// Las cuentas del staff viven en Supabase Auth (contraseñas cifradas) + tabla staff_profiles.
const ROLE_LABELS = { superadmin: "Super Administrador", administrador: "Administrador", vendedora_tienda: "Vendedora Tienda", vendedora_online: "Vendedora Online" };

/* ------------------------------------------------------------------ */
/*  STORAGE — Supabase con permisos separados                            */
/* ------------------------------------------------------------------ */
// Público (lo lee cualquiera): catálogo, banners, colecciones, códigos y datos de pago.
// Privado (solo staff con sesión): ventas, clientas, movimientos de stock.
// Las clientas nunca escriben directo: usan funciones del servidor (place_order, etc.).
const PUBLIC_KEYS = ["products", "collections", "banners", "settings", "promoCodes"];
const pickPublic = (c) => Object.fromEntries(PUBLIC_KEYS.map((k) => [k, c[k]]));

async function loadCatalog() {
  try {
    const [main, rev, resv] = await Promise.all([
      supabase.from("store_data").select("data").eq("id", "main").maybeSingle(),
      supabase.from("product_reviews").select("product_id,data").order("created_at"),
      supabase.from("reservations").select("session_id,variant_id,qty,expires_at").gt("expires_at", new Date().toISOString()),
    ]);
    if (main.error) throw main.error;
    if (!main.data?.data) return null;
    const reviews = {};
    (rev.data || []).forEach((r) => { (reviews[r.product_id] = reviews[r.product_id] || []).push(r.data); });
    const reservations = (resv.data || []).map((r) => ({ sessionId: r.session_id, variantId: r.variant_id, qty: r.qty, expiresAt: new Date(r.expires_at).getTime() }));
    return normalizeCatalog({ ...main.data.data, reviews, reservations, staff: [], sales: [], customers: [], stockMovements: [] });
  } catch (e) { console.warn("No se pudo leer el catálogo de Supabase:", e); }
  return null;
}

async function loadPrivateData() {
  const [sales, customers, priv] = await Promise.all([
    supabase.from("sales").select("data").order("created_at", { ascending: false }).limit(3000),
    supabase.from("customers").select("data"),
    supabase.from("store_private").select("data").eq("id", "main").maybeSingle(),
  ]);
  if (sales.error) throw sales.error;
  return {
    sales: (sales.data || []).map((r) => r.data),
    customers: (customers.data || []).map((r) => r.data),
    stockMovements: priv.data?.data?.stockMovements || [],
  };
}

// Guarda solo lo que cambió (y solo si quien guarda es staff).
async function persistStaffChanges(next, prev) {
  const tasks = [];
  if (!prev || JSON.stringify(pickPublic(next)) !== JSON.stringify(pickPublic(prev))) {
    tasks.push(supabase.from("store_data").upsert({ id: "main", data: pickPublic(next), updated_at: new Date().toISOString() }));
  }
  const prevSales = new Map((prev?.sales || []).map((s) => [s.id, s]));
  const changedSales = (next.sales || []).filter((s) => s.id && prevSales.get(s.id) !== s);
  if (changedSales.length) tasks.push(supabase.from("sales").upsert(changedSales.map((s) => ({ id: s.id, data: s, created_at: new Date(s.createdAt || Date.now()).toISOString() }))));
  const prevCust = new Map((prev?.customers || []).map((c) => [c.phone, c]));
  const changedCust = (next.customers || []).filter((c) => c.phone && prevCust.get(c.phone) !== c);
  if (changedCust.length) tasks.push(supabase.from("customers").upsert(changedCust.map((c) => ({ phone: c.phone, data: c }))));
  if (next.stockMovements !== prev?.stockMovements) {
    tasks.push(supabase.from("store_private").upsert({ id: "main", data: { stockMovements: (next.stockMovements || []).slice(0, 3000) }, updated_at: new Date().toISOString() }));
  }
  try {
    const results = await Promise.all(tasks);
    const err = results.find((r) => r.error)?.error;
    if (err) { console.error("No se pudo guardar:", err); alert("No se pudo guardar el cambio: " + err.message + "\nSi dice 'row-level security', vuelve a iniciar sesión."); }
  } catch (e) { console.error(e); alert("No se pudo guardar el cambio. Revisa tu conexión."); }
}

/* ------------------------------------------------------------------ */
/*  IMAGE HELPERS                                                       */
/* ------------------------------------------------------------------ */
function resizeImageFile(file, maxW = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const mainImageUrl = (product) => product?.images?.[0]?.url || null;
// Segunda foto disponible (de cualquier color) — para mostrar al pasar el mouse sobre la tarjeta.
const hoverImageUrl = (product) => {
  const imgs = (product?.images || []).filter((im) => im.type !== "video" && im.url);
  const main = imgs[0]?.url;
  return imgs.find((im) => im.url !== main)?.url || null;
};
const productSoldOut = (product) => product.status === "agotado" || (product.variants.length > 0 && product.variants.every((v) => v.stock <= 0));
const productTotalStock = (product) => product.variants.reduce((s, v) => s + Number(v.stock || 0), 0);
const productSizes = (product) => [...new Set(product.variants.map((v) => v.size))];
const productColors = (product) => [...new Map(product.variants.map((v) => [v.colorName, { n: v.colorName, h: v.colorHex }])).values()];
const colorTotalStock = (product, colorName) => product.variants.filter((v) => v.colorName === colorName).reduce((s, v) => s + Number(v.stock || 0), 0);
const variantStock = (product, size, colorName) => product.variants.find((v) => v.size === size && v.colorName === colorName)?.stock ?? 0;

const findPromo = (promoCodes, codeInput) => (promoCodes || []).find((p) => p.active && p.code.toLowerCase() === codeInput.trim().toLowerCase());
const computeDiscount = (promo, subtotal) => !promo ? 0 : promo.type === "percent" ? Math.round(subtotal * (promo.value / 100)) : Math.min(promo.value, subtotal);

/* ------------------------------------------------------------------ */
/*  BULK IMPORT — Excel/CSV template → product records                 */
/* ------------------------------------------------------------------ */
const normalizeCode = (s) => String(s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");

function parseImportRows(rawRows) {
  const grouped = new Map();
  const deleteSlugs = new Set();
  const movements = [];
  rawRows.forEach((raw) => {
    const row = normalizeRowKeys(raw);
    const name = String(row.producto || "").trim();
    if (!name) return;
    const key = slugify(name);
    const accion = String(row.accion || "").trim().toLowerCase();
    if (accion === "eliminar") { deleteSlugs.add(key); return; }
    if (!grouped.has(key)) {
      const validStatus = ["active", "agotado", "borrador"].includes(String(row.estado || "").trim()) ? String(row.estado).trim() : "active";
      const validTag = ["Nuevo", "Oferta", "Bestseller"].includes(String(row.etiqueta || "").trim()) ? String(row.etiqueta).trim() : null;
      const images = String(row.imagenes_urls || "").split("|").map((u) => u.trim()).filter(Boolean).map((url) => ({ id: genId("img"), url }));
      const minStock = row.stock_minimo !== undefined && row.stock_minimo !== "" ? Math.max(0, Number(row.stock_minimo) || 0) : 3;
      grouped.set(key, {
        id: genId("prod"), name, slug: key, category: String(row.categoria || CATEGORY_OPTIONS[0]).trim(),
        description: String(row.descripcion || "").trim(), price: Number(row.precio) || 0,
        compareAtPrice: row.precio_anterior ? Number(row.precio_anterior) : null,
        status: validStatus, tag: validTag, images, collectionIds: [], variants: [], minStock,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
    const product = grouped.get(key);
    const size = String(row.talla || "Única").trim() || "Única";
    const colorName = String(row.color_nombre || "Único").trim() || "Único";
    const colorHex = String(row.color_hex || "#948C7E").trim() || "#948C7E";
    const barcode = String(row.codigo_barras || "").trim();
    const baseStock = Number(row.stock_actual ?? row.stock) || 0;
    const entradas = Number(row.entradas) || 0;
    const salidas = Number(row.salidas) || 0;
    const finalStock = Math.max(0, baseStock + entradas - salidas);
    if (entradas > 0) movements.push({ id: genId("mov"), productName: name, size, colorName, type: "entrada", qty: entradas, note: "Importado desde Excel", staffName: "Importación", createdAt: Date.now() });
    if (salidas > 0) movements.push({ id: genId("mov"), productName: name, size, colorName, type: "salida", qty: salidas, note: "Importado desde Excel", staffName: "Importación", createdAt: Date.now() });
    product.variants.push({ id: genId("var"), size, colorName, colorHex, stock: finalStock, sku: barcode || `${key}-${size}-${slugify(colorName)}`.toUpperCase() });
  });
  return { toUpsert: [...grouped.values()], toDelete: [...deleteSlugs], movements };
}

async function parseImportFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return parseImportRows(rows);
}

/* ------------------------------------------------------------------ */
/*  BULK PHOTO MATCHING — auto-attach photos by filename ↔ código      */
/* ------------------------------------------------------------------ */
function findProductMatch(products, baseNorm) {
  for (const p of products) {
    for (const v of p.variants) { if (v.sku && normalizeCode(v.sku) === baseNorm) return { product: p, colorName: v.colorName }; }
  }
  if (baseNorm.length >= 4) {
    for (const p of products) {
      const slugNorm = normalizeCode(p.slug);
      const nameNorm = normalizeCode(p.name);
      if (baseNorm.includes(slugNorm) || slugNorm.includes(baseNorm) || baseNorm.includes(nameNorm) || nameNorm.includes(baseNorm)) return { product: p, colorName: null };
    }
  }
  return null;
}
const mediaForColor = (product, colorName) => product.images.find((i) => i.colorName === colorName) || product.images.find((i) => !i.colorName) || product.images[0] || null;

/* ------------------------------------------------------------------ */
/*  SIGNATURE MARKS                                                    */
/* ------------------------------------------------------------------ */
const BadgeLogo = ({ size = 34, dark }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0,
    border: `${Math.max(1.2, size * 0.045)}px solid ${dark ? "#FFFFFF" : "#000000"}`,
    background: dark ? "transparent" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: size * 0.32, letterSpacing: "-0.01em", color: dark ? "#FFFFFF" : "#000000" }}>FLY</span>
  </div>
);
const FlightPath = ({ width = 70, color = C.ink }) => (
  <svg width={width} height={width * 0.26} viewBox="0 0 100 26" fill="none">
    <path d="M2 22C24 22 30 4 52 4C68 4 74 15 96 9" stroke={color} strokeWidth="1.3" strokeDasharray="0.5 5.5" strokeLinecap="round" />
    <circle cx="2" cy="22" r="2" fill={color} />
    <path d="M89 5.5L96 9L88.5 13" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

const ProductImg = ({ src, alt, style, dim }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", background: C.paperDeep }}><BadgeLogo size={30} /></div>;
  }
  return <img src={src} alt={alt} style={{ ...imgGrade, ...style, ...(dim ? { filter: "saturate(0) contrast(1.02)", opacity: 0.45 } : {}) }} onError={() => setBroken(true)} loading="lazy" />;
};

/* ------------------------------------------------------------------ */
/*  SMALL UI PRIMITIVES                                                */
/* ------------------------------------------------------------------ */
const Eyebrow = ({ children, color = C.stone }) => (
  <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.2em", textTransform: "uppercase", color, fontWeight: 500, marginBottom: 5 }}>{children}</div>
);
const SectionTitle = ({ eyebrow, title, action, onAction }) => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 20px", marginBottom: 14 }}>
    <div>{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2></div>
    {action && <button onClick={onAction} style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 2, fontFamily: FONT_BODY, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, cursor: "pointer", padding: 4, fontWeight: 600 }}>{action} <ChevronRight size={13} /></button>}
  </div>
);
const Chip = ({ children, active, onClick }) => (
  <button onClick={onClick} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.03em", whiteSpace: "nowrap", padding: "9px 15px", borderRadius: 8,
    border: `1px solid ${active ? C.ink : C.line}`, background: active ? C.ink : "transparent", color: active ? C.paper : C.ink, cursor: "pointer", fontWeight: 500 }}>{children}</button>
);
const Tag = ({ label }) => {
  const map = { Nuevo: { bg: C.ink, fg: C.paper, border: C.ink }, Oferta: { bg: C.accent, fg: C.white, border: C.accent },
    Bestseller: { bg: "transparent", fg: C.ink, border: C.ink }, Agotado: { bg: C.white, fg: C.stone, border: C.stone } };
  const s = map[label];
  if (!s) return null;
  return <span style={{ position: "absolute", top: 10, left: 10, background: s.bg, color: s.fg, border: `1px solid ${s.border}`, fontFamily: FONT_BODY, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 8px", borderRadius: 3, fontWeight: 600, zIndex: 2 }}>{label}</span>;
};
const PrimaryButton = ({ children, onClick, dark = true, style, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ fontFamily: FONT_BODY, fontSize: 12.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600,
    background: disabled ? C.line : dark ? C.ink : "transparent", color: disabled ? C.stone : dark ? C.paper : C.ink, border: dark ? "none" : `1px solid ${C.ink}`,
    padding: "14px 22px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", ...style }}>{children}</button>
);
const Switch = ({ on, onClick, label }) => (
  <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
    {label && <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{label}</span>}
    <span style={{ width: 38, height: 21, borderRadius: 999, border: `1px solid ${C.ink}`, background: on ? C.ink : "transparent", position: "relative", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 1.5, left: on ? 18 : 2, width: 15, height: 15, borderRadius: "50%", background: on ? C.paper : C.ink, transition: "left .15s ease" }} />
    </span>
  </button>
);

/* ------------------------------------------------------------------ */
/*  PRODUCT CARD                                                       */
/* ------------------------------------------------------------------ */
const QuickAddSheet = ({ product, onClose, onQuickAdd, catalog, cartSessionId }) => {
  const colors = productColors(product);
  const sizes = productSizes(product);
  const [color, setColor] = useState(colors[0] || null);
  const [size, setSize] = useState(null);
  const effStock = (s, colorName) => {
    const v = product.variants.find((vv) => vv.size === s && vv.colorName === colorName);
    if (!v) return 0;
    return catalog ? availableStock(catalog, v, cartSessionId) : v.stock;
  };
  const canAdd = size && color && effStock(size, color.n) > 0;
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.white, borderRadius: "18px 18px 0 0", padding: "20px 20px 26px", animation: "slideUp .25s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 56, height: 70, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(product)} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, fontWeight: 600, marginBottom: 2 }}>{product.name}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: C.ink, fontWeight: 800 }}>{money(product.price)}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start" }}><X size={18} color={C.stone} /></button>
        </div>
        {colors.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.stone, marginBottom: 8 }}>Color — {color?.n}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {colors.map((c) => <button key={c.n} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: "50%", background: c.h, border: color?.n === c.n ? `2px solid ${C.ink}` : `1px solid ${C.line}`, cursor: "pointer" }} />)}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.stone, marginBottom: 8 }}>Talla</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sizes.map((s) => {
              const st = effStock(s, color?.n);
              return <button key={s} disabled={st === 0} onClick={() => setSize(s)} style={{ minWidth: 40, padding: "8px 6px", borderRadius: 8, border: `1px solid ${size === s ? C.ink : C.line}`, background: size === s ? C.ink : "transparent", color: st === 0 ? C.line : size === s ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: st === 0 ? "not-allowed" : "pointer", textDecoration: st === 0 ? "line-through" : "none" }}>{s}</button>;
            })}
          </div>
        </div>
        <PrimaryButton disabled={!canAdd} onClick={() => { onQuickAdd(product, size, color, 1); onClose(); }}>{canAdd ? "Agregar a la bolsa" : "Elige talla"}</PrimaryButton>
      </div>
    </div>
  );
};

const ProductCard = ({ product, onOpen, fav, onToggleFav, wide, onQuickAdd, catalog, cartSessionId }) => {
  const soldOut = productSoldOut(product);
  const label = soldOut ? "Agotado" : product.tag;
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const altImg = hoverImageUrl(product);
  const colors = productColors(product);
  return (
    <div style={{ width: wide ? 300 : "100%", flexShrink: 0, cursor: "pointer", position: "relative" }} onClick={() => onOpen(product)}>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: C.paperDeep }} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <Tag label={label} />
        <button aria-label={fav ? "Quitar de favoritos" : "Guardar en favoritos"} onClick={(e) => { e.stopPropagation(); onToggleFav(product.id); }} style={{ position: "absolute", top: 8, right: 8, zIndex: 2, width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.92)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Heart size={14} color={C.ink} fill={fav ? C.ink : "none"} strokeWidth={1.6} />
        </button>
        <ProductImg src={hovering && altImg ? altImg : mainImageUrl(product)} alt={product.name} dim={soldOut} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} />
        {!soldOut && onQuickAdd && (
          <button aria-label="Añadir a la cesta" onClick={(e) => { e.stopPropagation(); setQuickAddOpen(true); }} style={{ position: "absolute", bottom: 8, right: 8, zIndex: 2, width: 32, height: 32, borderRadius: "50%", background: C.ink, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Plus size={15} color={C.paper} />
          </button>
        )}
      </div>
      <div style={{ padding: "9px 1px 0" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, fontWeight: 500, lineHeight: 1.25, marginBottom: 4 }}>{product.name}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, color: product.compareAtPrice ? C.accent : C.ink, fontWeight: 800 }}>{money(product.price)}</span>
          {product.compareAtPrice && <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, textDecoration: "line-through" }}>{money(product.compareAtPrice)}</span>}
        </div>
        {colors.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7 }}>
            {colors.slice(0, 5).map((c) => <span key={c.n} title={c.n} style={{ width: 11, height: 11, borderRadius: "50%", background: c.h, border: `1px solid ${C.line}` }} />)}
            {colors.length > 5 && <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>+{colors.length - 5}</span>}
          </div>
        )}
      </div>
      {quickAddOpen && createPortal(<QuickAddSheet product={product} onClose={() => setQuickAddOpen(false)} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />, document.body)}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  BOTTOM NAVIGATION (storefront)                                     */
/* ------------------------------------------------------------------ */
// "Inicio" ya no es un botón aparte: el círculo FLY lleva al inicio (como en la mayoría
// de tiendas). En PC el círculo es grande y muestra "Ir al inicio" al pasar el mouse.
// La búsqueda se hace solo con la barra "¿Qué prenda buscas hoy?"; el botón "Catálogo"
// abre todas las prendas con filtros (antes tenía otra lupa y se repetía).
const NAV_ITEMS = [
  { key: "category", label: "Catálogo", icon: LayoutGrid }, { key: "viewed", label: "Visto", icon: Eye },
  { key: "cart", label: "Cesta", icon: ShoppingBag }, { key: "profile", label: "Cuenta", icon: User },
];
const BottomNav = ({ screen, setScreen, cartCount, onSearch }) => (
  <div className="app-nav" style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.paperDeep, borderTop: `1px solid ${C.line}`, padding: "10px 6px calc(10px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 30 }}>
    <button className="nav-brand" onClick={() => setScreen("home")} title="Ir al inicio" aria-label="Ir al inicio" style={{ display: "none", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
      <BadgeLogo size={64} />
      <span className="nav-brand-hint" style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>Inicio</span>
    </button>
    <button className="nav-search" onClick={onSearch} style={{ display: "none", alignItems: "center", gap: 10, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 999, padding: "12px 18px", cursor: "pointer", textAlign: "left" }}>
      <Search size={16} color={C.stone} strokeWidth={1.8} />
      <span style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.stone }}>¿Qué prenda buscas hoy?</span>
    </button>
    {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
      const active = screen === key;
      return (
        <button key={key} className={`nav-item${active ? " is-active" : ""}`} onClick={() => setScreen(key)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 6px", position: "relative", flex: 1 }}>
          <div style={{ position: "relative" }}>
            <Icon size={20} strokeWidth={active ? 2.1 : 1.5} color={active ? C.ink : C.stone} />
            {key === "cart" && cartCount > 0 && <span style={{ position: "absolute", top: -6, right: -9, background: C.ink, color: C.white, fontSize: 9, fontFamily: FONT_BODY, fontWeight: 600, borderRadius: 999, minWidth: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{cartCount}</span>}
          </div>
          <span className="nav-label" style={{ fontFamily: FONT_BODY, fontSize: 10, color: active ? C.ink : C.stone, fontWeight: active ? 600 : 400 }}>{label}</span>
        </button>
      );
    })}
  </div>
);

/* ------------------------------------------------------------------ */
/*  HEADER + MARQUEE                                                   */
/* ------------------------------------------------------------------ */
const Marquee = () => {
  const text = "ENVÍO GRATIS EN TRUJILLO DESDE S/ 200  ·  CLUB FLY: GANA PUNTOS EN CADA COMPRA  ·  NUEVA COLECCIÓN DISPONIBLE  ·  ";
  return (
    <div style={{ background: C.ink, overflow: "hidden", height: 28, display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", animation: "marquee 22s linear infinite" }}>
        {[0, 1].map((i) => <span key={i} style={{ fontFamily: FONT_BODY, fontSize: 10, letterSpacing: "0.14em", color: C.paper, whiteSpace: "nowrap" }}>{text}</span>)}
      </div>
    </div>
  );
};
const iconBtnStyle = { width: 34, height: 34, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.paperDeep, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const SearchOverlay = ({ products, onClose, onOpenProduct }) => {
  const [q, setQ] = useState("");
  const results = q.trim().length >= 2 ? products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.category.toLowerCase().includes(q.toLowerCase())).slice(0, 10) : [];
  const suggestions = ["Vestidos", "Blazer", "Ofertas", "Nuevo", "Accesorios"];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: C.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.paperDeep}` }}>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><ArrowLeft size={19} color={C.ink} /></button>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar vestidos, blazers, accesorios…"
          style={{ flex: 1, border: "none", outline: "none", fontFamily: FONT_BODY, fontSize: 14, background: "transparent", color: C.ink }} />
        {q && <button onClick={() => setQ("")} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={16} color={C.stone} /></button>}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {q.trim().length < 2 ? (
          <>
            <Eyebrow>Sugerencias</Eyebrow>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{suggestions.map((s) => <button key={s} onClick={() => setQ(s)} style={{ padding: "9px 14px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paperDeep, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, cursor: "pointer" }}>{s}</button>)}</div>
          </>
        ) : results.length === 0 ? (
          <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>No encontramos "{q}". Intenta con otra palabra.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map((p) => (
              <button key={p.id} onClick={() => onOpenProduct(p)} style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                <div style={{ width: 46, height: 58, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(p)} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                <div><div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{p.name}</div><div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>{p.category} · {money(p.price)}</div></div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Header = ({ onSearch, onBell, onHome }) => (
  <div className="app-header" style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper }}>
    <Marquee />
    <div style={{ padding: "14px 20px 12px", display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={onHome} aria-label="Ir al inicio" title="Ir al inicio" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}><BadgeLogo size={34} /></button>
      <button onClick={onSearch} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: C.paperDeep, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 14px", cursor: "pointer", textAlign: "left" }}>
        <Search size={15} color={C.stone} strokeWidth={1.8} />
        <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>¿Qué prenda buscas hoy?</span>
      </button>
      <button onClick={onBell} style={iconBtnStyle}><Bell size={16} color={C.ink} strokeWidth={1.6} /></button>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  HOME SCREEN                                                        */
/* ------------------------------------------------------------------ */
// Fila "Visto" del inicio: lo último que miró la clienta, con botón directo para
// añadir a la cesta (elige talla/color en el mismo momento, sin abrir la ficha).
const ViewedStrip = ({ items, onOpen, onQuickAdd, catalog, cartSessionId, onSeeAll }) => {
  const [quick, setQuick] = useState(null);
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 32 }}>
      <SectionTitle title="Visto recientemente" action="Ver todo" onAction={onSeeAll} />
      <div className="hscroll" style={{ display: "flex", gap: 12, overflowX: "auto", padding: "0 20px 4px", scrollbarWidth: "none" }}>
        {items.map((p) => {
          const soldOut = productSoldOut(p);
          return (
            <div key={p.id} style={{ width: 136, flexShrink: 0 }}>
              <div onClick={() => onOpen(p)} style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden", background: C.paperDeep }}>
                <ProductImg src={mainImageUrl(p)} alt={p.name} dim={soldOut} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} />
              </div>
              <div onClick={() => onOpen(p)} style={{ cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: p.compareAtPrice ? C.accent : C.ink, marginTop: 2 }}>{money(p.price)}</div>
              <button disabled={soldOut} onClick={() => setQuick(p)} style={{ width: "100%", marginTop: 8, padding: "9px 6px", borderRadius: 8, border: `1px solid ${soldOut ? C.line : C.ink}`, background: "transparent", color: soldOut ? C.stone : C.ink, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: soldOut ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <ShoppingBag size={13} /> {soldOut ? "Agotado" : "Añadir a la cesta"}
              </button>
            </div>
          );
        })}
      </div>
      {quick && createPortal(<QuickAddSheet product={quick} onClose={() => setQuick(null)} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />, document.body)}
    </div>
  );
};

const HomeScreen = ({ catalog, onOpen, favs, onToggleFav, setScreen, setActiveCategory, points, notifyMe, viewedIds, onQuickAdd, cartSessionId, onOpenInfo }) => {
  const products = catalog.products.filter((p) => p.showOnline !== false);
  const { banners, collections } = catalog;
  const vistos = (viewedIds || []).map((id) => products.find((p) => p.id === id)).filter(Boolean);
  const nuevos = products.filter((p) => p.tag === "Nuevo" && !productSoldOut(p));
  // "Destacados" no repite lo que ya sale en "Nueva colección"
  const nuevosIds = new Set(nuevos.map((p) => p.id));
  const featuredAll = products.filter((p) => p.featured !== false && !productSoldOut(p));
  const featuredRest = featuredAll.filter((p) => !nuevosIds.has(p.id));
  const destacados = (featuredRest.length >= 4 ? featuredRest : featuredAll).slice(0, 8);
  const ofertas = products.filter((p) => p.compareAtPrice);
  const activeBanners = banners.filter((b) => b.active).sort((a, b) => a.order - b.order);
  const hero = activeBanners[0];
  const featuredCollections = collections.filter((c) => c.featured).sort((a, b) => a.order - b.order);

  const heroTarget = () => {
    if (!hero) return setScreen("category");
    if (hero.ctaType === "category" && hero.ctaValue && hero.ctaValue !== "Todo") { setActiveCategory(hero.ctaValue); setScreen("category"); }
    else setScreen("category");
  };

  return (
    <div style={{ paddingBottom: 12 }}>
      {hero ? (
        <div className="hero" style={{ position: "relative", marginBottom: 30, height: "min(60vh, 560px)", minHeight: 360, overflow: "hidden" }}>
          {hero.videoUrl ? (
            <video src={hero.videoUrl} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <ProductImg src={hero.image} alt={hero.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          )}
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(0deg, ${C.scrim}CC 0%, ${C.scrim}10 42%, transparent 68%)` }} />
          <div style={{ position: "absolute", left: 20, right: 20, bottom: 28 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 36, color: C.white, fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.01em", marginBottom: 14 }}>{hero.title}</div>
            <button onClick={heroTarget} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: C.white, border: `1px solid ${C.white}`, padding: "12px 22px", borderRadius: 9, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>{hero.ctaLabel || "Ver colección"} <ChevronRight size={14} /></button>
          </div>
          {activeBanners.length > 1 && (
            <div style={{ position: "absolute", bottom: 10, right: 20, display: "flex", gap: 5 }}>
              {activeBanners.map((b, i) => <div key={b.id} style={{ width: i === 0 ? 14 : 5, height: 5, borderRadius: 999, background: i === 0 ? C.white : `${C.white}66` }} />)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ margin: "0 20px 30px", padding: 30, textAlign: "center", border: `1px dashed ${C.line}`, borderRadius: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay un banner activo. Agrégalo desde el panel admin.</div>
        </div>
      )}

      <SectionTitle eyebrow="Recién llegado" title="Nueva colección" action="Ver todo" onAction={() => setScreen("category")} />
      <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "0 20px 6px", marginBottom: 32, scrollbarWidth: "none" }}>
        {nuevos.length ? nuevos.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} wide onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)
          : <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, padding: "10px 0" }}>Sin novedades por ahora.</div>}
      </div>

      <SectionTitle eyebrow="Lo más amado" title="Destacados" />
      <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 20px", marginBottom: 32 }}>
        {destacados.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)}
      </div>

      {ofertas.length > 0 && (
        <div style={{ margin: "0 20px 32px", borderRadius: 14, border: `1px solid ${C.line}`, padding: "22px 20px" }}>
          <Eyebrow color={C.accent}>Por tiempo limitado</Eyebrow>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, marginBottom: 4 }}>Hasta 25% de descuento</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 16, maxWidth: 240 }}>En piezas seleccionadas. Solo esta semana.</div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none" }}>
            {ofertas.map((p) => (
              <div key={p.id} style={{ width: 108, flexShrink: 0, cursor: "pointer" }} onClick={() => onOpen(p)}>
                <div style={{ borderRadius: 8, overflow: "hidden" }}><ProductImg src={mainImageUrl(p)} alt={p.name} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover" }} /></div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginTop: 6, fontWeight: 600 }}>{money(p.price)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <InfoFooter onOpenInfo={onOpenInfo} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  FILTER SHEET                                                        */
/* ------------------------------------------------------------------ */
const SORT_OPTIONS = [["relevance", "Relevancia"], ["price-asc", "Precio: menor a mayor"], ["price-desc", "Precio: mayor a menor"], ["new", "Novedades primero"]];
// Ordenar: lista corta, al tocar una opción se aplica y se cierra sola
const SortSheet = ({ sort, setSort, onClose }) => (
  <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 55, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
    <div className="sheet-panel sheet-small" style={{ position: "relative", background: C.paper, borderRadius: "18px 18px 0 0", padding: "18px 22px calc(22px + env(safe-area-inset-bottom))", animation: "slideUp .25s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>Ordenar por</div>
        <button onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", cursor: "pointer" }}><X size={19} color={C.ink} /></button>
      </div>
      {SORT_OPTIONS.map(([key, label]) => (
        <button key={key} onClick={() => { setSort(key); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 2px", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.ink, fontWeight: sort === key ? 600 : 400 }}>{label}</span>
          {sort === key && <Check size={16} color={C.ink} />}
        </button>
      ))}
    </div>
  </div>
);

const FilterSheet = ({ allSizes, allColors, sizes, setSizes, colors, setColors, sort, setSort, tags, setTags, maxPrice, priceLimit, setPriceLimit, onClose, onClear }) => {
  const toggle = (set, setter, val) => { const next = new Set(set); next.has(val) ? next.delete(val) : next.add(val); setter(next); };
  const SORTS = [["relevance", "Relevancia"], ["price-asc", "Precio: menor a mayor"], ["price-desc", "Precio: mayor a menor"], ["new", "Novedades primero"]];
  const TAGS = ["Nuevo", "Oferta", "Bestseller"];
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 55, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", maxHeight: "82%", overflowY: "auto", animation: "slideUp .25s ease" }}>
        <div style={{ padding: "18px 22px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, color: C.ink }}>Filtrar</div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={19} color={C.ink} /></button>
          </div>
          <Eyebrow>Precio máximo — {money(priceLimit)}</Eyebrow>
          <input type="range" min={0} max={maxPrice} step={10} value={priceLimit} onChange={(e) => setPriceLimit(Number(e.target.value))} style={{ width: "100%", marginBottom: 22, accentColor: C.ink }} />
          <Eyebrow>Destacado</Eyebrow>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {TAGS.map((t) => <button key={t} onClick={() => toggle(tags, setTags, t)} style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, border: `1px solid ${tags.has(t) ? C.ink : C.line}`, background: tags.has(t) ? C.ink : "transparent", color: tags.has(t) ? C.paper : C.ink }}>{t}</button>)}
          </div>
          <Eyebrow>Talla</Eyebrow>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {allSizes.map((s) => <button key={s} onClick={() => toggle(sizes, setSizes, s)} style={{ minWidth: 44, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, border: `1px solid ${sizes.has(s) ? C.ink : C.line}`, background: sizes.has(s) ? C.ink : "transparent", color: sizes.has(s) ? C.paper : C.ink }}>{s}</button>)}
          </div>
          <Eyebrow>Color</Eyebrow>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 26 }}>
            {allColors.map((c) => (
              <button key={c.n} onClick={() => toggle(colors, setColors, c.n)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, border: `1px solid ${colors.has(c.n) ? C.ink : C.line}`, background: "transparent", cursor: "pointer" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: c.h, border: `1px solid ${C.line}` }} /><span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink }}>{c.n}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClear} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>Limpiar</button>
            <button onClick={onClose} style={{ flex: 2, padding: "14px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  CATEGORY SCREEN                                                     */
/* ------------------------------------------------------------------ */
const activeChipStyle = { display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paperDeep, fontFamily: FONT_BODY, fontSize: 11, color: C.ink, cursor: "pointer", whiteSpace: "nowrap" };

const ViewedScreen = ({ catalog, viewedIds, onOpen, favs, onToggleFav, onQuickAdd, cartSessionId, onRemoveViewed, setScreen }) => {
  const products = catalog.products.filter((p) => p.showOnline !== false);
  const vistos = (viewedIds || []).map((id) => products.find((p) => p.id === id)).filter(Boolean);
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: 0 }}>Visto</h1>
        {vistos.length > 0 && <button onClick={() => { if (confirm("¿Vaciar tu historial de vistos?")) vistos.forEach((p) => onRemoveViewed(p.id)); }} style={{ background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 12, color: C.stone, textDecoration: "underline", cursor: "pointer" }}>Eliminar</button>}
      </div>
      {vistos.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 320, textAlign: "center" }}>
          <Eye size={30} color={C.line} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, marginBottom: 20, maxWidth: 240 }}>Aún no has visto ninguna prenda. Explora el catálogo y lo que mires va a quedar guardado aquí.</div>
          <button onClick={() => setScreen("category")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", background: C.ink, color: C.paper, border: "none", padding: "13px 26px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>Explorar</button>
        </div>
      ) : (
        <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {vistos.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <ProductCard product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />
              <button onClick={() => onRemoveViewed(p.id)} style={{ position: "absolute", top: 8, left: 8, zIndex: 2, width: 26, height: 26, borderRadius: "50%", background: "rgba(247,244,239,0.92)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Trash2 size={12} color={C.inkSoft} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CategoryScreen = ({ catalog, activeCategory, setActiveCategory, onOpen, favs, onToggleFav, onQuickAdd, cartSessionId }) => {
  const products = catalog.products.filter((p) => p.showOnline !== false);
  const { collections } = catalog;
  const [sizes, setSizes] = useState(new Set());
  const [colors, setColors] = useState(new Set());
  const [tags, setTags] = useState(new Set());
  const [sort, setSort] = useState("relevance");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [activeCollection, setActiveCollection] = useState(null);

  const allSizes = useMemo(() => [...new Set(products.flatMap((p) => productSizes(p)))], [products]);
  const allColors = useMemo(() => [...new Map(products.flatMap((p) => productColors(p)).map((c) => [c.n, c])).values()], [products]);
  const maxPrice = useMemo(() => Math.max(100, ...products.map((p) => p.price)), [products]);
  const [priceLimit, setPriceLimit] = useState(maxPrice);
  useEffect(() => { setPriceLimit(maxPrice); }, [maxPrice]);

  let filtered = activeCategory === "Todo" ? [...products] : products.filter((p) => p.category === activeCategory);
  if (activeCollection) { const col = collections.find((c) => c.id === activeCollection); if (col) filtered = filtered.filter((p) => col.productIds.includes(p.id)); }
  if (sizes.size) filtered = filtered.filter((p) => productSizes(p).some((s) => sizes.has(s)));
  if (colors.size) filtered = filtered.filter((p) => productColors(p).some((c) => colors.has(c.n)));
  if (tags.size) filtered = filtered.filter((p) => p.tag && tags.has(p.tag));
  if (priceLimit < maxPrice) filtered = filtered.filter((p) => p.price <= priceLimit);
  if (sort === "price-asc") filtered.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") filtered.sort((a, b) => b.price - a.price);
  if (sort === "new") filtered.sort((a, b) => (b.tag === "Nuevo") - (a.tag === "Nuevo"));

  const activeFilterCount = sizes.size + colors.size + tags.size + (priceLimit < maxPrice ? 1 : 0);
  const clearAll = () => { setSizes(new Set()); setColors(new Set()); setTags(new Set()); setPriceLimit(maxPrice); setSort("relevance"); setActiveCollection(null); };

  return (
    <div style={{ paddingBottom: 20, position: "relative" }}>
      <div style={{ padding: "18px 20px 4px" }}>
        <Eyebrow>Catálogo completo</Eyebrow>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>{filtered.length} piezas</h1>
      </div>

      {collections.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 6px", marginBottom: 10, scrollbarWidth: "none" }}>
          {collections.map((col) => (
            <Chip key={col.id} active={activeCollection === col.id} onClick={() => setActiveCollection(activeCollection === col.id ? null : col.id)}>{col.name}</Chip>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 6px", marginBottom: 12, scrollbarWidth: "none" }}>
        <Chip active={activeCategory === "Todo"} onClick={() => setActiveCategory("Todo")}>Todo</Chip>
        {CATEGORY_OPTIONS.map((c) => <Chip key={c} active={activeCategory === c} onClick={() => setActiveCategory(c)}>{c}</Chip>)}
      </div>

      <div className="filter-bar" style={{ display: "flex", gap: 8, padding: "12px 20px", marginBottom: 18, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 88, zIndex: 15, background: C.paper }}>
        <button onClick={() => setSheetOpen(true)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: activeFilterCount ? C.ink : "transparent", color: activeFilterCount ? C.paper : C.ink, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500 }}><SlidersHorizontal size={13} /> Filtrar {activeFilterCount ? `(${activeFilterCount})` : ""}</button>
        <button onClick={() => setSortOpen(true)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500 }}><ArrowUpDown size={13} /> {sort === "relevance" ? "Ordenar" : (SORT_OPTIONS.find(([k]) => k === sort) || [, "Ordenar"])[1]}</button>
      </div>

      {activeFilterCount > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 4px", marginBottom: 14, scrollbarWidth: "none" }}>
          {[...sizes].map((s) => <button key={"s" + s} onClick={() => { const n = new Set(sizes); n.delete(s); setSizes(n); }} style={activeChipStyle}>Talla {s} <X size={11} /></button>)}
          {[...colors].map((c) => <button key={"c" + c} onClick={() => { const n = new Set(colors); n.delete(c); setColors(n); }} style={activeChipStyle}>{c} <X size={11} /></button>)}
          {[...tags].map((t) => <button key={"t" + t} onClick={() => { const n = new Set(tags); n.delete(t); setTags(n); }} style={activeChipStyle}>{t} <X size={11} /></button>)}
          {priceLimit < maxPrice && <button onClick={() => setPriceLimit(maxPrice)} style={activeChipStyle}>Hasta {money(priceLimit)} <X size={11} /></button>}
          <button onClick={clearAll} style={{ ...activeChipStyle, border: "none", background: "transparent", color: C.ink, fontWeight: 600, textDecoration: "underline" }}>Limpiar todo</button>
        </div>
      )}


      <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 20px" }}>
        {filtered.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)}
      </div>
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ color: C.stone, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 14 }}>No hay piezas que combinen todos esos filtros a la vez.</div>
          {activeFilterCount > 0 && <button onClick={clearAll} style={{ padding: "11px 22px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Quitar filtros</button>}
        </div>
      )}

      {sortOpen && <SortSheet sort={sort} setSort={setSort} onClose={() => setSortOpen(false)} />}
      {sheetOpen && <FilterSheet allSizes={allSizes} allColors={allColors} sizes={sizes} setSizes={setSizes} colors={colors} setColors={setColors} sort={sort} setSort={setSort}
        tags={tags} setTags={setTags} maxPrice={maxPrice} priceLimit={priceLimit} setPriceLimit={setPriceLimit} onClose={() => setSheetOpen(false)} onClear={clearAll} />}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  PRODUCT DETAIL SHEET                                               */
/* ------------------------------------------------------------------ */
const sheetLabelStyle = { fontFamily: FONT_BODY, fontSize: 11, letterSpacing: "0.08em", color: C.ink, fontWeight: 600, marginBottom: 10, textTransform: "uppercase" };

// Lupa: amplía la zona que tocas o por donde pasas el mouse, sin presionar nada.
// Calcula dónde está realmente la foto dentro del recuadro, así la ampliación coincide
// exacto tanto si la foto llena el recuadro (cover) como si se ve completa (contain).
// touchLens=false: en celular la foto se puede deslizar normal y un toque abre el visor.
const ZoomableImage = ({ src, alt, height = 260, dim, fit = "cover", fill = false }) => {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const hold = useRef({ timer: null, active: false, x: 0, y: 0 });
  const [lens, setLens] = useState(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); setLens(null); }, [src]);
  const ZOOM = 1.9;
  const lensSize = () => (window.matchMedia && window.matchMedia("(hover: none)").matches ? 130 : 170);
  const boxStyle = fill ? { position: "absolute", inset: 0 } : { position: "relative", width: "100%", height };

  const update = (clientX, clientY) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let iw = rect.width, ih = rect.height, ox = 0, oy = 0;
    const img = imgRef.current;
    if (img && img.naturalWidth) {
      const k = fit === "contain"
        ? Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
        : Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
      iw = img.naturalWidth * k; ih = img.naturalHeight * k;
      ox = (rect.width - iw) / 2; oy = (rect.height - ih) / 2;
    }
    const L = lensSize();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const px = Math.max(0, Math.min(1, (x - ox) / iw)), py = Math.max(0, Math.min(1, (y - oy) / ih));
    // En celular la lupa sale un poco arriba del dedo para que el dedo no tape lo ampliado
    const touchLift = hold.current.active ? L * 0.75 : 0;
    setLens({ L, x, y: y - touchLift, bgW: iw * ZOOM, bgH: ih * ZOOM, bgX: L / 2 - px * iw * ZOOM, bgY: L / 2 - py * ih * ZOOM });
  };
  const usable = !dim && src && !broken;
  const stopHold = () => { clearTimeout(hold.current.timer); hold.current.active = false; setLens(null); };

  // Mientras la lupa está activa en celular, el dedo no desplaza la página
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const block = (e) => { if (hold.current.active) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, [src, broken]);

  if (!src || broken) {
    return <div style={{ ...boxStyle, display: "flex", alignItems: "center", justifyContent: "center", background: C.paperDeep }}><BadgeLogo size={36} /></div>;
  }
  return (
    <div
      ref={containerRef}
      style={{ ...boxStyle, overflow: "hidden", cursor: usable ? "crosshair" : "default", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (!usable || e.pointerType === "mouse") return;
        const { clientX, clientY } = e;
        hold.current.x = clientX; hold.current.y = clientY;
        clearTimeout(hold.current.timer);
        hold.current.timer = setTimeout(() => { hold.current.active = true; update(clientX, clientY); try { navigator.vibrate && navigator.vibrate(8); } catch (err) { /* sin vibración */ } }, 260);
      }}
      onPointerMove={(e) => {
        if (!usable) return;
        if (e.pointerType === "mouse") { update(e.clientX, e.clientY); return; }
        if (hold.current.active) update(e.clientX, e.clientY);
        else if (Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 10) clearTimeout(hold.current.timer);
      }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setLens(null); }}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
    >
      <img ref={imgRef} src={src} alt={alt} onError={() => setBroken(true)} draggable={false}
        style={{ ...imgGrade, position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, objectPosition: "center", display: "block", pointerEvents: "none", ...(dim ? { filter: "saturate(0) contrast(1.02)", opacity: 0.45 } : {}) }} />
      {lens && (
        <div style={{
          position: "absolute", left: lens.x - lens.L / 2, top: lens.y - lens.L / 2, width: lens.L, height: lens.L, borderRadius: "50%",
          border: `2px solid ${C.white}`, boxShadow: "0 6px 22px rgba(0,0,0,0.3)", pointerEvents: "none", zIndex: 10,
          backgroundColor: C.paperDeep, backgroundImage: `url("${src}")`, backgroundSize: `${lens.bgW}px ${lens.bgH}px`, backgroundPosition: `${lens.bgX}px ${lens.bgY}px`, backgroundRepeat: "no-repeat",
        }} />
      )}
      {usable && !lens && (
        <div style={{ position: "absolute", bottom: 12, right: 12, background: "rgba(255,255,255,0.92)", borderRadius: 999, padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, pointerEvents: "none" }}>
          <Search size={11} color={C.ink} />
          <span className="hint-touch" style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.ink }}>Mantén presionado para ampliar</span>
          <span className="hint-mouse" style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.ink }}>Pasa el mouse para ampliar</span>
        </div>
      )}
    </div>
  );
};

// Fotos que corresponden al color elegido (+ las que no tienen color asignado).
const productGallery = (product, colorName) => {
  const all = (product.images || []).filter((m) => m.url);
  const list = [...all.filter((m) => m.colorName && m.colorName === colorName), ...all.filter((m) => !m.colorName)];
  const seen = new Set();
  return (list.length ? list : all).filter((m) => (seen.has(m.url) ? false : seen.add(m.url)));
};

// Galería de la ficha: en celular se desliza con el dedo (una foto por pantalla) y
// un toque abre el visor grande; en PC hay flechas, miniaturas y lupa con el mouse.
const ProductGallery = ({ items, alt, dim }) => {
  const trackRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const sig = items.map((m) => m.url).join("|");
  useEffect(() => { setIdx(0); if (trackRef.current) trackRef.current.scrollLeft = 0; }, [sig]);
  const go = (i) => {
    const el = trackRef.current;
    if (!el) return;
    const n = Math.max(0, Math.min(items.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => { const el = trackRef.current; if (el && el.clientWidth) setIdx(Math.round(el.scrollLeft / el.clientWidth)); };
  const arrowStyle = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.92)", border: "none", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 12 };

  if (!items.length) {
    return <div className="pdp-slide" style={{ width: "100%", aspectRatio: "3/4", background: C.paperDeep, display: "flex", alignItems: "center", justifyContent: "center" }}><BadgeLogo size={44} /></div>;
  }
  return (
    <div key={sig} style={{ animation: "galleryIn .35s ease" }}>
      <div style={{ position: "relative" }}>
        <div ref={trackRef} onScroll={onScroll} className="hscroll" style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none" }}>
          {items.map((m, i) => (
            <div key={m.id || i} className="pdp-slide" style={{ flex: "0 0 100%", width: "100%", scrollSnapAlign: "start", aspectRatio: "3/4", alignSelf: "flex-start", background: C.paperDeep, position: "relative", overflow: "hidden" }}>
              {m.type === "video" ? (
                <video src={m.url} autoPlay muted loop playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", filter: dim ? "grayscale(1)" : "none", opacity: dim ? 0.5 : 1 }} />
              ) : (
                <ZoomableImage src={m.url} alt={alt} dim={dim} fill />
              )}
            </div>
          ))}
        </div>
        {items.length > 1 && (
          <>
            <button className="pdp-arrow" onClick={() => go(idx - 1)} aria-label="Foto anterior" style={{ ...arrowStyle, left: 12, display: "flex" }}><ArrowLeft size={16} color={C.ink} /></button>
            <button className="pdp-arrow" onClick={() => go(idx + 1)} aria-label="Foto siguiente" style={{ ...arrowStyle, right: 12, display: "flex" }}><ChevronRight size={17} color={C.ink} /></button>
            <div style={{ position: "absolute", bottom: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5, pointerEvents: "none" }}>
              {items.map((m, i) => <span key={i} style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: 999, background: i === idx ? C.ink : "rgba(0,0,0,0.25)", transition: "width .2s ease" }} />)}
            </div>
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="pdp-thumbs" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {items.map((m, i) => (
            <button key={m.id || i} onClick={() => go(i)} style={{ width: 62, height: 78, padding: 0, borderRadius: 6, overflow: "hidden", border: `2px solid ${i === idx ? C.ink : "transparent"}`, background: C.paperDeep, cursor: "pointer" }}>
              {m.type === "video"
                ? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 10, color: C.ink }}>Video</div>
                : <ProductImg src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SIZE_CHART_CLOTHING = [
  { talla: "S", busto: "82-86", cintura: "62-66", cadera: "88-92" },
  { talla: "M", busto: "87-91", cintura: "67-71", cadera: "93-97" },
  { talla: "L", busto: "92-97", cintura: "72-77", cadera: "98-103" },
  { talla: "XL", busto: "98-104", cintura: "78-84", cadera: "104-110" },
];
const SIZE_CHART_SHOES = [["35", "22.5"], ["36", "23.2"], ["37", "23.9"], ["38", "24.6"], ["39", "25.3"]];

const SizeGuideModal = ({ category, onClose }) => {
  const isShoes = category === "Calzado";
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 30px", animation: "slideUp .25s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, color: C.ink }}>Guía de tallas</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.ink} /></button>
        </div>
        {isShoes ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Talla PE", "Largo (cm)"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{SIZE_CHART_SHOES.map(([t, cm]) => <tr key={t}><td style={tdStyle}>{t}</td><td style={tdStyle}>{cm}</td></tr>)}</tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Talla", "Busto (cm)", "Cintura (cm)", "Cadera (cm)"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{SIZE_CHART_CLOTHING.map((r) => <tr key={r.talla}><td style={tdStyle}>{r.talla}</td><td style={tdStyle}>{r.busto}</td><td style={tdStyle}>{r.cintura}</td><td style={tdStyle}>{r.cadera}</td></tr>)}</tbody>
          </table>
        )}
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 16, lineHeight: 1.6 }}>Medidas referenciales. Si estás entre dos tallas, te recomendamos elegir la mayor.</div>
      </div>
    </div>
  );
};

const StarRating = ({ value, onChange, size = 15 }) => (
  <div style={{ display: "flex", gap: 3 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" onClick={() => onChange && onChange(n)} disabled={!onChange} style={{ background: "none", border: "none", cursor: onChange ? "pointer" : "default", padding: 0 }}>
        <Star size={size} color={C.brass} fill={n <= value ? C.brass : "none"} />
      </button>
    ))}
  </div>
);

const ReviewForm = ({ onSubmit, onCancel }) => {
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const fileRef = useRef(null);
  const handleFile = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setPhoto(await resizeImageFile(f, 700, 0.75)); } catch (err) { console.error(err); } };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginTop: 12 }}>
      <span style={sheetLabelStyle}>Tu calificación</span>
      <div style={{ marginBottom: 10 }}><StarRating value={rating} onChange={setRating} size={20} /></div>
      <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Tu nombre" style={{ ...inputStyle, marginBottom: 8 }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Cuéntanos qué te pareció…" style={{ ...inputStyle, minHeight: 60, marginBottom: 8 }} />
      {photo && <div style={{ width: 60, height: 60, borderRadius: 8, overflow: "hidden", marginBottom: 8 }}><ProductImg src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>}
      <button onClick={() => fileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, cursor: "pointer", marginBottom: 12 }}><ImageIcon size={13} /> {photo ? "Cambiar foto" : "Agregar foto (opcional)"}</button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
        <button disabled={!author.trim() || !text.trim()} onClick={() => onSubmit({ author: author.trim(), rating, text: text.trim(), photo })}
          style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: (!author.trim() || !text.trim()) ? C.line : C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Publicar reseña</button>
      </div>
    </div>
  );
};

// Ficha de producto a pantalla completa (estilo tienda grande): galería grande arriba
// (o a la izquierda en PC), datos y selección a la derecha, y en celular una barra
// fija abajo con el precio y el botón de compra, siempre a mano.
const ProductSheet = ({ product, onClose, onAdd, fav, onToggleFav, reviews, onAddReview, collections, allProducts, onOpenProduct, catalog, cartSessionId }) => {
  const sizes = productSizes(product);
  const colors = productColors(product);
  const [color, setColor] = useState(colors[0] || null);
  const [size, setSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const scrollRef = useRef(null);
  const soldOut = productSoldOut(product);

  useEffect(() => {
    const firstColor = colors.find((c) => colorTotalStock(product, c.n) > 0) || colors[0] || null;
    setColor(firstColor);
    setSize(sizes.find((s) => variantStock(product, s, firstColor?.n) > 0) || sizes[0]);
    setQty(1); setShowReviewForm(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [product.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !showSizeGuide) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSizeGuide]);

  const effectiveVariantStock = (s, colorName) => {
    const v = product.variants.find((vv) => vv.size === s && vv.colorName === colorName);
    if (!v) return 0;
    return catalog ? availableStock(catalog, v, cartSessionId) : v.stock;
  };
  const stock = product.variants.length ? effectiveVariantStock(size, color?.n) : 0;
  const canAdd = !soldOut && stock > 0;
  const gallery = productGallery(product, color?.n);
  const productReviews = reviews?.[product.id] || [];
  const avgRating = productReviews.length ? productReviews.reduce((a, r) => a + r.rating, 0) / productReviews.length : null;
  const discountPct = product.compareAtPrice && product.compareAtPrice > product.price ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;

  const look = collections?.find((c) => c.productIds.includes(product.id) && c.productIds.length > 1);
  const lookItems = look ? look.productIds.filter((id) => id !== product.id).map((id) => allProducts.find((p) => p.id === id)).filter(Boolean) : [];

  const buyLabel = soldOut ? "Agotado" : canAdd ? "Agregar a la cesta" : !size ? "Elige una talla" : "Sin stock en esta talla";
  const addNow = () => { if (canAdd) onAdd(product, size, color, qty); };

  return (
    <div className="pdp-overlay" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} aria-label="Cerrar" style={{ position: "absolute", inset: 0, background: `${C.scrim}80`, animation: "fadeIn .2s ease", cursor: "pointer" }} />
    <div ref={scrollRef} className="pdp" style={{ position: "relative", height: "calc(100% - 44px)", borderRadius: "16px 16px 0 0", background: C.paper, overflowY: "auto", display: "flex", flexDirection: "column", animation: "sheetUp .3s cubic-bezier(.2,.8,.2,1)", boxShadow: "0 -10px 40px rgba(0,0,0,0.18)" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Cerrar" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, padding: 8 }}><X size={18} /> Cerrar</button>
        <button onClick={() => onToggleFav(product.id)} aria-label={fav ? "Quitar de favoritos" : "Guardar en favoritos"} style={{ width: 38, height: 38, borderRadius: "50%", background: "transparent", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Heart size={17} color={C.ink} fill={fav ? C.ink : "none"} strokeWidth={1.6} />
        </button>
      </div>

      <div className="pdp-wrap" style={{ flex: "1 0 auto", width: "100%", maxWidth: 1180, margin: "0 auto" }}>
        <div className="pdp-gallery" style={{ position: "relative" }}>
          {(soldOut || product.tag) && <Tag label={soldOut ? "Agotado" : product.tag} />}
          <ProductGallery items={gallery} alt={product.name} dim={soldOut} />
        </div>

        <div className="pdp-info" style={{ padding: "20px 20px 28px" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 4 }}>{product.category}</div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{product.name}</h1>
          {avgRating && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <StarRating value={Math.round(avgRating)} />
              <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>{avgRating.toFixed(1)} ({productReviews.length} reseña{productReviews.length !== 1 ? "s" : ""})</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: discountPct ? C.accent : C.ink, fontWeight: 800 }}>{money(product.price)}</span>
            {product.compareAtPrice && <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.stone, textDecoration: "line-through" }}>{money(product.compareAtPrice)}</span>}
            {discountPct > 0 && <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, fontWeight: 600 }}>-{discountPct}%</span>}
          </div>

          {soldOut ? (
            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", marginBottom: 18 }}>
              <AlertCircle size={16} color={C.ink} />
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft }}>Este producto está agotado por ahora.</span>
            </div>
          ) : (
            <>
              {colors.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, marginBottom: 10 }}>Color: <strong style={{ fontWeight: 600 }}>{color?.n}</strong>{colorTotalStock(product, color?.n) === 0 && <span style={{ color: C.stone }}> (agotado)</span>}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {colors.map((c) => {
                      const outOfStock = colorTotalStock(product, c.n) === 0;
                      const thumb = productGallery(product, c.n).find((m) => m.type !== "video" && (m.colorName === c.n));
                      const active = color?.n === c.n;
                      return thumb ? (
                        <button key={c.n} onClick={() => setColor(c)} title={outOfStock ? `${c.n} (agotado)` : c.n} style={{ width: 52, height: 66, padding: 0, borderRadius: 6, overflow: "hidden", border: `2px solid ${active ? C.ink : C.line}`, background: C.paperDeep, cursor: "pointer", opacity: outOfStock ? 0.4 : 1 }}>
                          <ProductImg src={thumb.url} alt={c.n} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        </button>
                      ) : (
                        <button key={c.n} onClick={() => setColor(c)} title={outOfStock ? `${c.n} (agotado)` : c.n} style={{ position: "relative", width: 34, height: 34, borderRadius: "50%", background: c.h, cursor: "pointer", border: active ? `2px solid ${C.ink}` : `1px solid ${C.line}`, boxShadow: active ? `inset 0 0 0 2px ${C.paper}` : "none", opacity: outOfStock ? 0.35 : 1 }}>
                          {outOfStock && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `linear-gradient(to top right, transparent calc(50% - 1px), ${C.ink} calc(50% - 1px), ${C.ink} calc(50% + 1px), transparent calc(50% + 1px))` }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>Talla: <strong style={{ fontWeight: 600 }}>{size || "elige una"}</strong></div>
                  <button onClick={() => setShowSizeGuide(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline", padding: 0 }}>Guía de tallas</button>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sizes.map((s) => {
                    const sStock = effectiveVariantStock(s, color?.n);
                    const active = size === s;
                    return <button key={s} onClick={() => setSize(s)} disabled={sStock === 0} style={{ minWidth: 52, height: 46, padding: "0 10px", borderRadius: 8, cursor: sStock === 0 ? "not-allowed" : "pointer", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 500, border: `1px solid ${active ? C.ink : C.line}`, background: active ? C.ink : "transparent", color: sStock === 0 ? C.line : active ? C.paper : C.ink, textDecoration: sStock === 0 ? "line-through" : "none" }}>{s}</button>;
                  })}
                </div>
                {stock > 0 && stock <= 5 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink, fontWeight: 600, marginTop: 10 }}>Últimas {stock} unidades en esta talla</div>}
                {stock === 0 && size && (() => {
                  const v = product.variants.find((vv) => vv.size === size && vv.colorName === color?.n);
                  const reservedElsewhere = v && v.stock > 0;
                  return <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginTop: 10 }}>{reservedElsewhere ? "Otra clienta la tiene en su cesta ahora mismo. Vuelve a intentar en unos minutos." : "Sin stock en esta combinación."}</div>;
                })()}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 20px" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>Cantidad</div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px" }}>
                  <button aria-label="Menos" onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Minus size={14} color={C.ink} /></button>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 14, minWidth: 14, textAlign: "center" }}>{qty}</span>
                  <button aria-label="Más" onClick={() => setQty((q) => Math.min(stock || 1, q + 1))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Plus size={14} color={C.ink} /></button>
                </div>
              </div>
            </>
          )}

          <div className="pdp-inline-buy" style={{ display: "none", marginBottom: 20 }}>
            <PrimaryButton disabled={!canAdd} onClick={addNow}><ShoppingBag size={16} /> {canAdd ? `${buyLabel} · ${money(product.price * qty)}` : buyLabel}</PrimaryButton>
          </div>

          <div style={{ borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "14px 0", marginBottom: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft }}><Package size={15} color={C.ink} /> Envío gratis en Trujillo desde S/ 200, o recojo en tienda.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft }}><Undo2 size={15} color={C.ink} /> Cambios de talla o color hasta 7 días después de recibir.</div>
          </div>

          {product.description && (
            <div style={{ marginBottom: 22 }}>
              <div style={sheetLabelStyle}>Descripción</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.inkSoft, lineHeight: 1.65 }}>{product.description}</div>
              {product.materials && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginTop: 8 }}><strong style={{ color: C.ink, fontWeight: 600 }}>Composición: </strong>{product.materials}</div>}
            </div>
          )}

          {lookItems.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div style={sheetLabelStyle}>Completa el look</div>
              <div className="hscroll" style={{ display: "flex", gap: 10, overflowX: "auto", scrollbarWidth: "none" }}>
                {lookItems.map((p) => (
                  <button key={p.id} onClick={() => onOpenProduct(p)} style={{ width: 104, flexShrink: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                    <div style={{ borderRadius: 8, overflow: "hidden", marginBottom: 6, background: C.paperDeep }}><ProductImg src={mainImageUrl(p)} alt={p.name} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} /></div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12.5, color: C.ink, fontWeight: 800 }}>{money(p.price)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ ...sheetLabelStyle, marginBottom: 0 }}>Reseñas ({productReviews.length})</div>
              {!showReviewForm && <button onClick={() => setShowReviewForm(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline" }}>Escribir reseña</button>}
            </div>
            {showReviewForm && <ReviewForm onCancel={() => setShowReviewForm(false)} onSubmit={(r) => { onAddReview(product.id, r); setShowReviewForm(false); }} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              {productReviews.length === 0 && !showReviewForm && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Todavía no hay reseñas. Cuéntanos qué te pareció si ya la tienes.</div>}
              {productReviews.slice().sort((a, b) => b.createdAt - a.createdAt).map((r) => (
                <div key={r.id} style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{r.author}</span>
                    <StarRating value={r.rating} size={12} />
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.55, marginBottom: r.photo ? 8 : 0 }}>{r.text}</div>
                  {r.photo && <div style={{ width: 72, height: 72, borderRadius: 8, overflow: "hidden" }}><ProductImg src={r.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="pdp-buybar" style={{ position: "sticky", bottom: 0, zIndex: 20, background: C.paper, borderTop: `1px solid ${C.line}`, padding: "10px 16px calc(10px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: discountPct ? C.accent : C.ink }}>{money(product.price * qty)}</div>
          {!soldOut && size && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>Talla {size}{color ? `, ${color.n}` : ""}</div>}
        </div>
        <PrimaryButton disabled={!canAdd} onClick={addNow} style={{ flex: 1, width: "auto", padding: "14px 16px" }}><ShoppingBag size={16} /> {buyLabel}</PrimaryButton>
      </div>

      {showSizeGuide && createPortal(<SizeGuideModal category={product.category} onClose={() => setShowSizeGuide(false)} />, document.body)}
    </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  CART SCREEN                                                        */
/* ------------------------------------------------------------------ */
const Row = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
    <span style={{ fontFamily: FONT_BODY, fontSize: bold ? 14 : 12.5, color: C.ink, fontWeight: bold ? 600 : 400 }}>{label}</span>
    <span style={{ fontFamily: FONT_DISPLAY, fontSize: bold ? 17 : 12.5, color: C.ink, fontWeight: bold ? 800 : 500 }}>{value}</span>
  </div>
);

const DELIVERY_LABELS = { recojo: "🏬 Recojo en tienda", local: "🛵 Delivery en Trujillo (zona local)", provincia: "🚚 Envío a otra provincia" };

const buildWhatsAppOrderMessage = (cart, subtotal, shipping, discount, promoCode, total, deliveryMethod, deliveryAddress, saleLabel, extraNote) => {
  const lines = [
    "¡Hola Fly Boutique! 👋 Quiero hacer este pedido:", "",
    ...cart.map((i) => `• ${i.name} — Talla ${i.size}, ${i.color?.n} × ${i.qty} — ${money(i.price * i.qty)}`),
    "",
    `Subtotal: ${money(subtotal)}`,
    ...(discount > 0 ? [`Descuento (${promoCode}): -${money(discount)}`] : []),
    `Envío: ${shipping === 0 ? "Gratis" : money(shipping)}`,
    `Total: ${money(total)}`,
    "",
    DELIVERY_LABELS[deliveryMethod] || deliveryMethod,
    ...(deliveryMethod !== "recojo" ? [`Dirección: ${deliveryAddress || "(coordinar dirección)"}`] : []),
    "", `Pedido registrado: ${saleLabel}`,
    ...(extraNote ? [extraNote] : []),
    "", "Quedo atenta a la confirmación. ¡Gracias!",
  ];
  return encodeURIComponent(lines.join("\n"));
};

function loadCulqiScript() {
  return new Promise((resolve, reject) => {
    if (window.CulqiCheckout) return resolve();
    const existing = document.querySelector('script[src="https://js.culqi.com/checkout-js"]');
    if (existing) { existing.addEventListener("load", () => resolve()); existing.addEventListener("error", reject); return; }
    const script = document.createElement("script");
    script.src = "https://js.culqi.com/checkout-js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar Culqi"));
    document.body.appendChild(script);
    setTimeout(() => reject(new Error("timeout")), 4000);
  });
}

const CartScreen = ({ cart, updateQty, removeItem, setScreen, culqiPublicKey, payAccounts, promoCodes, clubMember, onConfirmOrder }) => {
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoMsg, setPromoMsg] = useState(null);
  const [culqiLoading, setCulqiLoading] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("recojo");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerName, setCustomerName] = useState(clubMember?.name || "");
  const [customerPhone, setCustomerPhone] = useState(clubMember?.phone || "");
  const [paymentMethod, setPaymentMethod] = useState("Yape");
  const [confirmedSale, setConfirmedSale] = useState(null);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = cart.length === 0 || deliveryMethod === "recojo" ? 0 : deliveryMethod === "provincia" ? 15 : subtotal >= 200 ? 0 : 12;
  const discount = appliedPromo ? computeDiscount(appliedPromo, subtotal) : 0;
  const total = Math.max(0, subtotal + shipping - discount);
  const earned = Math.round((subtotal - discount) * 0.1);

  const applyPromo = () => {
    const promo = findPromo(promoCodes, promoInput);
    if (!promo) { setPromoMsg({ ok: false, text: "Código no válido" }); return; }
    if (promo.clubOnly && !clubMember) { setPromoMsg({ ok: false, text: "Este código es solo para miembras del Club Fly — regístrate gratis en la pestaña Club Fly." }); return; }
    setAppliedPromo(promo);
    setPromoMsg({ ok: true, text: `Código ${promo.code} aplicado` });
  };

  const [placing, setPlacing] = useState(false);
  const placeOrder = async (extraNote, method) => {
    if (placing) return;
    setPlacing(true);
    // La pestaña de WhatsApp se abre ya (si se espera al servidor, el celular la bloquea)
    let popup = null;
    try { popup = window.open("", "_blank"); } catch (e) { popup = null; }
    const orderCart = cart;
    const sale = await onConfirmOrder({
      cart: orderCart, subtotal, shipping, discount, promoCode: appliedPromo?.code || null, total,
      deliveryMethod, deliveryAddress: deliveryAddress.trim(), customerName: customerName.trim(), customerPhone: customerPhone.trim(), paymentMethod: method,
    });
    setPlacing(false);
    if (!sale) { try { popup && popup.close(); } catch (e) { /* ya cerrada */ } return; }
    const label = `${sale.serie}-${String(sale.numero).padStart(6, "0")}`;
    const msg = buildWhatsAppOrderMessage(orderCart, subtotal, shipping, discount, appliedPromo?.code, total, deliveryMethod, deliveryAddress, label, extraNote);
    const url = `https://wa.me/${STORE_WHATSAPP}?text=${msg}`;
    try { if (popup) popup.location.href = url; } catch (e) { /* bloqueada */ }
    setConfirmedSale({ ...sale, whatsappUrl: url });
  };

  const confirmManualPayment = () => {
    const note = paymentMethod === "Transferencia"
      ? `Pago por transferencia bancaria — adjunto la captura del comprobante.`
      : `Pago por ${paymentMethod} — adjunto la captura del pago.`;
    placeOrder(note, paymentMethod);
  };

  const payWithCulqi = async () => {
    if (!culqiPublicKey) { alert("Aún no se configuró la llave pública de Culqi. Un administrador debe agregarla en Panel → Configuración de pagos."); return; }
    setCulqiLoading(true);
    try {
      await loadCulqiScript();
      const settings = { title: "Fly Boutique", currency: "PEN", amount: Math.round(total * 100) };
      const options = { lang: "auto", installments: true, modal: true, paymentMethods: { tarjeta: true, yape: false, billetera: false, bancaMovil: false, agente: false, cuotealo: false } };
      const config = { settings, options, appearance: { theme: "default" } };
      const culqiInstance = new window.CulqiCheckout(culqiPublicKey, config);
      culqiInstance.culqi = () => {
        if (culqiInstance.token) {
          const tokenId = culqiInstance.token.id;
          culqiInstance.close();
          placeOrder(`Tarjeta validada (token Culqi: ${tokenId}) — pendiente de confirmar el cobro desde el servidor.`, "Tarjeta (Culqi)");
          alert("Tarjeta validada correctamente. El cobro se confirma desde tu servidor (aún no conectado) — mientras tanto se registró el pedido con el token.");
        } else {
          alert("No se pudo validar la tarjeta: " + (culqiInstance.error?.user_message || "intenta de nuevo."));
        }
      };
      culqiInstance.open();
    } catch (err) {
      alert("No se pudo abrir el formulario de Culqi en esta vista previa (el entorno de prueba de Claude bloquea scripts externos). Esto funcionará normalmente una vez que la app esté publicada en tu propio dominio.");
    }
    setCulqiLoading(false);
  };

  if (confirmedSale) {
    const deliveryLabel = confirmedSale.deliveryMethod === "recojo" ? "preparando para que lo recojas en tienda" : confirmedSale.deliveryMethod === "provincia" ? "alistando para enviarlo a tu provincia" : "alistando para el delivery en Trujillo";
    return (
      <div style={{ padding: "18px 20px", textAlign: "center" }}>
        <BadgeLogo size={48} />
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 800, color: C.ink, margin: "16px 0 6px" }}>¡Pedido enviado!</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 4 }}>Pedido {confirmedSale.serie}-{String(confirmedSale.numero).padStart(6, "0")}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, marginBottom: 10, maxWidth: 260, marginLeft: "auto", marginRight: "auto" }}>
          Fly Boutique ya tiene tu pedido y lo está {deliveryLabel}.
        </div>
        {confirmedSale.paymentMethod !== "Tarjeta (Culqi)" && (
          <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 20, maxWidth: 280, marginLeft: "auto", marginRight: "auto", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>
            No olvides adjuntar la captura de tu pago en el mensaje de WhatsApp — así confirmamos más rápido y alistamos tu pedido.
          </div>
        )}
        {confirmedSale.whatsappUrl && (
          <a href={confirmedSale.whatsappUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, maxWidth: 280, margin: "0 auto 16px", padding: "13px 16px", borderRadius: 9, border: `1px solid ${C.ink}`, color: C.ink, textDecoration: "none", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600 }}>
            <MessageCircle size={15} /> ¿No se abrió WhatsApp? Toca aquí
          </a>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {clubMember && <button onClick={() => setScreen("orders")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", background: "transparent", color: C.ink, border: `1px solid ${C.ink}`, padding: "13px 20px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>Ver mi pedido</button>}
          <button onClick={() => setScreen("home")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", background: C.ink, color: C.paper, border: "none", padding: "13px 20px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>Seguir viendo</button>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 420, textAlign: "center" }}>
        <BadgeLogo size={52} />
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "18px 0 6px" }}>Tu bolsa está vacía</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, marginBottom: 22, maxWidth: 240 }}>Explora el catálogo y encuentra piezas que valen la pena.</div>
        <button onClick={() => setScreen("home")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", background: C.ink, color: C.paper, border: "none", padding: "13px 26px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>Ir de compras</button>
      </div>
    );
  }

  const canPlaceManual = customerName.trim() && customerPhone.trim() && (deliveryMethod === "recojo" || deliveryAddress.trim());

  return (
    <div style={{ padding: "18px 20px 20px" }}>
      <Eyebrow>{cart.reduce((a, i) => a + i.qty, 0)} artículos</Eyebrow>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>Mi Cesta</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
        {cart.map((item) => (
          <div key={item.cartId} style={{ display: "flex", gap: 12, paddingBottom: 14, borderBottom: `1px solid ${C.paperDeep}` }}>
            <div style={{ width: 72, height: 90, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.ink, fontWeight: 600, lineHeight: 1.25 }}>{item.name}</div>
                <button onClick={() => removeItem(item.cartId)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Trash2 size={14} color={C.stone} /></button>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, margin: "3px 0 6px" }}>Talla {item.size} · {item.color?.n}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 10px" }}>
                  <button onClick={() => updateQty(item.cartId, -1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Minus size={12} color={C.ink} /></button>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, minWidth: 12, textAlign: "center" }}>{item.qty}</span>
                  <button onClick={() => updateQty(item.cartId, 1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Plus size={12} color={C.ink} /></button>
                </div>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink }}>{money(item.price * item.qty)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <span style={labelStyle}>Entrega</span>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Chip active={deliveryMethod === "recojo"} onClick={() => setDeliveryMethod("recojo")}>Recojo en tienda</Chip>
        <Chip active={deliveryMethod === "local"} onClick={() => setDeliveryMethod("local")}>Delivery en Trujillo</Chip>
        <Chip active={deliveryMethod === "provincia"} onClick={() => setDeliveryMethod("provincia")}>Envío a otra provincia</Chip>
      </div>
      {deliveryMethod !== "recojo" && (
        <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder={deliveryMethod === "provincia" ? "Dirección completa + ciudad/provincia" : "Dirección de entrega en Trujillo"} style={{ ...inputStyle, marginBottom: 10 }} />
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Tu nombre" style={inputStyle} />
        <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Celular" style={inputStyle} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 8, padding: "0 12px" }}>
          <Ticket size={14} color={C.stone} />
          <input value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Código promocional" disabled={!!appliedPromo} style={{ border: "none", outline: "none", padding: "11px 0", fontFamily: FONT_BODY, fontSize: 12.5, flex: 1, background: "transparent", color: C.ink }} />
        </div>
        {appliedPromo ? (
          <button onClick={() => { setAppliedPromo(null); setPromoInput(""); setPromoMsg(null); }} style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, cursor: "pointer" }}>Quitar</button>
        ) : (
          <button onClick={applyPromo} style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, cursor: "pointer" }}>Aplicar</button>
        )}
      </div>
      {promoMsg && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: promoMsg.ok ? C.ink : C.accent, marginBottom: 16 }}>{promoMsg.text}</div>}
      <div style={{ background: C.paperDeep, borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
        <Row label="Subtotal" value={money(subtotal)} />
        {discount > 0 && <Row label={`Descuento (${appliedPromo.code})`} value={`-${money(discount)}`} />}
        <Row label="Envío" value={shipping === 0 ? "Gratis" : money(shipping)} />
        <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
        <Row label="Total" value={money(total)} bold />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontFamily: FONT_BODY, fontSize: 11.5, color: C.brass }}><Star size={12} fill={C.brass} color={C.brass} /> Ganarás {earned} puntos Fly con esta compra</div>
      </div>
      {shipping > 0 && deliveryMethod === "local" && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 16, textAlign: "center" }}>Agrega {money(200 - subtotal)} más para envío gratis en Trujillo</div>}

      <span style={labelStyle}>Método de pago</span>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {["Yape", "Plin", "Transferencia", "Tarjeta"].map((m) => <Chip key={m} active={paymentMethod === m} onClick={() => setPaymentMethod(m)}>{m}</Chip>)}
      </div>

      {paymentMethod === "Yape" && payAccounts?.yapeNumber && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 2 }}>Yapea el total a:</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{payAccounts.yapeNumber}</div>
        </div>
      )}
      {paymentMethod === "Plin" && payAccounts?.plinNumber && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 2 }}>Plinea el total a:</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{payAccounts.plinNumber}</div>
        </div>
      )}
      {paymentMethod === "Transferencia" && (payAccounts?.bankAccount || payAccounts?.bankCCI) && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, lineHeight: 1.7 }}>
          <div>Banco: <strong>{payAccounts.bankName || "—"}</strong></div>
          <div>Cuenta: <strong>{payAccounts.bankAccount || "—"}</strong></div>
          <div>CCI: <strong>{payAccounts.bankCCI || "—"}</strong></div>
        </div>
      )}
      {(paymentMethod === "Yape" || paymentMethod === "Plin" || paymentMethod === "Transferencia") && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertCircle size={15} color={C.ink} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>Realiza el pago y adjunta la captura en el mensaje de WhatsApp que se abrirá — así confirmamos y alistamos tu pedido más rápido.</div>
        </div>
      )}

      {paymentMethod === "Tarjeta" ? (
        <PrimaryButton onClick={payWithCulqi} disabled={culqiLoading}><CreditCard size={16} /> {culqiLoading ? "Abriendo…" : "Pagar con tarjeta (Culqi)"}</PrimaryButton>
      ) : (
        <PrimaryButton onClick={confirmManualPayment} disabled={!canPlaceManual || placing}><MessageCircle size={16} /> {placing ? "Registrando tu pedido…" : "Confirmar pedido por WhatsApp"}</PrimaryButton>
      )}
      {!canPlaceManual && paymentMethod !== "Tarjeta" && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 8, textAlign: "center" }}>Completa tu nombre, celular{deliveryMethod !== "recojo" ? " y dirección" : ""} para continuar.</div>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  LOYALTY + PROFILE SCREENS                                          */
/* ------------------------------------------------------------------ */
const TIERS = [{ n: "Bronce", min: 0 }, { n: "Plata", min: 500 }, { n: "Oro", min: 1200 }];
const REWARDS = [{ n: "Envío gratis", cost: 150, icon: Package }, { n: "S/ 20 de descuento", cost: 300, icon: Gift }, { n: "Acceso anticipado a colección", cost: 450, icon: Sparkles }, { n: "S/ 50 de descuento", cost: 700, icon: Gift }];

const LoyaltyScreen = ({ points, onRedeem, clubMember, onRegister, onLogoutClub, onGoogleSignIn, googlePrefill, turnstileSiteKey }) => {
  if (!clubMember) return <ClubFlySignup onRegister={onRegister} onGoogleSignIn={onGoogleSignIn} googlePrefill={googlePrefill} turnstileSiteKey={turnstileSiteKey} />;
  const tierIdx = points >= 1200 ? 2 : points >= 500 ? 1 : 0;
  const nextTier = TIERS[tierIdx + 1];
  const progress = nextTier ? Math.min(100, ((points - TIERS[tierIdx].min) / (nextTier.min - TIERS[tierIdx].min)) * 100) : 100;
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Eyebrow>Programa de fidelidad</Eyebrow>
        <button onClick={onLogoutClub} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textDecoration: "underline" }}>¿No eres {clubMember.name.split(" ")[0]}? Cerrar sesión</button>
      </div>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>Club Fly</h1>
      <div style={{ borderRadius: 14, padding: "24px 22px", background: C.ink, position: "relative", overflow: "hidden", marginBottom: 22, color: C.paper }}>
        <div style={{ position: "absolute", right: 18, top: 18, opacity: 0.5 }}><BadgeLogo size={28} dark /></div>
        <Eyebrow color={C.brassSoft}>Nivel {TIERS[tierIdx].n}</Eyebrow>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 800, margin: "2px 0 14px" }}>{points} <span style={{ fontSize: 14, fontFamily: FONT_BODY, fontWeight: 400, opacity: 0.75 }}>puntos</span></div>
        {nextTier ? (<><div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.18)", overflow: "hidden", marginBottom: 8 }}><div style={{ height: "100%", width: `${progress}%`, background: C.brass, borderRadius: 999 }} /></div><div style={{ fontFamily: FONT_BODY, fontSize: 11.5, opacity: 0.8 }}>{nextTier.min - points} puntos para nivel {nextTier.n}</div></>) : <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, opacity: 0.8 }}>Has alcanzado el nivel máximo</div>}
      </div>
      <SectionTitle title="Cómo ganar puntos" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 20px", marginBottom: 26 }}>
        {[["1 punto por cada S/ 10 en compras", Sparkles], ["50 puntos al crear tu cuenta", Award], ["30 puntos por cada reseña que escribas", Star]].map(([text, Icon], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: C.paperDeep, borderRadius: 10, padding: "12px 14px" }}><div style={{ width: 32, height: 32, borderRadius: "50%", background: C.paperDeep, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={14} color={C.brass} /></div><span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{text}</span></div>
        ))}
      </div>
      <SectionTitle title="Canjea tus puntos" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 20px" }}>
        {REWARDS.map((r) => { const enough = points >= r.cost; const Icon = r.icon;
          return (
            <div key={r.n} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", borderRadius: 10, border: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 34, height: 34, borderRadius: "50%", background: C.brassSoft, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={15} color={C.brass} /></div><div><div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.ink, fontWeight: 600 }}>{r.n}</div><div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{r.cost} puntos</div></div></div>
              <button disabled={!enough} onClick={() => onRedeem(r)} style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, padding: "8px 14px", borderRadius: 999, border: "none", cursor: enough ? "pointer" : "not-allowed", background: enough ? C.ink : C.line, color: enough ? C.paper : C.stone }}>Canjear</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PROFILE_MENU = [{ label: "Mis pedidos", icon: Package }, { label: "Direcciones", icon: MapPin }, { label: "Métodos de pago", icon: CreditCard }, { label: "Notificaciones", icon: Bell }, { label: "Ajustes", icon: Settings2 }];

const FOOTER_SECTIONS = [
  { title: "Ayuda", body: "¿Tienes una duda sobre tu pedido, una prenda o el estado de tu compra? Escríbenos por WhatsApp y te respondemos directamente — es la forma más rápida de resolverlo. También puedes visitarnos en Av. Larco 126, Trujillo, o seguirnos en Instagram y TikTok (@flyboutiqueperu)." },
  { title: "Guía de tallas", body: "Cada prenda tiene su propia guía de tallas (busto, cintura, cadera) disponible al abrirla, en el botón 'Guía de tallas' junto al selector de talla. Si tienes dudas entre dos tallas, escríbenos por WhatsApp con tus medidas y te recomendamos la que mejor te quede." },
  { title: "Seguridad y protección de datos", body: "Tus datos (nombre, celular, correo, pedidos) se usan únicamente para procesar tus compras, coordinar envíos y, si te unes al Club Fly, enviarte promociones. No vendemos tu información a terceros. De acuerdo con la Ley N.º 29733 de Protección de Datos Personales del Perú, puedes pedirnos acceder, corregir o eliminar tus datos cuando quieras, escribiéndonos por WhatsApp." },
  { title: "Derecho de desistimiento", body: "Si compraste online y cambias de opinión, tienes 7 días calendario desde que recibes el pedido para solicitar la devolución, siempre que la prenda esté sin uso, con etiquetas y en su empaque original. Coordinamos la recogida o el punto de entrega en Trujillo, sin costo para ti si el motivo es un defecto de fábrica." },
  { title: "Trabaja con nosotros", body: "Fly es una boutique familiar en Trujillo. Si te interesa formar parte del equipo (ventas en tienda o atención online), cuéntanos sobre ti con el formulario de abajo — no siempre tenemos vacantes abiertas, pero guardamos los contactos para cuando sí las haya.", isJobForm: true },
  { title: "Política de devoluciones", body: "Tienes 7 días calendario desde que recibes tu pedido para solicitar un cambio de talla o color, siempre que la prenda esté sin uso, con etiquetas y en su empaque original. Las prendas en oferta final y los aretes no tienen cambio por temas de higiene, salvo defecto de fábrica. Si la prenda llega con algún defecto, el cambio o la devolución no tiene costo para ti." },
];

const JOB_ROLES = ["Ventas en tienda", "Atención online", "Community manager", "Otro"];
const CV_MAX_MB = 5;

const JobApplicationForm = ({ onClose }) => {
  const [form, setForm] = useState({ nombre: "", apellidos: "", email: "", telefono: "", puesto: JOB_ROLES[0], mensaje: "" });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const nameValid = form.nombre.trim().length >= 2;
  const lastNameValid = form.apellidos.trim().length >= 2;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const phoneValid = /^[0-9+\s-]{7,15}$/.test(form.telefono.trim());
  const canSubmit = nameValid && lastNameValid && emailValid && phoneValid && !fileError;

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); setFileError(""); return; }
    const okType = /\.(pdf|doc|docx)$/i.test(f.name);
    if (!okType) { setFile(null); setFileError("Solo se aceptan archivos PDF o Word (.pdf, .doc, .docx)."); return; }
    if (f.size > CV_MAX_MB * 1024 * 1024) { setFile(null); setFileError(`El archivo pesa más de ${CV_MAX_MB} MB — comprímelo o usa un PDF más liviano.`); return; }
    setFile(f); setFileError("");
  };

  const [sendVia, setSendVia] = useState("whatsapp");
  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    if (sendVia === "email") {
      const subject = `Postulación — ${form.puesto} — ${form.nombre} ${form.apellidos}`;
      const body = `Nombre: ${form.nombre} ${form.apellidos}\nCorreo: ${form.email}\nCelular: ${form.telefono}\nPuesto de interés: ${form.puesto}\n${form.mensaje ? "Sobre mí: " + form.mensaje + "\n" : ""}${file ? "(Voy a adjuntar mi CV: " + file.name + " a este correo)" : ""}`;
      window.open(`mailto:${STORE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
    } else {
      const msg = `Hola Fly! Quiero postular a trabajar con ustedes.%0A%0ANombre: ${form.nombre} ${form.apellidos}%0ACorreo: ${form.email}%0ACelular: ${form.telefono}%0APuesto de interés: ${form.puesto}%0A${form.mensaje ? "Sobre mí: " + form.mensaje + "%0A" : ""}${file ? "(Voy a adjuntar mi CV: " + file.name + " en este chat)" : ""}`;
      window.open(`https://wa.me/${STORE_WHATSAPP}?text=${msg}`, "_blank");
    }
    setSent(true);
  };

  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 13, background: C.white, color: C.ink };
  const errStyle = { fontFamily: FONT_BODY, fontSize: 10.5, color: C.accent, marginTop: 4 };
  const labelStyle = { fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 5, display: "block" };

  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.white, borderRadius: "18px 18px 0 0", padding: "22px 20px 28px", maxHeight: "85%", overflowY: "auto", animation: "slideUp .25s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>Trabaja con nosotros</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.stone} /></button>
        </div>

        {sent ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <Check size={30} color={C.ink} style={{ marginBottom: 10 }} />
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, fontWeight: 600, marginBottom: 6 }}>{sendVia === "email" ? "¡Listo, se abrió tu correo!" : "¡Listo, se abrió WhatsApp!"}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, lineHeight: 1.6 }}>{file ? <>No olvides <strong>adjuntar tu archivo "{file.name}"</strong> manualmente {sendVia === "email" ? "a ese correo" : "en ese chat"} antes de enviarlo — no se adjunta solo.</> : `Envía el mensaje ${sendVia === "email" ? "desde tu correo" : "en WhatsApp"} para completar tu postulación.`}</div>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, lineHeight: 1.6, marginBottom: 18 }}>Fly es una boutique familiar en Trujillo. Cuéntanos sobre ti — guardamos tu contacto para cuando tengamos una vacante que encaje contigo.</div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>¿Cómo prefieres enviarla?</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSendVia("whatsapp")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${sendVia === "whatsapp" ? C.ink : C.line}`, background: sendVia === "whatsapp" ? C.ink : "transparent", color: sendVia === "whatsapp" ? C.white : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>WhatsApp</button>
                <button onClick={() => setSendVia("email")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${sendVia === "email" ? C.ink : C.line}`, background: sendVia === "email" ? C.ink : "transparent", color: sendVia === "email" ? C.white : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Correo</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />{touched && !nameValid && <div style={errStyle}>Requerido</div>}</div>
              <div><label style={labelStyle}>Apellidos</label><input style={inputStyle} value={form.apellidos} onChange={(e) => set("apellidos", e.target.value)} />{touched && !lastNameValid && <div style={errStyle}>Requerido</div>}</div>
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Correo electrónico</label><input style={inputStyle} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />{touched && !emailValid && <div style={errStyle}>Correo inválido</div>}</div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Celular</label><input style={inputStyle} value={form.telefono} onChange={(e) => set("telefono", e.target.value)} />{touched && !phoneValid && <div style={errStyle}>Celular inválido</div>}</div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Puesto de interés</label>
              <select style={inputStyle} value={form.puesto} onChange={(e) => set("puesto", e.target.value)}>{JOB_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>Cuéntanos sobre ti (opcional)</label><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.mensaje} onChange={(e) => set("mensaje", e.target.value)} /></div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>CV (PDF o Word, máx. {CV_MAX_MB}MB) — opcional</label>
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleFile} style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink }} />
              {fileError && <div style={errStyle}>{fileError}</div>}
              {file && !fileError && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 4 }}>✓ {file.name}</div>}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone, lineHeight: 1.5, marginBottom: 16 }}>Tus datos se usan solo para evaluar tu postulación, según nuestra política de protección de datos.</div>
            <PrimaryButton onClick={submit}>{sendVia === "email" ? "Enviar postulación por correo" : "Enviar postulación por WhatsApp"}</PrimaryButton>
          </>
        )}
      </div>
    </div>
  );
};

// Pantalla completa de ayuda — navega como cualquier otra sección de la app
// (con botón de volver), en vez de desplegarse encima del contenido.
const InfoScreen = ({ sectionIndex, setScreen }) => {
  const [active, setActive] = useState(sectionIndex ?? 0);
  const [showJobForm, setShowJobForm] = useState(false);
  const section = FOOTER_SECTIONS[active];
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <button onClick={() => setScreen("home")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 18, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.ink, fontWeight: 800, margin: "0 0 18px", textAlign: "center" }}>Ayuda e información</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 24, paddingBottom: 18, borderBottom: `1px solid ${C.line}` }}>
          {FOOTER_SECTIONS.map((s, i) => (
            <button key={s.title} onClick={() => setActive(i)} style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, color: active === i ? C.white : C.ink, background: active === i ? C.ink : C.paperDeep, border: `1px solid ${active === i ? C.ink : C.line}`, borderRadius: 999, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap" }}>{s.title}</button>
          ))}
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 12, textAlign: "center" }}>{section.title}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.inkSoft, lineHeight: 1.8, textAlign: "justify" }}>{section.body}</div>
        {section.isJobForm && <div style={{ textAlign: "center" }}><button onClick={() => setShowJobForm(true)} style={{ marginTop: 18, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.white, background: C.ink, border: "none", borderRadius: 8, padding: "12px 18px", cursor: "pointer" }}>Enviar mi postulación</button></div>}
        <div style={{ marginTop: 40, fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textAlign: "center" }}>Fly — Av. Larco 126, Trujillo, Perú · @flyboutiqueperu</div>
      </div>
      {showJobForm && <JobApplicationForm onClose={() => setShowJobForm(false)} />}
    </div>
  );
};

const InfoFooter = ({ onOpenInfo }) => (
  <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 20, padding: "18px 0 22px" }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 10, padding: "0 20px" }}>Ayuda e información</div>
    <div className="hscroll" style={{ display: "flex", gap: 16, overflowX: "auto", padding: "0 20px", scrollbarWidth: "none" }}>
      {FOOTER_SECTIONS.map((s, i) => (
        <button key={s.title} onClick={() => onOpenInfo(i)} style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, fontWeight: 500, background: "none", border: "none", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", whiteSpace: "nowrap", padding: "4px 2px" }}>{s.title}</button>
      ))}
    </div>
    <div style={{ marginTop: 14, fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textAlign: "center", padding: "0 20px" }}>Fly, Av. Larco 126, Trujillo, Perú. @flyboutiqueperu</div>
  </div>
);

const PolicyModal = ({ onClose }) => (
  <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
    <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 30px", maxHeight: "80%", overflowY: "auto", animation: "slideUp .25s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, color: C.ink }}>Cambios y devoluciones</div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.ink} /></button>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.8 }}>
        <p>Tienes <strong>7 días calendario</strong> desde que recibes tu pedido para solicitar un cambio de talla o color, siempre que la prenda esté sin uso, con etiquetas y en su empaque original.</p>
        <p>Para iniciar un cambio o devolución, escríbenos por WhatsApp con tu número de pedido y el motivo — coordinamos la recogida o el punto de entrega en Trujillo.</p>
        <p>Las prendas en oferta final o los accesorios en aretes no tienen cambio por temas de higiene, salvo defecto de fábrica.</p>
        <p>Si la prenda llega con algún defecto, el cambio o la devolución del dinero no tiene costo para ti.</p>
      </div>
    </div>
  </div>
);

const SocialLinks = () => {
  const iconStyle = { width: 38, height: 38, borderRadius: "50%", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 18 }}>
      <a href="https://instagram.com/flyboutiqueperu" target="_blank" rel="noreferrer" style={iconStyle}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="5" stroke={C.ink} strokeWidth="1.6" /><circle cx="12" cy="12" r="4" stroke={C.ink} strokeWidth="1.6" /><circle cx="17.2" cy="6.8" r="1.1" fill={C.ink} /></svg>
      </a>
      <a href="https://facebook.com/flyboutiqueperu" target="_blank" rel="noreferrer" style={iconStyle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 4h-2.5C10.6 4 9 5.6 9 7.5V10H6.5v3.5H9V20h3.5v-6.5h2.7l.5-3.5h-3.2V7.8c0-.7.4-1.1 1.1-1.1H15V4z" fill={C.ink} /></svg>
      </a>
      <a href="https://tiktok.com/@flyboutiqueperu" target="_blank" rel="noreferrer" style={iconStyle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16 3c.4 2 1.8 3.4 4 3.6v3c-1.5 0-2.9-.4-4-1.2v6.3c0 3.3-2.7 5.9-6 5.5-2.6-.3-4.7-2.4-5-5-.4-3.3 2.2-6.1 5.4-6.1.4 0 .7 0 1.1.1v3.2a2.6 2.6 0 1 0 1.8 2.5V3H16z" fill={C.ink} /></svg>
      </a>
    </div>
  );
};

// Captcha de Cloudflare (Turnstile). Casi siempre se resuelve solo, sin que la clienta haga nada.
let turnstileScript = null;
const loadTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      sc.async = true;
      sc.onload = () => resolve(window.turnstile);
      sc.onerror = () => { turnstileScript = null; reject(new Error("No se pudo cargar el captcha")); };
      document.head.appendChild(sc);
    });
  }
  return turnstileScript;
};
const TurnstileBox = ({ siteKey, onToken }) => {
  const boxRef = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let id = null; let alive = true;
    loadTurnstile().then((ts) => {
      if (!alive || !boxRef.current) return;
      id = ts.render(boxRef.current, {
        sitekey: siteKey, theme: "light", language: "es",
        callback: (t) => onToken(t), "expired-callback": () => onToken(""), "error-callback": () => onToken(""),
      });
    }).catch(() => setFailed(true));
    return () => { alive = false; try { if (id !== null && window.turnstile) window.turnstile.remove(id); } catch (e) { /* ya removido */ } };
  }, [siteKey]);
  if (failed) return <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.accent, marginTop: 10 }}>No se pudo cargar la verificación. Revisa tu conexión y recarga la página.</div>;
  return <div ref={boxRef} style={{ display: "flex", justifyContent: "center", marginTop: 12, minHeight: 66 }} />;
};

const ClubFlySignup = ({ onRegister, onGoogleSignIn, googlePrefill, turnstileSiteKey }) => {
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [name, setName] = useState(googlePrefill?.name || "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(googlePrefill?.email || "");
  const [humanA, setHumanA] = useState(0);
  const [humanB, setHumanB] = useState(0);
  const [humanAnswer, setHumanAnswer] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => { setHumanA(Math.ceil(Math.random() * 6) + 1); setHumanB(Math.ceil(Math.random() * 6) + 1); }, []);
  useEffect(() => { if (googlePrefill) { setName(googlePrefill.name || ""); setEmail(googlePrefill.email || ""); } }, [googlePrefill]);

  const nameValid = name.trim().length >= 3;
  const phoneValid = /^[0-9+\s-]{7,15}$/.test(phone.trim());
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const humanValid = turnstileSiteKey ? !!captchaToken : Number(humanAnswer) === humanA + humanB;
  const canSubmit = nameValid && phoneValid && emailValid && humanValid;

  const fieldError = (ok, msg) => (touched && !ok ? <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.accent, marginTop: -6, marginBottom: 8, textAlign: "left" }}>{msg}</div> : null);

  return (
    <div style={{ padding: "22px 20px 24px", textAlign: "center" }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink, margin: "0 0 6px" }}>Únete al Club Fly</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 20, maxWidth: 260, marginLeft: "auto", marginRight: "auto" }}>Regístrate gratis y empieza a ganar puntos en cada compra.</div>

      {onGoogleSignIn && !googlePrefill && (
        <div style={{ maxWidth: 280, margin: "0 auto 18px" }}>
          <button onClick={onGoogleSignIn} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.white, color: C.ink, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 5.1 29.6 3 24 3c-7.4 0-13.8 4.1-17.1 10.1z"/><path fill="#4CAF50" d="M24 45c5.5 0 10.4-1.9 14.3-5.2l-6.6-5.6C29.5 35.9 26.9 37 24 37c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 40.6 16.4 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.4l6.6 5.6C40.5 36.9 44 31.3 44 24c0-1.4-.1-2.4-.4-3.5z"/></svg>
            Continuar con Google
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
            <div style={{ flex: 1, height: 1, background: C.line }} /><span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>o con tus datos</span><div style={{ flex: 1, height: 1, background: C.line }} />
          </div>
        </div>
      )}
      {googlePrefill && (
        <div style={{ maxWidth: 280, margin: "0 auto 18px", background: C.paperDeep, borderRadius: 10, padding: "12px 14px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink }}>
          ✓ Sesión de Google conectada — solo falta tu celular para terminar.
        </div>
      )}

      <div style={{ textAlign: "left", maxWidth: 280, margin: "0 auto" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" style={{ ...inputStyle, marginBottom: 6 }} />
        {fieldError(nameValid, "Escribe tu nombre completo (mínimo 3 letras).")}

        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular (WhatsApp)" style={{ ...inputStyle, marginTop: 8, marginBottom: 6 }} />
        {fieldError(phoneValid, "Ingresa un número de celular válido.")}

        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" type="email" autoComplete="email" style={{ ...inputStyle, marginTop: 8, marginBottom: 6 }} />
        {fieldError(emailValid, "Ingresa tu correo (ej. nombre@gmail.com).")}

        {turnstileSiteKey ? (
          <>
            <TurnstileBox key={captchaKey} siteKey={turnstileSiteKey} onToken={setCaptchaToken} />
            {fieldError(humanValid, "Espera a que se complete la verificación de arriba.")}
          </>
        ) : (
          <>
            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginTop: 10, marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, whiteSpace: "nowrap" }}>Para confirmar que eres humana: {humanA} + {humanB} =</span>
              <input value={humanAnswer} onChange={(e) => setHumanAnswer(e.target.value)} style={{ ...inputStyle, width: 56, padding: "6px 8px", textAlign: "center" }} />
            </div>
            {fieldError(humanValid, "La suma no es correcta, intenta de nuevo.")}
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <PrimaryButton disabled={sending} onClick={async () => {
            setTouched(true);
            if (!(nameValid && phoneValid && emailValid && humanValid) || sending) return;
            setSending(true);
            const ok = await onRegister({ name: name.trim(), phone: phone.trim(), email: email.trim(), captcha: captchaToken });
            setSending(false);
            // El código del captcha sirve una sola vez: si algo falló, se pide uno nuevo
            if (!ok) { setCaptchaToken(""); setCaptchaKey((k) => k + 1); }
          }}>{sending ? "Registrando…" : "Registrarme"}</PrimaryButton>
        </div>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone, marginTop: 16, maxWidth: 260, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
        Tus datos solo se usan para tu cuenta del Club Fly y tus pedidos. Nunca los compartimos.
      </div>
    </div>
  );
};

const ORDER_STATUS_LABELS = { pendiente: "Pendiente", preparando: "Preparando", listo: "Listo", entregado: "Entregado / Enviado" };

const OrdersScreen = ({ catalog, clubMember, setScreen }) => {
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (!clubMember?.phone) return;
    supabase.rpc("my_orders", { p_phone: clubMember.phone }).then(({ data }) => setFetched(data || [])).catch(() => setFetched([]));
  }, [clubMember?.phone]);
  const backBtn = (
    <button onClick={() => setScreen("profile")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
  );
  if (!clubMember) {
    return (
      <div style={{ padding: "18px 20px 24px" }}>
        {backBtn}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, textAlign: "center" }}>
          <Package size={30} color={C.line} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, maxWidth: 240 }}>Regístrate en el Club Fly para ver tu historial de pedidos aquí.</div>
        </div>
      </div>
    );
  }
  const orders = fetched || [];
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      {backBtn}
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>Mis Pedidos</h1>
      {fetched === null ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, padding: "30px 0", textAlign: "center" }}>Cargando tus pedidos…</div>
      ) : orders.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, textAlign: "center" }}>
          <Package size={30} color={C.line} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, maxWidth: 240 }}>Aún no tienes pedidos. Cuando compres algo, lo vas a ver aquí.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orders.map((o) => {
            const validated = o.paymentStatus === "confirmado";
            return (
              <div key={o.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{o.serie}-{String(o.numero).padStart(6, "0")}</div>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink }}>{money(o.total)}</span>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 10 }}>{new Date(o.createdAt).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" })}</div>
                <div style={{ borderTop: `1px solid ${C.paperDeep}`, paddingTop: 10, marginBottom: 10 }}>
                  {o.items.map((it, i) => <div key={i} style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink, marginBottom: 3 }}>• {it.name} — {it.size}/{it.colorName} × {it.qty}</div>)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, fontWeight: 700, background: validated ? C.paperDeep : "transparent", color: C.ink, border: `1px solid ${validated ? C.paperDeep : C.ink}` }}>
                    {validated ? "Pago confirmado" : "Validando pago"}
                  </span>
                  {validated && (
                    <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, fontWeight: 700, background: C.ink, color: C.paper }}>
                      {ORDER_STATUS_LABELS[o.fulfillment] || "Pendiente"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ProfileScreen = ({ points, favCount, onStaffClick, clubMember, onLogoutClub, setScreen, catalog }) => {
  const [orderCount, setOrderCount] = useState(0);
  useEffect(() => {
    if (!clubMember?.phone) { setOrderCount(0); return; }
    supabase.rpc("my_orders", { p_phone: clubMember.phone }).then(({ data }) => setOrderCount((data || []).length)).catch(() => {});
  }, [clubMember?.phone]);
  const [showPolicy, setShowPolicy] = useState(false);
  const menu = [{ ...PROFILE_MENU[0], action: () => setScreen("orders") }, ...PROFILE_MENU.slice(1, 4), { label: "Cambios y devoluciones", icon: Undo2, action: () => setShowPolicy(true) }, PROFILE_MENU[4]];
  const initials = clubMember ? clubMember.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() : "?";
  return (
    <div style={{ padding: "18px 20px 24px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div style={{ width: 62, height: 62, borderRadius: "50%", background: C.paperDeep, border: `1.5px solid ${C.ink}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800 }}>{initials}</div>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800 }}>{clubMember ? clubMember.name : "Invitada"}</div>
          {clubMember ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}><Award size={12} color={C.brass} /><span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.brass }}>Miembra Club Fly</span></div>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 3 }}>Aún no eres del Club Fly</div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {[["Pedidos", clubMember ? String(orderCount) : "—"], ["Favoritos", String(favCount)], ["Puntos", clubMember ? String(points) : "—"]].map(([label, val]) => (
          <div key={label} style={{ flex: 1, textAlign: "center", background: C.paperDeep, borderRadius: 10, padding: "14px 6px" }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.ink, fontWeight: 800 }}>{val}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginTop: 2 }}>{label}</div></div>
        ))}
      </div>
      <button onClick={() => setScreen("loyalty")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: C.ink, color: C.paper, border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 20, cursor: "pointer" }}>
        <Star size={16} fill={C.brass} color={C.brass} />
        <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, flex: 1, textAlign: "left" }}>Club Fly {clubMember ? `— ${points} puntos` : "— únete gratis"}</span>
        <ChevronRight size={15} color={C.paper} />
      </button>
      <div style={{ borderRadius: 12, border: `1px solid ${C.line}`, overflow: "hidden", marginBottom: 20 }}>
        {menu.map(({ label, icon: Icon, action }, i) => (
          <div key={label} onClick={action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderBottom: i < menu.length - 1 ? `1px solid ${C.paperDeep}` : "none", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Icon size={16} color={C.ink} strokeWidth={1.6} /><span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{label}</span></div><ChevronRight size={15} color={C.stone} />
          </div>
        ))}
      </div>
      {clubMember && (
        <button onClick={onLogoutClub} style={{ width: "100%", padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", marginBottom: 22 }}><LogOut size={15} /> Cerrar sesión</button>
      )}
      <SocialLinks />
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, letterSpacing: "0.06em" }}>@flyboutiqueperu</div>
      </div>
      {showPolicy && <PolicyModal onClose={() => setShowPolicy(false)} />}
    </div>
  );
};

const CookieConsent = ({ onAcceptAll, onEssentialOnly }) => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 90, background: C.ink, padding: "18px 20px calc(18px + env(safe-area-inset-bottom))", animation: "slideUp .3s cubic-bezier(.2,.8,.2,1)" }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.paper, marginBottom: 8 }}>Valoramos tu privacidad</div>
    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: `${C.paper}CC`, lineHeight: 1.6, marginBottom: 16 }}>
      Usamos cookies para que la tienda funcione bien y recordar tu carrito y preferencias. No vendemos tus datos a terceros. Puedes leer más en nuestra Política de Privacidad.
    </div>
    <div style={{ display: "flex", gap: 10 }}>
      <button onClick={onEssentialOnly} style={{ flex: 1, padding: "12px", borderRadius: 9, border: `1px solid rgba(255,255,255,0.3)`, background: "transparent", color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Solo lo esencial</button>
      <button onClick={onAcceptAll} style={{ flex: 1, padding: "12px", borderRadius: 9, border: "none", background: C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Aceptar todo</button>
    </div>
  </div>
);

const Toast = ({ message }) => (
  <div className="app-toast" style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 95, background: C.ink, color: C.paper, padding: "11px 20px", borderRadius: 999, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(21,19,18,0.35)", animation: "toastIn .25s ease", whiteSpace: "nowrap" }}><Check size={14} color={C.brass} /> {message}</div>
);

/* ==================================================================== */
/*  ============================  ADMIN  ==============================*/
/* ==================================================================== */
const inputStyle = { width: "100%", padding: "11px 12px", borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 13, color: C.ink, background: C.paperDeep, outline: "none" };
const labelStyle = { fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.stone, fontWeight: 600, marginBottom: 6, display: "block" };
const Field = ({ label, children }) => <div style={{ marginBottom: 16 }}><span style={labelStyle}>{label}</span>{children}</div>;
const AdminCard = ({ children, style }) => <div style={{ background: C.paperDeep, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;

/* ------------------------------------------------------------------ */
/*  ACCESO DEL STAFF — Supabase Auth + verificación en dos pasos        */
/* ------------------------------------------------------------------ */
// El staff entra con usuario + contraseña. Por dentro, cada usuario es una cuenta de
// Supabase Auth con un correo interno (usuario@staff.flyboutique.pe) que no recibe
// mensajes: solo sirve para que Supabase guarde la contraseña cifrada.
const STAFF_EMAIL_DOMAIN = "staff.flyboutique.pe";
const staffEmail = (username) => `${String(username || "").trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
const ROLES_WITH_MFA = ["superadmin", "administrador"];
const STAFF_IDLE_MINUTES = 30;

const LOGIN_LOCK_KEY = "flyboutique:loginlock:v1";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

// Mira la sesión guardada y decide qué falta: nada, pedir el código, o configurar la app autenticadora.
async function resolveStaffSession() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { step: "login" };
  const { data: profile } = await supabase.from("staff_profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { step: "login", error: "Esta cuenta no tiene acceso al panel." };
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") return { step: "done", profile };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const all = factors?.all || factors?.totp || [];
  const verified = all.find((f) => f.factor_type === "totp" && f.status === "verified");
  if (verified) return { step: "challenge", profile, factorId: verified.id };
  if (ROLES_WITH_MFA.includes(profile.role)) return { step: "enroll", profile };
  return { step: "done", profile };
}

const darkInput = (err) => ({ ...inputStyle, background: "rgba(255,255,255,0.06)", border: `1px solid ${err ? C.accent : "rgba(255,255,255,0.3)"}`, color: C.paper });
const darkBtn = { flex: 1, padding: "13px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" };
const lightBtn = { flex: 1, padding: "13px", borderRadius: 9, border: "none", background: C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const errText = { fontFamily: FONT_BODY, fontSize: 12, color: "#F0A8A8", marginTop: 8, textAlign: "center" };

const StaffAccess = ({ onDone, onCancel }) => {
  const [step, setStep] = useState("checking");
  const [profile, setProfile] = useState(null);
  const [factorId, setFactorId] = useState(null);
  const [enrollData, setEnrollData] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(LOGIN_LOCK_KEY); if (raw) { const { attempts: a, lockedUntil: l } = JSON.parse(raw); setAttempts(a || 0); setLockedUntil(l || 0); } } catch (e) { /* sin datos previos */ }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const saveLock = (a, l) => { try { localStorage.setItem(LOGIN_LOCK_KEY, JSON.stringify({ attempts: a, lockedUntil: l })); } catch (e) { /* no disponible */ } };
  const isLocked = lockedUntil > now;
  const secondsLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  const apply = async (res) => {
    setProfile(res.profile || null);
    if (res.error) setErr(res.error);
    if (res.step === "done") { onDone(res.profile); return; }
    if (res.step === "challenge") setFactorId(res.factorId);
    if (res.step === "enroll") await startEnroll();
    setStep(res.step);
  };
  useEffect(() => { resolveStaffSession().then(apply).catch(() => setStep("login")); }, []);

  const startEnroll = async () => {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of (factors?.all || [])) { if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id }); }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Fly ${new Date().toISOString().slice(0, 16)}` });
    if (error) { setErr("No se pudo preparar la verificación: " + error.message); return; }
    setEnrollData({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const login = async () => {
    if (isLocked || busy || !username.trim() || !password) return;
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: staffEmail(username), password });
    if (error) {
      setBusy(false);
      const next = attempts + 1;
      if (next >= MAX_ATTEMPTS) { const until = Date.now() + LOCK_MINUTES * 60 * 1000; setAttempts(0); setLockedUntil(until); saveLock(0, until); }
      else { setAttempts(next); saveLock(next, 0); }
      setErr(`Usuario o contraseña incorrectos. Te quedan ${Math.max(0, MAX_ATTEMPTS - next)} intentos.`);
      return;
    }
    setAttempts(0); saveLock(0, 0); setPassword("");
    try { await apply(await resolveStaffSession()); } catch (e) { setErr("No se pudo verificar tu cuenta. Revisa tu conexión."); }
    setBusy(false);
  };

  const verifyCode = async () => {
    const id = step === "enroll" ? enrollData?.factorId : factorId;
    if (!id || code.trim().length !== 6 || busy) return;
    setBusy(true); setErr("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
    setBusy(false);
    if (error) { setErr("Código incorrecto o vencido. Escribe el código que aparece ahora en la app."); setCode(""); return; }
    onDone(profile);
  };

  const cancel = async () => { if (step !== "login" && step !== "checking") await supabase.auth.signOut(); onCancel(); };

  const shell = (children) => (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: C.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, overflowY: "auto" }}>
      <BadgeLogo size={44} dark />
      {children}
    </div>
  );
  const title = (t, sub) => (
    <>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.paper, fontWeight: 800, margin: "16px 0 6px", textAlign: "center" }}>{t}</div>
      {sub && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: `${C.paper}AA`, marginBottom: 20, textAlign: "center", maxWidth: 300, lineHeight: 1.55 }}>{sub}</div>}
    </>
  );
  const codeInput = (
    <input value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(""); }} inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
      onKeyDown={(e) => e.key === "Enter" && verifyCode()} style={{ ...darkInput(!!err), textAlign: "center", letterSpacing: "0.35em", fontSize: 22, maxWidth: 240 }} />
  );

  if (step === "checking") return shell(<div className="spin" style={{ marginTop: 24, width: 22, height: 22, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.25)", borderTopColor: C.paper }} />);

  if (step === "challenge") return shell(
    <>
      {title("Verificación en dos pasos", `Hola ${profile?.name?.split(" ")[0] || ""}. Abre tu app autenticadora (Google Authenticator) y escribe el código de 6 dígitos de Fly.`)}
      {codeInput}
      {err && <div style={errText}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 18, width: "100%", maxWidth: 260 }}>
        <button onClick={cancel} style={darkBtn}>Salir</button>
        <button onClick={verifyCode} disabled={busy || code.length !== 6} style={{ ...lightBtn, opacity: busy || code.length !== 6 ? 0.5 : 1 }}>{busy ? "Verificando…" : "Entrar"}</button>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: `${C.paper}66`, marginTop: 22, textAlign: "center", maxWidth: 280, lineHeight: 1.6 }}>¿Perdiste tu celular? Pide a la Super Admin que reinicie tu verificación desde Usuarios.</div>
    </>
  );

  if (step === "enroll") return shell(
    <>
      {title("Activa la verificación en dos pasos", "Tu rol tiene acceso a ventas y datos de clientas, así que además de la contraseña vas a usar un código que cambia cada 30 segundos.")}
      <div style={{ width: "100%", maxWidth: 320, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.paper, lineHeight: 1.7 }}>
          1. Instala <strong>Google Authenticator</strong> en tu celular (Play Store o App Store).<br />
          2. En la app toca <strong>+</strong> y luego <strong>Escanear código QR</strong>.<br />
          3. Escribe aquí el código de 6 dígitos que aparece.
        </div>
        {enrollData ? (
          <>
            <div style={{ background: C.white, borderRadius: 10, padding: 10, width: 180, height: 180, margin: "14px auto 10px" }}>
              <img src={enrollData.qr} alt="Código QR para la app autenticadora" style={{ width: "100%", height: "100%", display: "block" }} />
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: `${C.paper}AA`, textAlign: "center", marginBottom: 6 }}>¿Estás en el mismo celular? Elige "Ingresar clave" en la app y pega esta clave:</div>
            <button onClick={() => { try { navigator.clipboard.writeText(enrollData.secret); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* sin portapapeles */ } }}
              style={{ display: "block", margin: "0 auto", background: "transparent", border: "1px dashed rgba(255,255,255,0.35)", borderRadius: 8, padding: "8px 10px", color: C.paper, fontFamily: "monospace", fontSize: 12, letterSpacing: "0.08em", cursor: "pointer", wordBreak: "break-all" }}>
              {copied ? "Clave copiada" : enrollData.secret}
            </button>
          </>
        ) : !err && <div className="spin" style={{ margin: "16px auto", width: 20, height: 20, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.25)", borderTopColor: C.paper }} />}
      </div>
      {codeInput}
      {err && <div style={errText}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 18, width: "100%", maxWidth: 260 }}>
        <button onClick={cancel} style={darkBtn}>Salir</button>
        <button onClick={verifyCode} disabled={busy || code.length !== 6} style={{ ...lightBtn, opacity: busy || code.length !== 6 ? 0.5 : 1 }}>{busy ? "Verificando…" : "Activar y entrar"}</button>
      </div>
    </>
  );

  return shell(
    <>
      {title("Acceso Staff", "Solo para el equipo de Fly.")}
      {isLocked ? (
        <div style={{ border: "1px solid rgba(255,255,255,0.25)", borderRadius: 10, padding: "16px 18px", maxWidth: 270, textAlign: "center" }}>
          <ShieldCheck size={20} color={C.paper} style={{ marginBottom: 8 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.paper, marginBottom: 4 }}>Demasiados intentos fallidos.</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: `${C.paper}AA` }}>Vuelve a intentar en {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}.</div>
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 270 }}>
          <input value={username} onChange={(e) => { setUsername(e.target.value); setErr(""); }} placeholder="Usuario" autoCapitalize="none" autoComplete="username" style={{ ...darkInput(!!err), marginBottom: 10 }} />
          <input value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }} type="password" placeholder="Contraseña" autoComplete="current-password"
            onKeyDown={(e) => e.key === "Enter" && login()} style={darkInput(!!err)} />
          {err && <div style={errText}>{err}</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 18, width: "100%", maxWidth: 270 }}>
        <button onClick={cancel} style={darkBtn}>Volver a la tienda</button>
        {!isLocked && <button onClick={login} disabled={busy} style={{ ...lightBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Entrando…" : "Entrar"}</button>}
      </div>
    </>
  );
};

const AdminTopBar = ({ title, onBack, onExit }) => (
  <div className="admin-topbar" style={{ position: "sticky", top: 0, zIndex: 15, background: C.ink, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {onBack && <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><ArrowLeft size={18} color={C.paper} /></button>}
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, color: C.paper }}>{title}</span>
    </div>
    <button onClick={onExit} style={{ fontFamily: FONT_BODY, fontSize: 11, color: `${C.paper}AA`, background: "none", border: `1px solid rgba(255,255,255,0.25)`, borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>Volver a la tienda</button>
  </div>
);

const AdminNav = ({ screen, setScreen, role }) => {
  const items = (role === "administrador" || role === "superadmin")
    ? [["dashboard", "Panel", LayoutDashboard], ["pos", "Ventas", ShoppingCart], ["stock", "Stock", Package], ["products", "Productos", LayoutGrid], ["more", "Más", Menu]]
    : role === "vendedora_tienda"
    ? [["pos", "Ventas", ShoppingCart], ["stock", "Stock", Package], ["onlineorders", "Pedidos", Ticket]]
    : [["onlinesales", "Venta Online", ShoppingCart], ["onlineorders", "Pedidos Web", Ticket], ["stock", "Stock", Package], ["mysales", "Mis Ventas", BarChart3]];
  const moreScreens = ["banners", "bannerEditor", "collections", "collectionEditor", "invoices", "reports", "more", "users", "promocodes", "onlineorders"];
  return (
    <div className="staff-nav" style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.paperDeep, borderTop: `1px solid ${C.line}`, padding: "10px 6px calc(10px + env(safe-area-inset-bottom))", display: "flex", justifyContent: "space-around", zIndex: 30 }}>
      {items.map(([key, label, Icon]) => {
        const active = screen === key || (key === "products" && screen === "productEditor") || (key === "more" && moreScreens.includes(screen));
        return (
          <button key={key} className={`nav-item${active ? " is-active" : ""}`} onClick={() => setScreen(key)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
            <Icon size={19} strokeWidth={active ? 2.1 : 1.5} color={active ? C.ink : C.stone} />
            <span className="nav-label" style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: active ? C.ink : C.stone, fontWeight: active ? 600 : 400 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
};

const quickLinkStyle = { display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.ink };

const AdminDashboard = ({ catalog, updateCatalog, setAdminScreen, role }) => {
  const { products, banners, collections } = catalog;
  const agotados = products.filter(productSoldOut).length;
  const [culqiKey, setCulqiKey] = useState(catalog.settings?.culqiPublicKey || "");
  const [turnstileKey, setTurnstileKey] = useState(catalog.settings?.turnstileSiteKey || "");
  const saveTurnstileKey = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, turnstileSiteKey: turnstileKey.trim() } })); alert(turnstileKey.trim() ? "Llave del captcha guardada. El registro del Club Fly ya usa la verificación de Cloudflare." : "Llave borrada. El registro vuelve a usar la suma."); };
  const [payAccounts, setPayAccounts] = useState({
    yapeNumber: catalog.settings?.yapeNumber || "", plinNumber: catalog.settings?.plinNumber || "",
    bankName: catalog.settings?.bankName || "", bankAccount: catalog.settings?.bankAccount || "", bankCCI: catalog.settings?.bankCCI || "",
  });
  const stats = [
    ["Productos", products.length, () => setAdminScreen("products")],
    ["Agotados", agotados, () => setAdminScreen("products")],
    ["Banners activos", banners.filter((b) => b.active).length, () => setAdminScreen("banners")],
    ["Colecciones", collections.length, () => setAdminScreen("collections")],
  ];
  const saveCulqiKey = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, culqiPublicKey: culqiKey.trim() } })); alert("Llave pública de Culqi guardada."); };
  const savePayAccounts = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, ...payAccounts } })); alert("Datos de pago guardados."); };
  return (
    <div style={{ padding: "20px 18px 90px" }}>
      <Eyebrow>Fly</Eyebrow>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.ink, fontWeight: 800, margin: "0 0 20px" }}>Panel de control</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        {stats.map(([label, val, onClick]) => (
          <button key={label} onClick={onClick} style={{ textAlign: "left", background: C.paperDeep, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px", cursor: "pointer" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 800, color: C.ink }}>{val}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 2 }}>{label}</div>
          </button>
        ))}
      </div>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Yape, Plin y transferencia bancaria</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          Esto se muestra a la clienta cuando elige pagar por Yape, Plin o transferencia, para que sepa a dónde enviar el dinero.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input value={payAccounts.yapeNumber} onChange={(e) => setPayAccounts((f) => ({ ...f, yapeNumber: e.target.value }))} placeholder="Número Yape" style={inputStyle} />
          <input value={payAccounts.plinNumber} onChange={(e) => setPayAccounts((f) => ({ ...f, plinNumber: e.target.value }))} placeholder="Número Plin" style={inputStyle} />
        </div>
        <input value={payAccounts.bankName} onChange={(e) => setPayAccounts((f) => ({ ...f, bankName: e.target.value }))} placeholder="Banco (ej. BCP)" style={{ ...inputStyle, marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={payAccounts.bankAccount} onChange={(e) => setPayAccounts((f) => ({ ...f, bankAccount: e.target.value }))} placeholder="N° de cuenta" style={inputStyle} />
          <input value={payAccounts.bankCCI} onChange={(e) => setPayAccounts((f) => ({ ...f, bankCCI: e.target.value }))} placeholder="CCI" style={inputStyle} />
        </div>
        <button onClick={savePayAccounts} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar datos de pago</button>
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Configuración de pagos — Culqi (tarjeta)</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          Pega aquí solo tu <strong>llave pública</strong> (empieza con <code>pk_</code>). Nunca pegues la llave secreta (<code>sk_</code>) en la app — esa va únicamente en tu servidor.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={culqiKey} onChange={(e) => setCulqiKey(e.target.value)} placeholder="pk_test_xxxxxxxxxxxx" style={inputStyle} />
          <button onClick={saveCulqiKey} style={{ padding: "0 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Verificación anti-robots — Cloudflare Turnstile</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          Pega aquí la <strong>Site Key</strong> (empieza con <code>0x</code>). La <strong>Secret Key</strong> nunca va aquí: se guarda en Supabase.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={turnstileKey} onChange={(e) => setTurnstileKey(e.target.value)} placeholder="0x4AAAAAAA…" style={inputStyle} />
          <button onClick={saveTurnstileKey} style={{ padding: "0 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ShieldCheck size={18} color={C.brass} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Listo para una base de datos real</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, lineHeight: 1.6 }}>
              Todo lo que edites aquí se guarda con almacenamiento persistente de la app. El modelo de datos (productos, variantes con talla/color/stock, banners y colecciones) ya está estructurado como tablas — cuando conectes Postgres, Firebase u otra base de datos, solo reemplazas las funciones de guardado por llamadas a tu API.
            </div>
          </div>
        </div>
      </AdminCard>
      {role === "superadmin" && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Contenido de muestra</span>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>
            Reemplaza todo el catálogo actual por el catálogo de muestra más reciente (productos, fotos y video de referencia). Útil para ver siempre la última demostración, o para volver a empezar limpio. <strong>Esto borra los productos/ventas que hayas cargado — no lo uses una vez que subas tu catálogo real.</strong>
          </div>
          <button onClick={() => { if (confirm("¿Reemplazar todo el catálogo actual por el de muestra? Esto no se puede deshacer.")) updateCatalog(() => seedCatalog()); }} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Restaurar catálogo de muestra</button>
        </AdminCard>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <button onClick={() => setAdminScreen("products")} style={quickLinkStyle}><Package size={16} color={C.ink} /> Gestionar productos y stock <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
        <button onClick={() => setAdminScreen("banners")} style={quickLinkStyle}><ImageIcon size={16} color={C.ink} /> Editar banners de inicio <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
        <button onClick={() => setAdminScreen("collections")} style={quickLinkStyle}><Layers size={16} color={C.ink} /> Crear y editar colecciones <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
      </div>
      <button onClick={() => {
        try {
          const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `fly-boutique-catalogo-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) { console.warn("No se pudo exportar", e); }
      }} style={{ ...quickLinkStyle, borderStyle: "dashed" }}>
        <Download size={16} color={C.ink} /> Exportar catálogo completo (JSON) <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} />
      </button>
    </div>
  );
};

/* ---- Admin: Products list ---- */
const AdminProductList = ({ catalog, openEditor, deleteProduct, onImport, onBulkPhotos, onToggleActive, onToggleFeatured, onToggleOnline, onDuplicate }) => {
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [matchingPhotos, setMatchingPhotos] = useState(false);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const searchRef = useRef(null);

  const filtered = catalog.products.filter((p) =>
    p.name.toLowerCase().includes(q.toLowerCase()) || p.variants.some((v) => v.sku && v.sku.toLowerCase().includes(q.toLowerCase()))
  );

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImporting(true);
    try {
      const { toUpsert, toDelete, movements } = await parseImportFile(file);
      if (toUpsert.length === 0 && toDelete.length === 0) alert("No se encontraron filas válidas. Revisa que la columna 'producto' tenga datos.");
      else {
        onImport(toUpsert, toDelete, movements);
        alert(`Listo: ${toUpsert.length} producto(s) creado(s)/actualizado(s)${toDelete.length ? `, ${toDelete.length} eliminado(s)` : ""}${movements.length ? `, ${movements.length} movimiento(s) de stock registrados` : ""}.`);
      }
    } catch (err) { console.error(err); alert("No se pudo leer el archivo. Verifica que uses la plantilla de Excel/CSV."); }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleBulkPhotos = async (e) => {
    const files = [...(e.target.files || [])]; if (!files.length) return;
    setMatchingPhotos(true);
    const matches = []; const unmatched = [];
    for (const file of files) {
      const baseNorm = normalizeCode(file.name.replace(/\.[^.]+$/, ""));
      const match = findProductMatch(catalog.products, baseNorm);
      if (!match) { unmatched.push(file.name); continue; }
      try { const dataUrl = await resizeImageFile(file); matches.push({ productId: match.product.id, url: dataUrl, colorName: match.colorName }); }
      catch (err) { unmatched.push(file.name); }
    }
    if (matches.length) onBulkPhotos(matches);
    setMatchingPhotos(false);
    if (photoRef.current) photoRef.current.value = "";
    const withColor = matches.filter((m) => m.colorName).length;
    alert(`${matches.length} foto(s) asignadas automáticamente${withColor ? ` (${withColor} identificadas por color exacto vía código de barras)` : ""}.${unmatched.length ? `\nSin coincidencia (${unmatched.length}): ${unmatched.join(", ")}` : ""}`);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const val = q.trim().toLowerCase();
    if (!val) return;
    const exact = catalog.products.find((p) => p.variants.some((v) => v.sku && v.sku.toLowerCase() === val));
    if (exact) { openEditor(exact.id); setQ(""); }
  };

  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>Productos ({catalog.products.length})</h1>
        <button onClick={() => openEditor(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: C.paper, border: "none", borderRadius: 8, padding: "9px 13px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nuevo</button>
      </div>

      <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", borderRadius: 9, border: `1px dashed ${C.ink}`, background: C.paperDeep, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
        <FileSpreadsheet size={15} /> {importing ? "Importando…" : "Importar catálogo desde Excel/CSV"}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} style={{ display: "none" }} />

      <button onClick={() => photoRef.current?.click()} disabled={matchingPhotos} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", borderRadius: 9, border: `1px dashed ${C.line}`, background: C.paperDeep, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 6 }}>
        <ImageIcon size={15} /> {matchingPhotos ? "Asignando fotos…" : "Subir fotos en lote (coincidencia automática)"}
      </button>
      <input ref={photoRef} type="file" accept="image/*" multiple onChange={handleBulkPhotos} style={{ display: "none" }} />

      <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginBottom: 16, textAlign: "center", lineHeight: 1.5 }}>
        Nombra cada foto con el código de barras o el nombre de la prenda (ej. <em>7501234567890.jpg</em>) y se asigna sola. Importar de nuevo actualiza por nombre en vez de duplicar.
      </div>

      <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Buscar por nombre, o escanea un código de barras + Enter" style={{ ...inputStyle, marginBottom: 16 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((p) => {
          const soldOut = productSoldOut(p);
          const statusMap = { active: { l: "Activo", bg: C.ink, fg: C.paper }, agotado: { l: "Agotado", bg: C.accent, fg: C.white }, borrador: { l: "Borrador", bg: C.line, fg: C.inkSoft } };
          const st = statusMap[soldOut && p.status !== "borrador" ? "agotado" : p.status];
          return (
            <AdminCard key={p.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 52, height: 64, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(p)} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, margin: "3px 0 6px" }}>{p.category} · {money(p.price)} · {productTotalStock(p)} u.</div>
                {p.variants[0]?.sku && <div style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: C.stone, marginBottom: 6 }}>Cód: {p.variants.map((v) => v.sku).slice(0, 2).join(" · ")}{p.variants.length > 2 ? "…" : ""}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", background: st.bg, color: st.fg, padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>{st.l}</span>
                  <Switch on={p.status === "active"} onClick={() => onToggleActive(p.id)} label={p.status === "active" ? "Visible" : "Oculto"} />
                  <Switch on={p.featured !== false} onClick={() => onToggleFeatured(p.id)} label="Destacado" />
                  <Switch on={p.showOnline !== false} onClick={() => onToggleOnline(p.id)} label={p.showOnline !== false ? "Web" : "Solo tienda"} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button onClick={() => openEditor(p.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} color={C.ink} /></button>
                <button onClick={() => onDuplicate(p.id)} title="Duplicar" style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Layers size={13} color={C.ink} /></button>
                <button onClick={() => deleteProduct(p.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} color={C.accent} /></button>
              </div>
            </AdminCard>
          );
        })}
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Sin resultados.</div>}
      </div>
    </div>
  );
};

/* ---- Admin: Product editor (create/edit) ---- */
const emptyProductForm = () => ({
  id: null, name: "", category: CATEGORY_OPTIONS[0], description: "", price: "", compareAtPrice: "",
  status: "active", tag: "", minStock: 3, showOnline: true, images: [], collectionIds: [], sizes: [], colors: [], stock: {}, skus: {},
});

const AdminProductEditor = ({ product, collections, onSave, onCancel }) => {
  const [form, setForm] = useState(emptyProductForm());
  const [urlInput, setUrlInput] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#7C2A2F");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (product) {
      const sizes = productSizes(product);
      const colors = productColors(product);
      const stock = {}; const skus = {};
      product.variants.forEach((v) => { stock[`${v.size}|${v.colorName}`] = v.stock; skus[`${v.size}|${v.colorName}`] = v.sku || ""; });
      setForm({ id: product.id, name: product.name, category: product.category, description: product.description || "",
        price: String(product.price), compareAtPrice: product.compareAtPrice ? String(product.compareAtPrice) : "",
        status: product.status, tag: product.tag || "", minStock: product.minStock ?? 3, showOnline: product.showOnline !== false, images: product.images, collectionIds: product.collectionIds || [],
        sizes, colors, stock, skus });
    } else setForm(emptyProductForm());
  }, [product]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addSize = () => { const s = newSize.trim(); if (!s || form.sizes.includes(s)) return; set("sizes", [...form.sizes, s]); setNewSize(""); };
  const removeSize = (s) => { set("sizes", form.sizes.filter((x) => x !== s)); const st = { ...form.stock }; const sk = { ...form.skus }; Object.keys(st).forEach((k) => k.startsWith(s + "|") && delete st[k]); Object.keys(sk).forEach((k) => k.startsWith(s + "|") && delete sk[k]); setForm((f) => ({ ...f, stock: st, skus: sk })); };
  const addColor = () => { const n = newColorName.trim(); if (!n || form.colors.some((c) => c.n === n)) return; set("colors", [...form.colors, { n, h: newColorHex }]); setNewColorName(""); };
  const removeColor = (n) => { set("colors", form.colors.filter((c) => c.n !== n)); const st = { ...form.stock }; const sk = { ...form.skus }; Object.keys(st).forEach((k) => k.endsWith("|" + n) && delete st[k]); Object.keys(sk).forEach((k) => k.endsWith("|" + n) && delete sk[k]); setForm((f) => ({ ...f, stock: st, skus: sk })); };
  const setStockVal = (size, colorName, val) => set("stock", { ...form.stock, [`${size}|${colorName}`]: Math.max(0, parseInt(val || "0", 10)) });
  const setSkuVal = (size, colorName, val) => set("skus", { ...form.skus, [`${size}|${colorName}`]: val });

  const addImageUrl = () => {
    if (!urlInput.trim()) return;
    const url = urlInput.trim();
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    set("images", [...form.images, { id: genId("img"), url, type: isVideo ? "video" : "image" }]);
    setUrlInput("");
  };
  const removeImage = (id) => set("images", form.images.filter((i) => i.id !== id));
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { const dataUrl = await resizeImageFile(file); set("images", [...form.images, { id: genId("img"), url: dataUrl }]); }
    catch (err) { console.error(err); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const toggleCollection = (id) => set("collectionIds", form.collectionIds.includes(id) ? form.collectionIds.filter((c) => c !== id) : [...form.collectionIds, id]);

  const canSave = form.name.trim() && form.price !== "" && form.sizes.length > 0 && form.colors.length > 0;

  const handleSave = () => {
    const variants = [];
    form.sizes.forEach((s) => form.colors.forEach((c) => {
      const key = `${s}|${c.n}`;
      const customSku = (form.skus[key] || "").trim();
      variants.push({ id: genId("var"), size: s, colorName: c.n, colorHex: c.h, stock: form.stock[key] || 0,
        sku: customSku || `${slugify(form.name)}-${s}-${slugify(c.n)}`.toUpperCase() });
    }));
    const record = {
      id: form.id || genId("prod"), name: form.name.trim(), slug: slugify(form.name), category: form.category,
      description: form.description, price: Number(form.price) || 0, compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
      status: form.status, tag: form.tag || null, minStock: form.minStock ?? 3, showOnline: form.showOnline !== false, images: form.images, collectionIds: form.collectionIds, variants,
      createdAt: product?.createdAt || Date.now(), updatedAt: Date.now(),
    };
    onSave(record);
  };

  return (
    <div style={{ padding: "18px 18px 100px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{product ? "Editar producto" : "Nuevo producto"}</h1>

      <AdminCard style={{ marginBottom: 14 }}>
        <Field label="Nombre del producto"><input style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Vestido Midi Coralina" /></Field>
        <Field label="Categoría">
          <select style={inputStyle} value={form.category} onChange={(e) => set("category", e.target.value)}>{CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
        <Field label="Descripción"><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Detalles, tela, cuidado…" /></Field>
      </AdminCard>

      <AdminCard style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Precio (S/)"><input type="number" style={inputStyle} value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="189" /></Field></div>
          <div style={{ flex: 1 }}><Field label="Precio anterior (opcional)"><input type="number" style={inputStyle} value={form.compareAtPrice} onChange={(e) => set("compareAtPrice", e.target.value)} placeholder="—" /></Field></div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Field label="Estado">
              <select style={inputStyle} value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">Activo</option><option value="agotado">Agotado (manual)</option><option value="borrador">Borrador</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Etiqueta">
              <select style={inputStyle} value={form.tag} onChange={(e) => set("tag", e.target.value)}>
                <option value="">Ninguna</option><option value="Nuevo">Nuevo</option><option value="Oferta">Oferta</option><option value="Bestseller">Bestseller</option>
              </select>
            </Field>
          </div>
        </div>
        <Field label="Stock mínimo (alerta cuando cualquier combinación baje de este número)">
          <input type="number" min="0" style={{ ...inputStyle, maxWidth: 120 }} value={form.minStock} onChange={(e) => set("minStock", Math.max(0, parseInt(e.target.value || "0", 10)))} />
        </Field>
        <div style={{ marginTop: 6 }}>
          <Switch on={form.showOnline} onClick={() => set("showOnline", !form.showOnline)} label={form.showOnline ? "Visible en tienda online / web" : "Solo venta en tienda física (oculto en web)"} />
        </div>
      </AdminCard>

      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Imágenes y videos</span>
        <div style={{ background: C.paperDeep, borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, lineHeight: 1.6 }}>
          <strong>Medida recomendada:</strong> fotos verticales 1000×1300px (proporción 3:4), formato JPG, menos de 500 KB. Para video: misma proporción vertical (ej. 1080×1440), 5-15 segundos, en bucle, menos de 15 MB para que cargue rápido.
        </div>
        {form.colors.length > 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 10 }}>Asigna cada foto o video a un color para que cambie solo cuando la clienta elija ese color. Los videos solo se agregan pegando una URL (ej. terminada en .mp4) — súbelos primero a un lugar como Supabase Storage o tu propio hosting.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {form.images.map((img) => (
            <div key={img.id} style={{ width: 64 }}>
              <div style={{ position: "relative", width: 64, height: 80 }}>
                {img.type === "video" ? (
                  <video src={img.url} muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }} />
                ) : (
                  <ProductImg src={img.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }} />
                )}
                {img.type === "video" && <div style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "1px 4px", fontFamily: FONT_BODY, fontSize: 8, color: "#fff", fontWeight: 600 }}>VIDEO</div>}
                <button onClick={() => removeImage(img.id)} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: C.ink, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} color={C.paper} /></button>
              </div>
              {form.colors.length > 0 && (
                <select value={img.colorName || ""} onChange={(e) => set("images", form.images.map((i) => (i.id === img.id ? { ...i, colorName: e.target.value || null } : i)))}
                  style={{ width: "100%", fontSize: 9, marginTop: 4, padding: "3px 2px", borderRadius: 4, border: `1px solid ${C.line}`, color: C.stone }}>
                  <option value="">General</option>
                  {form.colors.map((c) => <option key={c.n} value={c.n}>{c.n}</option>)}
                </select>
              )}
            </div>
          ))}
          {form.images.length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay imágenes.</div>}
        </div>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {uploading ? "Subiendo…" : "Subir imagen desde tu equipo"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="o pega una URL de imagen" />
          <button onClick={addImageUrl} style={{ padding: "0 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer" }}><LinkIcon size={14} color={C.ink} /></button>
        </div>
      </AdminCard>

      {collections.length > 0 && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Colecciones</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {collections.map((c) => <Chip key={c.id} active={form.collectionIds.includes(c.id)} onClick={() => toggleCollection(c.id)}>{c.name}</Chip>)}
          </div>
        </AdminCard>
      )}

      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Tallas</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {form.sizes.map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 12 }}>{s}<button onClick={() => removeSize(s)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={11} color={C.stone} /></button></span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="Ej. M, 38, Única" onKeyDown={(e) => e.key === "Enter" && addSize()} />
          <button onClick={addSize} style={{ padding: "0 14px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, cursor: "pointer" }}><Plus size={14} /></button>
        </div>
      </AdminCard>

      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Colores</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {form.colors.map((c) => (
            <span key={c.n} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 6px", borderRadius: 999, border: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 12 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: c.h, border: `1px solid ${C.line}` }} />{c.n}
              <button onClick={() => removeColor(c.n)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={11} color={C.stone} /></button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="color" value={newColorHex} onChange={(e) => setNewColorHex(e.target.value)} style={{ width: 40, height: 40, border: `1px solid ${C.line}`, borderRadius: 8, padding: 2, background: C.paperDeep, cursor: "pointer" }} />
          <input style={inputStyle} value={newColorName} onChange={(e) => setNewColorName(e.target.value)} placeholder="Nombre del color" onKeyDown={(e) => e.key === "Enter" && addColor()} />
          <button onClick={addColor} style={{ padding: "0 14px", height: 40, borderRadius: 8, border: "none", background: C.ink, color: C.paper, cursor: "pointer", flexShrink: 0 }}><Plus size={14} /></button>
        </div>
      </AdminCard>

      {form.sizes.length > 0 && form.colors.length > 0 && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Stock por talla y color</span>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 90 * (form.colors.length + 1) }}>
              <thead><tr><th style={thStyle}></th>{form.colors.map((c) => <th key={c.n} style={thStyle}><span style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: c.h }} />{c.n}</span></th>)}</tr></thead>
              <tbody>
                {form.sizes.map((s) => (
                  <tr key={s}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s}</td>
                    {form.colors.map((c) => (
                      <td key={c.n} style={tdStyle}>
                        <input type="number" min="0" value={form.stock[`${s}|${c.n}`] ?? 0} onChange={(e) => setStockVal(s, c.n, e.target.value)} style={{ width: 62, padding: "7px 6px", textAlign: "center", borderRadius: 6, border: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 12, marginBottom: 4 }} />
                        <input value={form.skus[`${s}|${c.n}`] || ""} onChange={(e) => setSkuVal(s, c.n, e.target.value)} placeholder="código" style={{ width: 62, padding: "4px 6px", textAlign: "center", borderRadius: 6, border: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 9.5, color: C.stone }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 10 }}>Total de unidades: {Object.values(form.stock).reduce((s, v) => s + Number(v || 0), 0)}</div>
        </AdminCard>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
        <PrimaryButton disabled={!canSave} onClick={handleSave} style={{ flex: 2, width: "auto" }}>Guardar producto</PrimaryButton>
      </div>
      {!canSave && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 10, textAlign: "center" }}>Completa nombre, precio, al menos una talla y un color para guardar.</div>}
    </div>
  );
};
const thStyle = { fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, padding: "0 8px 8px", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.04em" };
const tdStyle = { padding: "4px 8px", textAlign: "center" };

/* ---- Admin: Banners ---- */
const AdminBannerList = ({ banners, openEditor, toggleActive, deleteBanner }) => (
  <div style={{ padding: "18px 18px 90px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>Banners</h1>
      <button onClick={() => openEditor(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: C.paper, border: "none", borderRadius: 8, padding: "9px 13px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nuevo</button>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {banners.slice().sort((a, b) => a.order - b.order).map((b) => (
        <AdminCard key={b.id}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 76, height: 76, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={b.image} alt={b.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 4 }}>{b.title}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 8 }}>Orden {b.order} · CTA: {b.ctaLabel}</div>
              <Switch on={b.active} onClick={() => toggleActive(b.id)} label={b.active ? "Activo" : "Inactivo"} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={() => openEditor(b.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} color={C.ink} /></button>
              <button onClick={() => deleteBanner(b.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} color={C.accent} /></button>
            </div>
          </div>
        </AdminCard>
      ))}
      {banners.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay banners.</div>}
    </div>
  </div>
);

const emptyBannerForm = () => ({ id: null, eyebrow: "", title: "", ctaLabel: "Ver colección", ctaType: "category", ctaValue: "Todo", image: "", videoUrl: "", active: true, order: 1 });

const AdminBannerEditor = ({ banner, onSave, onCancel }) => {
  const [form, setForm] = useState(emptyBannerForm());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { setForm(banner ? { ...banner } : emptyBannerForm()); }, [banner]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { set("image", await resizeImageFile(file, 1200, 0.82)); } catch (err) { console.error(err); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const canSave = form.title.trim() && form.image;
  return (
    <div style={{ padding: "18px 18px 100px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{banner ? "Editar banner" : "Nuevo banner"}</h1>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Imagen</span>
        {form.image && <div style={{ marginBottom: 10 }}><ProductImg src={form.image} alt="" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8 }} /></div>}
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>{uploading ? "Subiendo…" : <><Upload size={14} /> Subir imagen</>}</button>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <input style={inputStyle} value={form.image} onChange={(e) => set("image", e.target.value)} placeholder="o pega una URL de imagen" />
        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginTop: 4 }}>Esta imagen se usa mientras no haya video, o como respaldo si el video no carga.</div>
        <div style={{ background: C.paperDeep, borderRadius: 8, padding: "10px 12px", marginTop: 10, fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, lineHeight: 1.6 }}>
          <strong>Medida recomendada del banner:</strong> 1080×1920px (proporción 9:16, bien alargada — casi ocupa toda la pantalla al entrar), JPG, menos de 500 KB. Deja lo importante (rostro, prenda) centrado, porque se recorta un poco por los costados en pantallas anchas.
        </div>
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Video (opcional — reemplaza a la imagen si lo pones)</span>
        {form.videoUrl && <video src={form.videoUrl} muted style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, marginBottom: 10 }} />}
        <input style={inputStyle} value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="URL de video (.mp4) — súbelo primero a tu hosting" />
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <Field label="Eyebrow (texto pequeño superior)"><input style={inputStyle} value={form.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} placeholder="Colección primavera" /></Field>
        <Field label="Título"><input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Piezas con carácter, hechas para volar" /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Texto del botón"><input style={inputStyle} value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Categoría destino"><select style={inputStyle} value={form.ctaValue} onChange={(e) => set("ctaValue", e.target.value)}><option value="Todo">Todo el catálogo</option>{CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field></div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Orden"><input type="number" style={inputStyle} value={form.order} onChange={(e) => set("order", Number(e.target.value))} /></Field></div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", paddingTop: 22 }}><Switch on={form.active} onClick={() => set("active", !form.active)} label="Banner activo" /></div>
        </div>
      </AdminCard>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
        <PrimaryButton disabled={!canSave} onClick={() => onSave({ ...form, id: form.id || genId("ban") })} style={{ flex: 2, width: "auto" }}>Guardar banner</PrimaryButton>
      </div>
    </div>
  );
};

/* ---- Admin: Collections ---- */
const AdminCollectionList = ({ collections, openEditor, deleteCollection }) => (
  <div style={{ padding: "18px 18px 90px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>Colecciones</h1>
      <button onClick={() => openEditor(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: C.paper, border: "none", borderRadius: 8, padding: "9px 13px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nueva</button>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {collections.map((c) => (
        <AdminCard key={c.id}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={c.cover} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{c.name}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, margin: "3px 0 8px" }}>{c.productIds.length} productos {c.featured ? "· Destacada en inicio" : ""}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={() => openEditor(c.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} color={C.ink} /></button>
              <button onClick={() => deleteCollection(c.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} color={C.accent} /></button>
            </div>
          </div>
        </AdminCard>
      ))}
      {collections.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay colecciones.</div>}
    </div>
  </div>
);

const emptyCollectionForm = () => ({ id: null, name: "", description: "", cover: "", productIds: [], featured: true, order: 1 });

/* ---- Admin: Promo Codes (Super Admin) ---- */
const emptyPromoForm = () => ({ id: null, code: "", type: "percent", value: 10, clubOnly: false, active: true });

const AdminPromoCodesScreen = ({ promoCodes, onSave, onDelete }) => {
  const [editing, setEditing] = useState(null);
  if (editing) {
    const set = (k, v) => setEditing((f) => ({ ...f, [k]: v }));
    const canSave = editing.code.trim() && editing.value > 0;
    return (
      <div style={{ padding: "18px 18px 100px" }}>
        <button onClick={() => setEditing(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{editing.id ? "Editar código" : "Nuevo código"}</h1>
        <AdminCard style={{ marginBottom: 14 }}>
          <Field label="Código (lo que escribe la clienta)"><input style={{ ...inputStyle, textTransform: "uppercase" }} value={editing.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="FLY10" /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Tipo">
                <select style={inputStyle} value={editing.type} onChange={(e) => set("type", e.target.value)}>
                  <option value="percent">Porcentaje (%)</option>
                  <option value="fixed">Monto fijo (S/)</option>
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}><Field label="Valor"><input type="number" style={inputStyle} value={editing.value} onChange={(e) => set("value", Number(e.target.value))} /></Field></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 6 }}>
            <Switch on={editing.clubOnly} onClick={() => set("clubOnly", !editing.clubOnly)} label="Solo para miembras del Club Fly" />
            <Switch on={editing.active} onClick={() => set("active", !editing.active)} label="Código activo" />
          </div>
        </AdminCard>
        <PrimaryButton disabled={!canSave} onClick={() => { onSave({ ...editing, id: editing.id || genId("promo"), createdAt: editing.createdAt || Date.now() }); setEditing(null); }}>Guardar código</PrimaryButton>
      </div>
    );
  }
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>Códigos promocionales</h1>
        <button onClick={() => setEditing(emptyPromoForm())} style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: C.paper, border: "none", borderRadius: 8, padding: "9px 13px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nuevo</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {promoCodes.map((p) => (
          <AdminCard key={p.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: "0.04em" }}>{p.code}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{p.type === "percent" ? `${p.value}% de descuento` : `${money(p.value)} de descuento`}{p.clubOnly ? " · Solo Club Fly" : ""}</div>
            </div>
            <Switch on={p.active} onClick={() => onSave({ ...p, active: !p.active })} label={p.active ? "Activo" : "Inactivo"} />
            <button onClick={() => setEditing({ ...p })} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} color={C.ink} /></button>
            <button onClick={() => onDelete(p.id)} style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} color={C.accent} /></button>
          </AdminCard>
        ))}
        {promoCodes.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay códigos.</div>}
      </div>
    </div>
  );
};

/* ---- Staff: Pedidos Online (fulfillment) ---- */
const FULFILLMENT_LABELS = { pendiente: "Pendiente", preparando: "Preparando", listo: "Listo", entregado: "Entregado / Enviado" };
const OnlineOrdersScreen = ({ sales, onUpdateFulfillment, onValidatePayment, canValidate }) => {
  const orders = sales.filter((s) => s.channel === "online" && s.source === "web" && s.status !== "anulado").sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>Pedidos Online</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {orders.map((o) => {
          const validated = o.paymentStatus === "confirmado";
          return (
            <AdminCard key={o.id}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{o.serie}-{String(o.numero).padStart(6, "0")}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{new Date(o.createdAt).toLocaleString("es-PE")} · {DELIVERY_LABELS[o.deliveryMethod] || o.deliveryMethod}</div>
                </div>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink }}>{money(o.total)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, fontWeight: 700, background: validated ? C.ink : C.accentSoft, color: validated ? C.paper : C.accent }}>
                  {validated ? "Pago validado" : "Pendiente de validar pago"}
                </span>
                <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{o.paymentMethod}</span>
              </div>
              {o.customerName && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginBottom: 4 }}>Cliente: {o.customerName}{o.customerPhone ? ` · ${o.customerPhone}` : ""}</div>}
              {o.deliveryAddress && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 8 }}>Dirección: {o.deliveryAddress}</div>}
              <div style={{ borderTop: `1px solid ${C.paperDeep}`, paddingTop: 8, marginBottom: 10 }}>
                {o.items.map((it, i) => <div key={i} style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginBottom: 2 }}>• {it.name} — {it.size}/{it.colorName} × {it.qty}</div>)}
              </div>
              {!validated && canValidate && (
                <button onClick={() => { if (confirm("¿Confirmas que el pago (Yape/Plin/transferencia/tarjeta) sí llegó? Esto descuenta el stock.")) onValidatePayment(o.id); }} style={{ width: "100%", marginBottom: 10, padding: "10px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ✓ Validar pago recibido
                </button>
              )}
              {!validated && !canValidate && <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginBottom: 10, fontStyle: "italic" }}>Esperando que un Administrador valide el pago antes de preparar el pedido.</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", opacity: validated ? 1 : 0.4, pointerEvents: validated ? "auto" : "none" }}>
                {Object.entries(FULFILLMENT_LABELS).map(([key, label]) => (
                  <button key={key} onClick={() => onUpdateFulfillment(o.id, key)} style={{ padding: "6px 11px", borderRadius: 999, border: `1px solid ${o.fulfillment === key ? C.ink : C.line}`, background: o.fulfillment === key ? C.ink : "transparent", color: o.fulfillment === key ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 10.5, cursor: "pointer" }}>{label}</button>
                ))}
              </div>
            </AdminCard>
          );
        })}
        {orders.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>No hay pedidos online por ahora.</div>}
      </div>
    </div>
  );
};


const AdminCollectionEditor = ({ collection, products, onSave, onCancel }) => {
  const [form, setForm] = useState(emptyCollectionForm());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { setForm(collection ? { ...collection } : emptyCollectionForm()); }, [collection]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleProduct = (id) => set("productIds", form.productIds.includes(id) ? form.productIds.filter((p) => p !== id) : [...form.productIds, id]);
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { set("cover", await resizeImageFile(file, 1000, 0.82)); } catch (err) { console.error(err); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const canSave = form.name.trim() && form.cover;
  return (
    <div style={{ padding: "18px 18px 100px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{collection ? "Editar colección" : "Nueva colección"}</h1>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Imagen de portada</span>
        {form.cover && <div style={{ marginBottom: 10 }}><ProductImg src={form.cover} alt="" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8 }} /></div>}
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>{uploading ? "Subiendo…" : <><Upload size={14} /> Subir imagen</>}</button>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <input style={inputStyle} value={form.cover} onChange={(e) => set("cover", e.target.value)} placeholder="o pega una URL de imagen" />
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <Field label="Nombre"><input style={inputStyle} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Oficina con Carácter" /></Field>
        <Field label="Descripción"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Orden"><input type="number" style={inputStyle} value={form.order} onChange={(e) => set("order", Number(e.target.value))} /></Field></div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", paddingTop: 22 }}><Switch on={form.featured} onClick={() => set("featured", !form.featured)} label="Destacar en inicio" /></div>
        </div>
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Productos en esta colección ({form.productIds.length})</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {products.map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: `1px solid ${C.paperDeep}`, cursor: "pointer" }}>
              <input type="checkbox" checked={form.productIds.includes(p.id)} onChange={() => toggleProduct(p.id)} />
              <div style={{ width: 32, height: 40, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(p)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{p.name}</span>
            </label>
          ))}
        </div>
      </AdminCard>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
        <PrimaryButton disabled={!canSave} onClick={() => onSave({ ...form, id: form.id || genId("col") })} style={{ flex: 2, width: "auto" }}>Guardar colección</PrimaryButton>
      </div>
    </div>
  );
};

/* ---- Admin root ---- */
/* ---- Stock: movement sheet ---- */
const MOVEMENT_TYPES = [
  { key: "entrada", label: "Entrada", hint: "Ingreso de mercadería" },
  { key: "salida", label: "Salida", hint: "Retiro fuera de venta" },
  { key: "merma", label: "Merma", hint: "Prenda dañada o perdida" },
  { key: "ajuste", label: "Ajuste", hint: "Corrige el stock a un número exacto" },
];

const StockMovementSheet = ({ product, variant, staffName, onClose, onSubmit }) => {
  const [type, setType] = useState("entrada");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const n = Math.max(0, parseInt(qty || "0", 10));
  const newStock = type === "entrada" ? variant.stock + n : type === "ajuste" ? n : Math.max(0, variant.stock - n);
  const delta = newStock - variant.stock;
  const canSubmit = qty !== "" && (type === "ajuste" || n > 0);

  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 55, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 28px", animation: "slideUp .25s ease" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 2 }}>{product.name}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 18 }}>Talla {variant.size} · {variant.colorName} · Stock actual: {variant.stock}</div>

        <span style={labelStyle}>Tipo de movimiento</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {MOVEMENT_TYPES.map((t) => (
            <button key={t.key} onClick={() => setType(t.key)} style={{ padding: "9px 13px", borderRadius: 8, border: `1px solid ${type === t.key ? C.ink : C.line}`, background: type === t.key ? C.ink : "transparent", color: type === t.key ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>{t.label}</button>
          ))}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 16, marginTop: -8 }}>{MOVEMENT_TYPES.find((t) => t.key === type)?.hint}</div>

        <Field label={type === "ajuste" ? "Nuevo stock total" : "Cantidad"}>
          <input type="number" min="0" style={inputStyle} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Nota (opcional)"><input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. reposición proveedor, prenda con mancha…" /></Field>

        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, marginBottom: 18 }}>Stock resultante: <strong>{newStock}</strong></div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <PrimaryButton disabled={!canSubmit} style={{ flex: 2, width: "auto" }} onClick={() => onSubmit({
            id: genId("mov"), productId: product.id, productName: product.name, variantId: variant.id, size: variant.size, colorName: variant.colorName,
            type, qty: Math.abs(delta), note: note.trim(), staffName, createdAt: Date.now(),
          }, newStock)}>Registrar</PrimaryButton>
        </div>
      </div>
    </div>
  );
};

/* ---- Stock: main screen (shared by Vendedor + Administrador) ---- */
const StockScreen = ({ catalog, staffName, onRegisterMovement, canEdit }) => {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [activeMove, setActiveMove] = useState(null); // {product, variant}
  const [showHistory, setShowHistory] = useState(false);

  const lowStock = [];
  catalog.products.forEach((p) => p.variants.forEach((v) => { if (v.stock > 0 && v.stock <= (p.minStock ?? 3)) lowStock.push({ p, v }); }));
  const agotadosCount = catalog.products.filter(productSoldOut).length;

  const filtered = catalog.products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.variants.some((v) => v.sku?.toLowerCase().includes(q.toLowerCase())));

  const handleSearchKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const val = q.trim().toLowerCase();
    if (!val) return;
    const found = catalog.products.find((p) => p.variants.some((v) => v.sku && v.sku.toLowerCase() === val));
    if (found) { setExpanded(found.id); setQ(""); }
  };

  if (showHistory) {
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        <button onClick={() => setShowHistory(false)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver a Stock</button>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>Historial de movimientos</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {catalog.stockMovements.slice(0, 80).map((m) => {
            const typeColor = { entrada: C.ink, salida: C.accent, merma: C.accent, ajuste: C.brass, venta: C.brass }[m.type] || C.stone;
            return (
              <AdminCard key={m.id} style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{m.productName}</span>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: typeColor, fontWeight: 700 }}>{m.type}</span>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>Talla {m.size} · {m.colorName} · {m.type === "entrada" ? "+" : "-"}{m.qty} u.</div>
                {m.note && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, marginTop: 3, fontStyle: "italic" }}>{m.note}</div>}
                <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone, marginTop: 4 }}>{m.staffName} · {new Date(m.createdAt).toLocaleString("es-PE")}</div>
              </AdminCard>
            );
          })}
          {catalog.stockMovements.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay movimientos registrados.</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 14px" }}>Control de Stock</h1>
      {!canEdit && <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft }}>Modo solo lectura — para registrar entradas/salidas pide a un Administrador.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <AdminCard style={{ padding: 14 }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.accent }}>{lowStock.length}</div><div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>Combinaciones con stock bajo</div></AdminCard>
        <AdminCard style={{ padding: 14 }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{agotadosCount}</div><div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>Productos agotados</div></AdminCard>
      </div>

      {lowStock.length > 0 && (
        <div style={{ background: C.accentSoft, borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertCircle size={15} color={C.accent} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>
            Stock bajo: {lowStock.slice(0, 4).map((l) => `${l.p.name} (${l.v.size}/${l.v.colorName}: ${l.v.stock})`).join(" · ")}{lowStock.length > 4 ? "…" : ""}
          </div>
        </div>
      )}

      <button onClick={() => setShowHistory(true)} style={{ ...quickLinkStyle, width: "100%", marginBottom: 16, justifyContent: "center" }}><FileSpreadsheet size={15} /> Ver historial de movimientos</button>

      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Buscar por nombre o escanea un código + Enter" style={{ ...inputStyle, marginBottom: 16 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((p) => {
          const isOpen = expanded === p.id;
          return (
            <AdminCard key={p.id} style={{ padding: 0, overflow: "hidden" }}>
              <button onClick={() => setExpanded(isOpen ? null : p.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 12, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 44, height: 54, borderRadius: 6, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(p)} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{p.name}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{productTotalStock(p)} u. totales · {p.variants.length} combinaciones</div>
                </div>
                <ChevronDown size={16} color={C.stone} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
              </button>
              {isOpen && (
                <div style={{ borderTop: `1px solid ${C.paperDeep}`, padding: 12 }}>
                  {p.variants.map((v) => (
                    <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, fontWeight: 500 }}>{v.size} · {v.colorName}</div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone }}>{v.sku} {v.stock <= (p.minStock ?? 3) && v.stock > 0 && <span style={{ color: C.accent }}> · stock bajo</span>}{v.stock === 0 && <span style={{ color: C.accent }}> · agotado</span>}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink }}>{v.stock}</span>
                        {canEdit && <button onClick={() => setActiveMove({ product: p, variant: v })} style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 11, cursor: "pointer" }}>Movimiento</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AdminCard>
          );
        })}
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Sin resultados.</div>}
      </div>

      {activeMove && (
        <StockMovementSheet
          product={activeMove.product} variant={activeMove.variant} staffName={staffName}
          onClose={() => setActiveMove(null)}
          onSubmit={(movement, newStock) => { onRegisterMovement(activeMove.product.id, activeMove.variant.id, newStock, movement); setActiveMove(null); }}
        />
      )}
    </div>
  );
};

/* ==================================================================== */
/*  ============================  POS (VENTAS)  ========================*/
/* ==================================================================== */
const PAYMENT_METHODS = ["Efectivo", "Yape", "Plin", "Transferencia", "Tarjeta"];

const PosVariantPicker = ({ product, onClose, onAdd }) => {
  const colors = productColors(product);
  const [color, setColor] = useState(colors[0]);
  const [size, setSize] = useState(productSizes(product)[0]);
  const [qty, setQty] = useState(1);
  const stock = variantStock(product, size, color?.n);
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 28px", animation: "slideUp .25s ease" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 56, height: 70, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(product)} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
          <div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, color: C.ink }}>{product.name}</div><div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.accent, fontWeight: 600 }}>{money(product.price)}</div></div>
        </div>
        <span style={labelStyle}>Color</span>
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {colors.map((c) => {
            const outOfStock = colorTotalStock(product, c.n) === 0;
            return (
              <button key={c.n} onClick={() => setColor(c)} title={outOfStock ? `${c.n} — agotado` : c.n} style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", background: c.h, border: color?.n === c.n ? `2px solid ${C.ink}` : `1px solid ${C.line}`, cursor: "pointer", opacity: outOfStock ? 0.35 : 1 }}>
                {outOfStock && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `linear-gradient(to top right, transparent calc(50% - 1px), ${C.ink} calc(50% - 1px), ${C.ink} calc(50% + 1px), transparent calc(50% + 1px))` }} />}
              </button>
            );
          })}
        </div>
        <span style={labelStyle}>Talla</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {productSizes(product).map((s) => { const st = variantStock(product, s, color?.n); return <button key={s} disabled={st === 0} onClick={() => setSize(s)} style={{ minWidth: 42, padding: "9px 6px", borderRadius: 8, border: `1px solid ${size === s ? C.ink : C.line}`, background: size === s ? C.ink : "transparent", color: st === 0 ? C.line : size === s ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, cursor: st === 0 ? "not-allowed" : "pointer" }}>{s}</button>; })}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: stock === 0 ? C.accent : C.stone, marginBottom: 16 }}>Stock disponible: {stock}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={labelStyle}>Cantidad</span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px" }}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ background: "none", border: "none", cursor: "pointer" }}><Minus size={14} /></button>
            <span style={{ fontFamily: FONT_BODY, fontSize: 14 }}>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(stock || 1, q + 1))} style={{ background: "none", border: "none", cursor: "pointer" }}><Plus size={14} /></button>
          </div>
        </div>
        <PrimaryButton disabled={stock === 0} onClick={() => onAdd(product, size, color, qty)}>Agregar a la venta</PrimaryButton>
      </div>
    </div>
  );
};

const ReceiptView = ({ sale, onNewSale, onSendWhatsApp }) => (
  <div style={{ padding: "18px 18px 90px" }}>
    <div style={{ background: C.accentSoft, borderRadius: 10, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18 }}>
      <AlertCircle size={15} color={C.accent} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>Comprobante interno — no es una boleta/factura válida ante SUNAT. Sirve para tu control diario mientras conectas un proveedor autorizado.</div>
    </div>
    <div style={{ textAlign: "center", marginBottom: 18 }}>
      <BadgeLogo size={40} />
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, color: C.ink, marginTop: 10 }}>{sale.tipo === "factura" ? "Factura" : "Boleta"} interna</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>{sale.serie}-{String(sale.numero).padStart(6, "0")}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 2 }}>{new Date(sale.createdAt).toLocaleString("es-PE")}</div>
    </div>
    <AdminCard style={{ marginBottom: 16 }}>
      {sale.customerName && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 4 }}>Cliente: {sale.customerName}</div>}
      {sale.customerDoc && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 10 }}>Doc: {sale.customerDoc}</div>}
      {sale.items.map((it, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < sale.items.length - 1 ? `1px solid ${C.paperDeep}` : "none" }}>
          <div><div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{it.name}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{it.size} · {it.colorName} × {it.qty}</div></div>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, fontWeight: 600 }}>{money(it.unitPrice * it.qty)}</span>
        </div>
      ))}
      <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
      {sale.discount > 0 && (
        <Row label={`Descuento${sale.promoCode ? ` (${sale.promoCode})` : ""}${sale.manualDiscountLabel ? `${sale.promoCode ? " +" : ""} manual ${sale.manualDiscountLabel}` : ""}`} value={`-${money(sale.discount)}`} />
      )}
      <Row label="Total" value={money(sale.total)} bold />
      {sale.paymentMethod === "Efectivo" && sale.amountReceived > 0 && (
        <>
          <Row label="Recibido" value={money(sale.amountReceived)} />
          <Row label="Vuelto" value={money(sale.vuelto || 0)} />
        </>
      )}
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 6 }}>Pago: {sale.paymentMethod} · Atendido por {sale.staffName}</div>
      {sale.deliveryMethod && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 2 }}>{DELIVERY_LABELS[sale.deliveryMethod] || sale.deliveryMethod}{sale.deliveryMethod !== "recojo" ? ` — ${sale.deliveryAddress || "—"}` : ""}</div>}
      {sale.notaExterna && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginTop: 8, fontStyle: "italic" }}>"{sale.notaExterna}"</div>}
      {sale.notaInterna && <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginTop: 6 }}>Nota interna: {sale.notaInterna}</div>}
    </AdminCard>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button onClick={onSendWhatsApp} style={{ ...quickLinkStyle, justifyContent: "center", background: "#25D366", color: C.ink, border: "none", fontWeight: 600 }}><MessageCircle size={15} /> Enviar comprobante por WhatsApp</button>
      <PrimaryButton onClick={onNewSale}>Nueva venta</PrimaryButton>
    </div>
  </div>
);

const PosScreen = ({ catalog, staffName, onCompleteSale, onReserveNumber, channel = "tienda", title = "Punto de Venta" }) => {
  const [confirmingSale, setConfirmingSale] = useState(false);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(null);
  const [saleItems, setSaleItems] = useState([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [comprobanteTipo, setComprobanteTipo] = useState("boleta");
  const [customerName, setCustomerName] = useState("");
  const [customerDoc, setCustomerDoc] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoMsg, setPromoMsg] = useState(null);
  const [manualDiscountType, setManualDiscountType] = useState("none");
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [notaInterna, setNotaInterna] = useState("");
  const [notaExterna, setNotaExterna] = useState("");
  const [lastSale, setLastSale] = useState(null);

  const suggestions = q.trim() ? catalog.products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.variants.some((v) => v.sku?.toLowerCase().includes(q.toLowerCase()))).slice(0, 6) : [];

  const handleScanEnter = (e) => {
    if (e.key !== "Enter") return;
    const val = q.trim().toLowerCase();
    if (!val) return;
    for (const p of catalog.products) {
      const v = p.variants.find((vv) => vv.sku && vv.sku.toLowerCase() === val);
      if (v) { addItem(p, v.size, { n: v.colorName, h: v.colorHex }, 1); setQ(""); return; }
    }
  };

  const addItem = (product, size, color, qty) => {
    setSaleItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.size === size && i.colorName === color.n);
      if (existing) return prev.map((i) => (i === existing ? { ...i, qty: i.qty + qty } : i));
      return [...prev, { saleItemId: genId("si"), productId: product.id, variantId: product.variants.find((v) => v.size === size && v.colorName === color.n)?.id, name: product.name, size, colorName: color.n, qty, unitPrice: product.price }];
    });
    setPicking(null);
  };
  const updateQty = (id, delta) => setSaleItems((prev) => prev.map((i) => (i.saleItemId === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i)));
  const removeItem = (id) => setSaleItems((prev) => prev.filter((i) => i.saleItemId !== id));
  const subtotal = saleItems.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const promoDiscount = appliedPromo ? computeDiscount(appliedPromo, subtotal) : 0;
  const manualDiscount = manualDiscountType === "none" || !manualDiscountValue ? 0
    : manualDiscountType === "percent" ? Math.round(subtotal * (Number(manualDiscountValue) / 100))
    : Math.min(Number(manualDiscountValue), subtotal);
  const discount = promoDiscount + manualDiscount;
  const total = Math.max(0, subtotal - discount);
  const vuelto = paymentMethod === "Efectivo" && amountReceived ? Math.max(0, Number(amountReceived) - total) : null;

  const applyPromoCode = () => {
    const promo = findPromo(catalog.promoCodes, promoInput);
    if (!promo) { setPromoMsg({ ok: false, text: "Código no válido" }); return; }
    setAppliedPromo(promo);
    setPromoMsg({ ok: true, text: `Código ${promo.code} aplicado` });
  };

  const confirmSale = async () => {
    if (comprobanteTipo === "factura" && !customerDoc.trim()) { alert("Ingresa el RUC para factura."); return; }
    if (confirmingSale) return;
    const serie = comprobanteTipo === "factura" ? "F001" : "B001";
    let numero;
    setConfirmingSale(true);
    try { numero = await onReserveNumber(serie); }
    catch (e) { setConfirmingSale(false); alert("No se pudo generar el número del comprobante. Revisa tu conexión e intenta de nuevo."); return; }
    setConfirmingSale(false);
    const sale = {
      id: genId("sale"), tipo: comprobanteTipo, serie, numero,
      items: saleItems, subtotal, discount, promoCode: appliedPromo?.code || null,
      manualDiscountLabel: manualDiscount > 0 ? (manualDiscountType === "percent" ? `${manualDiscountValue}%` : money(Number(manualDiscountValue))) : null,
      total, paymentMethod, amountReceived: amountReceived ? Number(amountReceived) : null, vuelto: vuelto || 0,
      notaInterna: notaInterna.trim(), notaExterna: notaExterna.trim(),
      customerName: customerName.trim(), customerDoc: customerDoc.trim(),
      staffName, channel, source: "pos", status: "emitido", createdAt: Date.now(),
    };
    onCompleteSale(sale);
    setLastSale(sale);
    setSaleItems([]); setShowCheckout(false); setCustomerName(""); setCustomerDoc(""); setAppliedPromo(null); setPromoInput(""); setPromoMsg(null);
    setManualDiscountType("none"); setManualDiscountValue(""); setAmountReceived(""); setNotaInterna(""); setNotaExterna("");
  };

  const sendReceiptWhatsApp = () => {
    const lines = [`Comprobante Fly Boutique ${lastSale.serie}-${String(lastSale.numero).padStart(6, "0")}`, "",
      ...lastSale.items.map((i) => `• ${i.name} — ${i.size}/${i.colorName} × ${i.qty} — ${money(i.unitPrice * i.qty)}`),
      "", ...(lastSale.discount ? [`Descuento (${lastSale.promoCode}): -${money(lastSale.discount)}`] : []), `Total: ${money(lastSale.total)}`, `Pago: ${lastSale.paymentMethod}`, "", "¡Gracias por tu compra en Fly Boutique!"];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  if (lastSale) return <ReceiptView sale={lastSale} onNewSale={() => setLastSale(null)} onSendWhatsApp={sendReceiptWhatsApp} />;

  return (
    <div style={{ padding: "18px 18px 90px", position: "relative" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 14px" }}>{title}</h1>

      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 9, padding: "0 12px", marginBottom: 10 }}>
        <Scan size={15} color={C.stone} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleScanEnter} placeholder="Escanea un código o busca por nombre"
          style={{ border: "none", outline: "none", padding: "12px 0", fontFamily: FONT_BODY, fontSize: 13, flex: 1 }} />
      </div>

      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {suggestions.map((p) => (
            <button key={p.id} onClick={() => setPicking(p)} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 9, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 36, height: 44, borderRadius: 5, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(p)} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
              <div style={{ flex: 1 }}><div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{p.name}</div><div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{money(p.price)} · {productTotalStock(p)} u.</div></div>
            </button>
          ))}
        </div>
      )}

      <div style={{ fontFamily: FONT_BODY, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.stone, marginBottom: 10 }}>Venta actual ({saleItems.reduce((a, i) => a + i.qty, 0)} art.)</div>
      {saleItems.length === 0 ? (
        <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone, border: `1px dashed ${C.line}`, borderRadius: 10 }}>Escanea o busca una prenda para empezar la venta.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {saleItems.map((i) => (
            <div key={i.saleItemId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}` }}>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{i.name}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{i.size} · {i.colorName}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => updateQty(i.saleItemId, -1)} style={{ background: "none", border: "none", cursor: "pointer" }}><Minus size={13} /></button>
                <span style={{ fontFamily: FONT_BODY, fontSize: 12.5 }}>{i.qty}</span>
                <button onClick={() => updateQty(i.saleItemId, 1)} style={{ background: "none", border: "none", cursor: "pointer" }}><Plus size={13} /></button>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: C.ink, minWidth: 56, textAlign: "right" }}>{money(i.unitPrice * i.qty)}</span>
                <button onClick={() => removeItem(i.saleItemId)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={13} color={C.accent} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {saleItems.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${C.line}`, marginBottom: 14 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, color: C.ink }}>Total</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{money(total)}</span>
          </div>
          <PrimaryButton onClick={() => setShowCheckout(true)}><Receipt size={15} /> Generar comprobante</PrimaryButton>
        </>
      )}

      {picking && <PosVariantPicker product={picking} onClose={() => setPicking(null)} onAdd={addItem} />}

      {showCheckout && (
        <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div onClick={() => setShowCheckout(false)} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
          <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 28px", animation: "slideUp .25s ease" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 16 }}>Generar comprobante</div>
            <span style={labelStyle}>Tipo</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <Chip active={comprobanteTipo === "boleta"} onClick={() => setComprobanteTipo("boleta")}>Boleta</Chip>
              <Chip active={comprobanteTipo === "factura"} onClick={() => setComprobanteTipo("factura")}>Factura</Chip>
            </div>
            <Field label={comprobanteTipo === "factura" ? "Razón social" : "Nombre del cliente (opcional)"}>
              <input style={inputStyle} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </Field>
            <Field label={comprobanteTipo === "factura" ? "RUC" : "DNI (opcional)"}>
              <input style={inputStyle} value={customerDoc} onChange={(e) => setCustomerDoc(e.target.value)} />
            </Field>
            <span style={labelStyle}>Método de pago</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {PAYMENT_METHODS.map((m) => <Chip key={m} active={paymentMethod === m} onClick={() => setPaymentMethod(m)}>{m}</Chip>)}
            </div>

            <span style={labelStyle}>Descuento manual (opcional)</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <select value={manualDiscountType} onChange={(e) => { setManualDiscountType(e.target.value); setManualDiscountValue(""); }} style={{ ...inputStyle, flex: 1 }}>
                <option value="none">Sin descuento</option>
                <option value="percent">Porcentaje (%)</option>
                <option value="monto">Monto (S/)</option>
              </select>
              {manualDiscountType !== "none" && <input type="number" min="0" style={{ ...inputStyle, flex: 1 }} value={manualDiscountValue} onChange={(e) => setManualDiscountValue(e.target.value)} placeholder={manualDiscountType === "percent" ? "Ej. 10" : "Ej. 20"} />}
            </div>

            <span style={labelStyle}>Código promocional (opcional)</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input style={inputStyle} value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Ej. FLY10" disabled={!!appliedPromo} />
              {appliedPromo ? (
                <button onClick={() => { setAppliedPromo(null); setPromoInput(""); setPromoMsg(null); }} style={{ padding: "0 14px", borderRadius: 8, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Quitar</button>
              ) : (
                <button onClick={applyPromoCode} style={{ padding: "0 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Aplicar</button>
              )}
            </div>
            {promoMsg && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: promoMsg.ok ? C.ink : C.accent, marginBottom: 12 }}>{promoMsg.text}</div>}

            {paymentMethod === "Efectivo" && (
              <>
                <span style={labelStyle}>Vuelto — monto recibido</span>
                <input type="number" min="0" style={{ ...inputStyle, marginBottom: 8 }} value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} placeholder={`Mínimo ${money(total)}`} />
                {vuelto !== null && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 16 }}>Vuelto a entregar: <strong>{money(vuelto)}</strong></div>}
              </>
            )}

            <Field label="Comentario interno (solo tú lo ves)"><input style={inputStyle} value={notaInterna} onChange={(e) => setNotaInterna(e.target.value)} placeholder="Ej. cliente frecuente, revisar talla…" /></Field>
            <Field label="Comentario externo (aparece en el comprobante)"><input style={inputStyle} value={notaExterna} onChange={(e) => setNotaExterna(e.target.value)} placeholder="Ej. gracias por tu preferencia" /></Field>

            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
              <Row label="Subtotal" value={money(subtotal)} />
              {promoDiscount > 0 && <Row label={`Descuento (${appliedPromo.code})`} value={`-${money(promoDiscount)}`} />}
              {manualDiscount > 0 && <Row label="Descuento manual" value={`-${money(manualDiscount)}`} />}
              <Row label="Total" value={money(total)} bold />
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 16, lineHeight: 1.5 }}>Recuerda: este comprobante es interno y no reemplaza una boleta/factura electrónica SUNAT.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowCheckout(false)} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <PrimaryButton style={{ flex: 2, width: "auto" }} onClick={confirmSale} disabled={confirmingSale}>{confirmingSale ? "Registrando…" : `Confirmar venta · ${money(total)}`}</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ==================================================================== */
/*  ============================  COMPROBANTES  ========================*/
/* ==================================================================== */
const AdminInvoicesScreen = ({ sales, onVoid }) => {
  const [selected, setSelected] = useState(null);
  const [tipoFilter, setTipoFilter] = useState("todos");
  const [estadoFilter, setEstadoFilter] = useState("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");

  if (selected) {
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        <button onClick={() => setSelected(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
        <ReceiptView sale={selected} onNewSale={() => setSelected(null)} onSendWhatsApp={() => {
          const lines = [`Comprobante Fly Boutique ${selected.serie}-${String(selected.numero).padStart(6, "0")}`, "", ...selected.items.map((i) => `• ${i.name} — ${i.size}/${i.colorName} × ${i.qty} — ${money(i.unitPrice * i.qty)}`), "", `Total: ${money(selected.total)}`];
          window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
        }} />
        {selected.status !== "anulado" && (
          <button onClick={() => { onVoid(selected.id); setSelected(null); }} style={{ width: "100%", marginTop: -70, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            <Undo2 size={15} /> Anular (nota de crédito) y devolver stock
          </button>
        )}
      </div>
    );
  }

  const filtered = sales.filter((s) => {
    if (tipoFilter !== "todos" && s.tipo !== tipoFilter) return false;
    if (estadoFilter === "emitido" && s.status === "anulado") return false;
    if (estadoFilter === "anulado" && s.status !== "anulado") return false;
    if (dateFrom && new Date(s.createdAt) < new Date(dateFrom)) return false;
    if (dateTo && new Date(s.createdAt) > new Date(dateTo + "T23:59:59")) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const label = `${s.serie}-${String(s.numero).padStart(6, "0")}`.toLowerCase();
      const matches = label.includes(needle) || (s.customerName || "").toLowerCase().includes(needle) || (s.customerDoc || "").toLowerCase().includes(needle);
      if (!matches) return false;
    }
    return true;
  });

  const clearFilters = () => { setTipoFilter("todos"); setEstadoFilter("todos"); setDateFrom(""); setDateTo(""); setQ(""); };

  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>Comprobantes ({filtered.length} de {sales.length})</h1>
      <div style={{ background: C.accentSoft, borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>
        Registro interno de ventas — no reemplaza boletas/facturas electrónicas SUNAT. Ver guía de lanzamiento para conectar un proveedor autorizado.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N° de comprobante, cliente o DNI/RUC" style={{ ...inputStyle, marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 8, paddingBottom: 2, scrollbarWidth: "none" }}>
        <Chip active={tipoFilter === "todos"} onClick={() => setTipoFilter("todos")}>Todos</Chip>
        <Chip active={tipoFilter === "boleta"} onClick={() => setTipoFilter("boleta")}>Boleta</Chip>
        <Chip active={tipoFilter === "factura"} onClick={() => setTipoFilter("factura")}>Factura</Chip>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Chip active={estadoFilter === "todos"} onClick={() => setEstadoFilter("todos")}>Todos los estados</Chip>
        <Chip active={estadoFilter === "emitido"} onClick={() => setEstadoFilter("emitido")}>Emitidos</Chip>
        <Chip active={estadoFilter === "anulado"} onClick={() => setEstadoFilter("anulado")}>Anulados</Chip>
        <button onClick={clearFilters} style={{ ...activeChipStyle, border: "none", color: C.accent, fontWeight: 600 }}>Limpiar</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((s) => (
          <button key={s.id} onClick={() => setSelected(s)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", textAlign: "left", opacity: s.status === "anulado" ? 0.5 : 1 }}>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{s.serie}-{String(s.numero).padStart(6, "0")} {s.status === "anulado" && "· ANULADO"}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{new Date(s.createdAt).toLocaleDateString("es-PE")} · {s.staffName} · {s.tipo}{s.customerName ? ` · ${s.customerName}` : ""}</div>
            </div>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink }}>{money(s.total)}</span>
          </button>
        ))}
        {sales.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay ventas registradas.</div>}
      </div>
    </div>
  );
};

/* ==================================================================== */
/*  ============================  REPORTES  =============================*/
/* ==================================================================== */
const AdminReportsScreen = ({ catalog }) => {
  const validSales = catalog.sales.filter((s) => s.status !== "anulado");
  const now = new Date();
  const isToday = (ts) => new Date(ts).toDateString() === now.toDateString();
  const isThisMonth = (ts) => { const d = new Date(ts); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); };
  const ventasHoy = validSales.filter((s) => isToday(s.createdAt)).reduce((a, s) => a + s.total, 0);
  const ventasMes = validSales.filter((s) => isThisMonth(s.createdAt)).reduce((a, s) => a + s.total, 0);
  const ticketProm = validSales.length ? validSales.reduce((a, s) => a + s.total, 0) / validSales.length : 0;

  const qtyByProduct = {};
  validSales.forEach((s) => s.items.forEach((it) => { qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + it.qty; }));
  const topProducts = Object.entries(qtyByProduct).map(([id, qty]) => ({ product: catalog.products.find((p) => p.id === id), qty })).filter((t) => t.product).sort((a, b) => b.qty - a.qty).slice(0, 5);

  const totalUnidades = catalog.products.reduce((a, p) => a + productTotalStock(p), 0);
  const agotados = catalog.products.filter(productSoldOut).length;
  const stockBajo = catalog.products.reduce((a, p) => a + p.variants.filter((v) => v.stock > 0 && v.stock <= (p.minStock ?? 3)).length, 0);

  const byStaff = {};
  validSales.forEach((s) => { const key = s.staffName || "Sin asignar"; if (!byStaff[key]) byStaff[key] = { total: 0, count: 0, tienda: 0, online: 0 }; byStaff[key].total += s.total; byStaff[key].count += 1; byStaff[key][s.channel === "online" ? "online" : "tienda"] += s.total; });
  const staffRanking = Object.entries(byStaff).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);

  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>Reportes</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
        <AdminCard><Eyebrow>Ventas de hoy</Eyebrow><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{money(ventasHoy)}</div></AdminCard>
        <AdminCard><Eyebrow>Ventas del mes</Eyebrow><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{money(ventasMes)}</div></AdminCard>
        <AdminCard><Eyebrow>Ticket promedio</Eyebrow><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{money(ticketProm)}</div></AdminCard>
        <AdminCard><Eyebrow>Ventas totales</Eyebrow><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{validSales.length}</div></AdminCard>
      </div>

      <SectionTitle title="Ventas por vendedora" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 20px", marginBottom: 24 }}>
        {staffRanking.length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay ventas registradas.</div>}
        {staffRanking.map((s, i) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.stone, width: 18 }}>{i + 1}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{s.name}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{s.count} ventas · Tienda {money(s.tienda)} · Online {money(s.online)}</div>
            </div>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink }}>{money(s.total)}</span>
          </div>
        ))}
      </div>

      <SectionTitle title="Productos más vendidos" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 20px", marginBottom: 24 }}>
        {topProducts.length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay ventas suficientes.</div>}
        {topProducts.map(({ product, qty }, i) => (
          <div key={product.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.stone, width: 18 }}>{i + 1}</span>
            <div style={{ width: 34, height: 42, borderRadius: 5, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(product)} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            <span style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{product.name}</span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>{qty} u. vendidas</span>
          </div>
        ))}
      </div>

      <SectionTitle title="Estado del inventario" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: "0 20px" }}>
        <AdminCard style={{ padding: 12, textAlign: "center" }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{totalUnidades}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone }}>Unidades en stock</div></AdminCard>
        <AdminCard style={{ padding: 12, textAlign: "center" }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.accent }}>{stockBajo}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone }}>Combinaciones bajas</div></AdminCard>
        <AdminCard style={{ padding: 12, textAlign: "center" }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{agotados}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone }}>Agotados</div></AdminCard>
      </div>
    </div>
  );
};

/* ---- "Más" menu (Administrador) ---- */
const AdminMoreScreen = ({ setScreen, onExit, role }) => (
  <div style={{ padding: "18px 18px 90px" }}>
    <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>Más</h1>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button onClick={() => setScreen("banners")} style={quickLinkStyle}><ImageIcon size={16} color={C.ink} /> Banners <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
      <button onClick={() => setScreen("collections")} style={quickLinkStyle}><Layers size={16} color={C.ink} /> Colecciones <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
      <button onClick={() => setScreen("invoices")} style={quickLinkStyle}><Receipt size={16} color={C.ink} /> Comprobantes <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
      <button onClick={() => setScreen("reports")} style={quickLinkStyle}><BarChart3 size={16} color={C.ink} /> Reportes <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
      <button onClick={() => setScreen("onlineorders")} style={quickLinkStyle}><Ticket size={16} color={C.ink} /> Pedidos Online <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>
      {role === "superadmin" && <button onClick={() => setScreen("promocodes")} style={quickLinkStyle}><Gift size={16} color={C.ink} /> Códigos promocionales <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>}
      {role === "superadmin" && <button onClick={() => setScreen("users")} style={quickLinkStyle}><User size={16} color={C.ink} /> Usuarios y permisos <ChevronRight size={15} color={C.stone} style={{ marginLeft: "auto" }} /></button>}
      <button onClick={onExit} style={{ ...quickLinkStyle, color: C.accent, borderColor: C.accent }}><LogOut size={16} color={C.accent} /> Cerrar sesión</button>
    </div>
  </div>
);

// Gestión del staff (solo Super Admin). Crear cuentas, cambiar rol, desactivar,
// cambiar contraseña y reiniciar la verificación en dos pasos si alguien perdió el celular.
const staffRpcError = (e) => {
  const m = e?.message || String(e || "");
  if (m.includes("SIN_PERMISO")) return "No tienes permiso para esto.";
  if (m.includes("CLAVE_CORTA")) return "La contraseña debe tener al menos 8 caracteres.";
  if (m.includes("NO_PUEDES")) return "No puedes quitarte tu propio acceso de Super Admin.";
  if (/already|registered|exists|duplicate/i.test(m)) return "Ese usuario ya existe. Elige otro nombre de usuario.";
  return m;
};
const emptyStaffForm = () => ({ user_id: null, name: "", username: "", password: "", role: "vendedora_tienda", phone: "", active: true });

const AdminUsersScreen = ({ currentUserId }) => {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data, error } = await supabase.from("staff_profiles").select("*").order("created_at");
    if (error) { setMsg(staffRpcError(error)); setList([]); return; }
    setList(data || []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const f = editing;
    setBusy(true); setMsg("");
    try {
      let uid = f.user_id;
      if (!uid) {
        if (!/^[a-z0-9._-]{3,30}$/.test(f.username.trim().toLowerCase())) throw new Error("El usuario solo puede tener letras, números, punto o guion (mínimo 3).");
        if (f.password.length < 8) throw new Error("CLAVE_CORTA");
        const url = supabase.supabaseUrl || (import.meta.env && import.meta.env.VITE_SUPABASE_URL);
        const key = supabase.supabaseKey || (import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY);
        // Cliente aparte para crear la cuenta sin cerrar tu propia sesión
        const temp = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fly-alta-staff" } });
        const { data, error } = await temp.auth.signUp({ email: staffEmail(f.username), password: f.password });
        if (error) throw error;
        if (!data?.user?.id || (data.user.identities && data.user.identities.length === 0)) throw new Error("already exists");
        uid = data.user.id;
      }
      const { error } = await supabase.rpc("staff_upsert_profile", { p_user: uid, p_username: f.username, p_name: f.name, p_role: f.role, p_phone: f.phone || "", p_active: f.active !== false });
      if (error) throw error;
      setEditing(null); await load();
    } catch (e) { setMsg(staffRpcError(e)); }
    setBusy(false);
  };
  const changePassword = async (s) => {
    const pwd = prompt(`Nueva contraseña para @${s.username} (mínimo 8 caracteres):`);
    if (!pwd) return;
    const { error } = await supabase.rpc("staff_set_password", { p_user: s.user_id, p_password: pwd });
    alert(error ? staffRpcError(error) : "Contraseña cambiada. Avísale la nueva clave en persona, no por chat.");
  };
  const resetMfa = async (s) => {
    if (!confirm(`¿Reiniciar la verificación en dos pasos de ${s.name}? La próxima vez que entre tendrá que escanear un código QR nuevo.`)) return;
    const { error } = await supabase.rpc("staff_reset_mfa", { p_user: s.user_id });
    alert(error ? staffRpcError(error) : "Listo. Ya puede configurar su app autenticadora de nuevo.");
  };
  const remove = async (s) => {
    if (!confirm(`¿Eliminar a ${s.name} (@${s.username})? Ya no podrá entrar al panel.`)) return;
    const { error } = await supabase.rpc("staff_delete", { p_user: s.user_id });
    if (error) alert(staffRpcError(error)); else load();
  };

  if (editing) {
    const set = (k, v) => setEditing((f) => ({ ...f, [k]: v }));
    const isNew = !editing.user_id;
    const canSave = editing.name.trim() && editing.username.trim() && (!isNew || editing.password.length >= 8);
    return (
      <div style={{ padding: "18px 18px 100px" }}>
        <button onClick={() => { setEditing(null); setMsg(""); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{isNew ? "Nuevo usuario" : `Editar a ${editing.name}`}</h1>
        <AdminCard style={{ marginBottom: 14 }}>
          <Field label="Nombre completo"><input style={inputStyle} value={editing.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Usuario (para iniciar sesión)"><input style={{ ...inputStyle, opacity: isNew ? 1 : 0.6 }} disabled={!isNew} value={editing.username} onChange={(e) => set("username", e.target.value.toLowerCase())} autoCapitalize="none" /></Field>
          {isNew && <Field label="Contraseña (mínimo 8 caracteres)"><input style={inputStyle} type="password" autoComplete="new-password" value={editing.password} onChange={(e) => set("password", e.target.value)} /></Field>}
          <Field label="Celular (opcional)"><input style={inputStyle} value={editing.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="51999999999" /></Field>
          <Field label="Rol">
            <select style={inputStyle} value={editing.role} onChange={(e) => set("role", e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {ROLES_WITH_MFA.includes(editing.role) && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>Este rol usa verificación en dos pasos: la primera vez que entre tendrá que escanear un código QR con Google Authenticator.</div>}
          {!isNew && editing.user_id !== currentUserId && <Switch on={editing.active !== false} onClick={() => set("active", editing.active === false)} label="Acceso activo" />}
        </AdminCard>
        {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginBottom: 12 }}>{msg}</div>}
        <PrimaryButton disabled={!canSave || busy} onClick={save}>{busy ? "Guardando…" : isNew ? "Crear usuario" : "Guardar cambios"}</PrimaryButton>
      </div>
    );
  }

  const smallBtn = { height: 30, padding: "0 10px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 11, color: C.ink, display: "flex", alignItems: "center", gap: 5 };
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>Usuarios {list ? `(${list.length})` : ""}</h1>
        <button onClick={() => { setEditing(emptyStaffForm()); setMsg(""); }} style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: C.paper, border: "none", borderRadius: 8, padding: "9px 13px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nuevo</button>
      </div>
      <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, lineHeight: 1.6, display: "flex", gap: 10 }}>
        <ShieldCheck size={16} color={C.ink} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Las contraseñas se guardan cifradas en Supabase: nadie puede verlas, ni siquiera desde aquí. Si alguien la olvida, ponle una nueva con "Clave".</span>
      </div>
      {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginBottom: 12 }}>{msg}</div>}
      {!list ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Cargando…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((s) => (
            <AdminCard key={s.user_id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{s.name} {s.user_id === currentUserId && <span style={{ color: C.stone, fontWeight: 400, fontSize: 11 }}>(tú)</span>}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>@{s.username}, {ROLE_LABELS[s.role] || s.role}{s.active ? "" : ", sin acceso"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setEditing({ ...emptyStaffForm(), ...s, password: "" })} style={smallBtn}><Pencil size={12} /> Editar</button>
                <button onClick={() => changePassword(s)} style={smallBtn}><KeyRound size={12} /> Clave</button>
                <button onClick={() => resetMfa(s)} style={smallBtn}><ShieldCheck size={12} /> Reiniciar 2 pasos</button>
                {s.user_id !== currentUserId && <button onClick={() => remove(s)} style={smallBtn}><Trash2 size={12} /> Eliminar</button>}
              </div>
            </AdminCard>
          ))}
        </div>
      )}
    </div>
  );
};

const MySalesScreen = ({ sales, staffName }) => {
  const mine = sales.filter((s) => s.staffName === staffName && s.status !== "anulado");
  const total = mine.reduce((a, s) => a + s.total, 0);
  const now = new Date();
  const thisMonth = mine.filter((s) => { const d = new Date(s.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const totalMonth = thisMonth.reduce((a, s) => a + s.total, 0);
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 16px" }}>Mis ventas</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <AdminCard><Eyebrow>Este mes</Eyebrow><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{money(totalMonth)}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{thisMonth.length} ventas</div></AdminCard>
        <AdminCard><Eyebrow>Histórico</Eyebrow><div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink }}>{money(total)}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{mine.length} ventas</div></AdminCard>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {mine.slice(0, 40).map((s) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}` }}>
            <div><div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink }}>{s.serie}-{String(s.numero).padStart(6, "0")}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{new Date(s.createdAt).toLocaleDateString("es-PE")}</div></div>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink }}>{money(s.total)}</span>
          </div>
        ))}
        {mine.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no registras ventas.</div>}
      </div>
    </div>
  );
};


const StaffApp = ({ catalog, updateCatalog, role, staffName, staffUsername, currentUserId, reserveNumber, onExit }) => {
  const [screen, setScreen] = useState((role === "administrador" || role === "superadmin") ? "dashboard" : role === "vendedora_tienda" ? "pos" : "onlinesales");
  const [editingProductId, setEditingProductId] = useState(undefined);
  const [editingBannerId, setEditingBannerId] = useState(undefined);
  const [editingCollectionId, setEditingCollectionId] = useState(undefined);

  const registerMovement = (productId, variantId, newStock, movement) => {
    updateCatalog((c) => ({
      ...c,
      products: c.products.map((p) => p.id !== productId ? p : { ...p, variants: p.variants.map((v) => v.id === variantId ? { ...v, stock: newStock } : v) }),
      stockMovements: [movement, ...c.stockMovements],
    }));
  };

  const completeSale = (sale) => {
    updateCatalog((c) => {
      const products = c.products.map((p) => ({
        ...p,
        variants: p.variants.map((v) => {
          const soldItem = sale.items.find((i) => i.variantId === v.id);
          return soldItem ? { ...v, stock: Math.max(0, v.stock - soldItem.qty) } : v;
        }),
      }));
      const movements = sale.items.map((it) => ({
        id: genId("mov"), productId: it.productId, productName: it.name, variantId: it.variantId, size: it.size, colorName: it.colorName,
        type: "venta", qty: it.qty, note: `Venta ${sale.serie}-${String(sale.numero).padStart(6, "0")}`, staffName: sale.staffName, createdAt: sale.createdAt,
      }));
      return {
        ...c, products, sales: [sale, ...c.sales], stockMovements: [...movements, ...c.stockMovements],
        nextBoletaNumber: sale.tipo === "boleta" ? c.nextBoletaNumber + 1 : c.nextBoletaNumber,
        nextFacturaNumber: sale.tipo === "factura" ? c.nextFacturaNumber + 1 : c.nextFacturaNumber,
      };
    });
  };

  const voidSale = (saleId) => {
    if (!confirm("¿Anular esta venta? Se generará una nota de crédito interna y se devolverá el stock.")) return;
    updateCatalog((c) => {
      const sale = c.sales.find((s) => s.id === saleId);
      if (!sale) return c;
      const products = c.products.map((p) => ({
        ...p,
        variants: p.variants.map((v) => {
          const item = sale.items.find((i) => i.variantId === v.id);
          return item ? { ...v, stock: v.stock + item.qty } : v;
        }),
      }));
      const movements = sale.items.map((it) => ({
        id: genId("mov"), productId: it.productId, productName: it.name, variantId: it.variantId, size: it.size, colorName: it.colorName,
        type: "ajuste", qty: it.qty, note: `Nota de crédito — anulación de ${sale.serie}-${String(sale.numero).padStart(6, "0")}`, staffName, createdAt: Date.now(),
      }));
      return { ...c, products, sales: c.sales.map((s) => (s.id === saleId ? { ...s, status: "anulado" } : s)), stockMovements: [...movements, ...c.stockMovements] };
    });
  };

  const savePromo = (record) => updateCatalog((c) => { const exists = c.promoCodes.some((p) => p.id === record.id); return { ...c, promoCodes: exists ? c.promoCodes.map((p) => (p.id === record.id ? record : p)) : [...c.promoCodes, record] }; });
  const deletePromo = (id) => { if (confirm("¿Eliminar este código?")) updateCatalog((c) => ({ ...c, promoCodes: c.promoCodes.filter((p) => p.id !== id) })); };
  const updateFulfillment = (saleId, fulfillment) => updateCatalog((c) => ({ ...c, sales: c.sales.map((s) => (s.id === saleId ? { ...s, fulfillment } : s)) }));
  const validateOnlinePayment = (saleId) => {
    updateCatalog((c) => {
      const sale = c.sales.find((s) => s.id === saleId);
      if (!sale || sale.paymentStatus === "confirmado") return c;
      const products = c.products.map((p) => ({
        ...p,
        variants: p.variants.map((v) => {
          const item = sale.items.find((i) => i.productId === p.id && i.size === v.size && i.colorName === v.colorName);
          return item ? { ...v, stock: Math.max(0, v.stock - item.qty) } : v;
        }),
      }));
      const movements = sale.items.map((it) => ({
        id: genId("mov"), productId: it.productId, productName: it.name, size: it.size, colorName: it.colorName,
        type: "venta", qty: it.qty, note: `Pago validado — pedido web ${sale.serie}-${String(sale.numero).padStart(6, "0")}`, staffName, createdAt: Date.now(),
      }));
      const earned = Math.round(Math.max(0, (sale.subtotal || 0) - (sale.discount || 0)) * 0.1);
      const customers = sale.customerPhone && earned > 0
        ? c.customers.map((cu) => (cu.phone === sale.customerPhone ? { ...cu, points: cu.points + earned } : cu))
        : c.customers;
      return {
        ...c, products, customers, stockMovements: [...movements, ...c.stockMovements],
        sales: c.sales.map((s) => (s.id === saleId ? { ...s, paymentStatus: "confirmado" } : s)),
      };
    });
  };

  const saveProduct = (record) => {
    updateCatalog((c) => { const exists = c.products.some((p) => p.id === record.id); return { ...c, products: exists ? c.products.map((p) => (p.id === record.id ? record : p)) : [record, ...c.products] }; });
    setScreen("products");
  };
  const deleteProduct = (id) => { if (confirm("¿Eliminar este producto?")) updateCatalog((c) => ({ ...c, products: c.products.filter((p) => p.id !== id), collections: c.collections.map((col) => ({ ...col, productIds: col.productIds.filter((pid) => pid !== id) })) })); };
  const importProducts = (upsertList, deleteSlugs = [], movements = []) => {
    updateCatalog((c) => {
      let products = c.products;
      if (deleteSlugs.length) {
        const delSet = new Set(deleteSlugs);
        products = products.filter((p) => !delSet.has(p.slug));
      }
      const bySlug = new Map(products.map((p) => [p.slug, p]));
      upsertList.forEach((imp) => {
        const existing = bySlug.get(imp.slug);
        bySlug.set(imp.slug, existing ? { ...imp, id: existing.id, collectionIds: existing.collectionIds, createdAt: existing.createdAt, images: imp.images.length ? imp.images : existing.images } : imp);
      });
      const finalProducts = [...bySlug.values()];
      const keptIds = new Set(finalProducts.map((p) => p.id));
      return {
        ...c, products: finalProducts,
        collections: c.collections.map((col) => ({ ...col, productIds: col.productIds.filter((pid) => keptIds.has(pid)) })),
        stockMovements: [...movements, ...c.stockMovements],
      };
    });
  };
  const attachBulkImages = (matches) => {
    updateCatalog((c) => ({
      ...c,
      products: c.products.map((p) => {
        const add = matches.filter((m) => m.productId === p.id).map((m) => ({ id: genId("img"), url: m.url, colorName: m.colorName || null }));
        return add.length ? { ...p, images: [...p.images, ...add] } : p;
      }),
    }));
  };
  const toggleProductActive = (id) => updateCatalog((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, status: p.status === "active" ? "borrador" : "active" } : p)) }));
  const toggleProductFeatured = (id) => updateCatalog((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, featured: !(p.featured !== false) } : p)) }));
  const toggleProductOnline = (id) => updateCatalog((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, showOnline: !(p.showOnline !== false) } : p)) }));
  const duplicateProduct = (id) => updateCatalog((c) => {
    const original = c.products.find((p) => p.id === id);
    if (!original) return c;
    const copyName = `${original.name} (copia)`;
    const copy = {
      ...original, id: genId("prod"), name: copyName, slug: slugify(copyName), status: "borrador",
      variants: original.variants.map((v) => ({ ...v, id: genId("var"), sku: `${slugify(copyName)}-${v.size}-${slugify(v.colorName)}`.toUpperCase() })),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    return { ...c, products: [copy, ...c.products] };
  });
  const saveBanner = (record) => { updateCatalog((c) => { const exists = c.banners.some((b) => b.id === record.id); return { ...c, banners: exists ? c.banners.map((b) => (b.id === record.id ? record : b)) : [...c.banners, record] }; }); setScreen("banners"); };
  const toggleBannerActive = (id) => updateCatalog((c) => ({ ...c, banners: c.banners.map((b) => (b.id === id ? { ...b, active: !b.active } : b)) }));
  const deleteBanner = (id) => { if (confirm("¿Eliminar este banner?")) updateCatalog((c) => ({ ...c, banners: c.banners.filter((b) => b.id !== id) })); };
  const saveCollection = (record) => { updateCatalog((c) => { const exists = c.collections.some((col) => col.id === record.id); return { ...c, collections: exists ? c.collections.map((col) => (col.id === record.id ? record : col)) : [...c.collections, record] }; }); setScreen("collections"); };
  const deleteCollection = (id) => { if (confirm("¿Eliminar esta colección?")) updateCatalog((c) => ({ ...c, collections: c.collections.filter((col) => col.id !== id) })); };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", background: C.paper, minHeight: 0 }}>
      <div className="app-content" style={{ flex: 1, overflowY: "auto", position: "relative", paddingBottom: 78 }}>
        {screen !== "productEditor" && screen !== "bannerEditor" && screen !== "collectionEditor" && <AdminTopBar title={`Fly · ${ROLE_LABELS[role] || role}`} onExit={onExit} />}
        {screen === "productEditor" && <AdminTopBar title={editingProductId ? "Editar producto" : "Nuevo producto"} onBack={() => setScreen("products")} onExit={onExit} />}
        {screen === "bannerEditor" && <AdminTopBar title={editingBannerId ? "Editar banner" : "Nuevo banner"} onBack={() => setScreen("banners")} onExit={onExit} />}
        {screen === "collectionEditor" && <AdminTopBar title={editingCollectionId ? "Editar colección" : "Nueva colección"} onBack={() => setScreen("collections")} onExit={onExit} />}

        {screen === "pos" && <PosScreen catalog={catalog} staffName={staffName} onCompleteSale={completeSale} onReserveNumber={reserveNumber} channel="tienda" title="Punto de Venta" />}
        {screen === "onlinesales" && <PosScreen catalog={catalog} staffName={staffName} onCompleteSale={completeSale} onReserveNumber={reserveNumber} channel="online" title="Registrar Venta Online" />}
        {screen === "mysales" && <MySalesScreen sales={catalog.sales} staffName={staffName} />}
        {screen === "stock" && <StockScreen catalog={catalog} staffName={staffName} onRegisterMovement={registerMovement} canEdit={role === "administrador" || role === "superadmin"} />}
        {(role === "administrador" || role === "superadmin") && screen === "dashboard" && <AdminDashboard catalog={catalog} updateCatalog={updateCatalog} setAdminScreen={setScreen} role={role} />}
        {(role === "administrador" || role === "superadmin") && screen === "products" && <AdminProductList catalog={catalog} openEditor={(id) => { setEditingProductId(id); setScreen("productEditor"); }} deleteProduct={deleteProduct} onImport={importProducts} onBulkPhotos={attachBulkImages} onToggleActive={toggleProductActive} onToggleFeatured={toggleProductFeatured} onToggleOnline={toggleProductOnline} onDuplicate={duplicateProduct} />}
        {(role === "administrador" || role === "superadmin") && screen === "productEditor" && <AdminProductEditor product={catalog.products.find((p) => p.id === editingProductId) || null} collections={catalog.collections} onSave={saveProduct} onCancel={() => setScreen("products")} />}
        {(role === "administrador" || role === "superadmin") && screen === "banners" && <AdminBannerList banners={catalog.banners} openEditor={(id) => { setEditingBannerId(id); setScreen("bannerEditor"); }} toggleActive={toggleBannerActive} deleteBanner={deleteBanner} />}
        {(role === "administrador" || role === "superadmin") && screen === "bannerEditor" && <AdminBannerEditor banner={catalog.banners.find((b) => b.id === editingBannerId) || null} onSave={saveBanner} onCancel={() => setScreen("banners")} />}
        {(role === "administrador" || role === "superadmin") && screen === "collections" && <AdminCollectionList collections={catalog.collections} openEditor={(id) => { setEditingCollectionId(id); setScreen("collectionEditor"); }} deleteCollection={deleteCollection} />}
        {(role === "administrador" || role === "superadmin") && screen === "collectionEditor" && <AdminCollectionEditor collection={catalog.collections.find((c) => c.id === editingCollectionId) || null} products={catalog.products} onSave={saveCollection} onCancel={() => setScreen("collections")} />}
        {(role === "administrador" || role === "superadmin") && screen === "invoices" && <AdminInvoicesScreen sales={catalog.sales} onVoid={voidSale} />}
        {(role === "administrador" || role === "superadmin") && screen === "reports" && <AdminReportsScreen catalog={catalog} />}
        {(role === "administrador" || role === "superadmin") && screen === "more" && <AdminMoreScreen setScreen={setScreen} onExit={onExit} role={role} />}
        {role === "superadmin" && screen === "users" && <AdminUsersScreen currentUserId={currentUserId} />}
        {role === "superadmin" && screen === "promocodes" && <AdminPromoCodesScreen promoCodes={catalog.promoCodes} onSave={savePromo} onDelete={deletePromo} />}
        {(role === "administrador" || role === "superadmin" || role === "vendedora_tienda" || role === "vendedora_online") && screen === "onlineorders" && <OnlineOrdersScreen sales={catalog.sales} onUpdateFulfillment={updateFulfillment} onValidatePayment={validateOnlinePayment} canValidate={role === "administrador" || role === "superadmin"} />}
      </div>
      <AdminNav screen={screen} setScreen={setScreen} role={role} />
    </div>
  );
};

/* ==================================================================== */
/*  ============================  APP ROOT  ============================*/
/* ==================================================================== */
export default function FlyBoutiqueApp() {
  const [catalog, setCatalog] = useState(null);
  const [screen, setScreen] = useState("home");
  const [activeCategory, setActiveCategory] = useState("Todo");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState([]);
  const [favs, setFavs] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [clubMember, setClubMember] = useState(null);
  const [viewedIds, setViewedIds] = useState([]);
  const [cartSessionId, setCartSessionId] = useState(null);
  const [showCookieConsent, setShowCookieConsent] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    const content = document.querySelector(".app-content");
    const onScroll = () => {
      const y = window.scrollY || content?.scrollTop || 0;
      setShowBackToTop(y > 500);
    };
    window.addEventListener("scroll", onScroll);
    content?.addEventListener("scroll", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); content?.removeEventListener("scroll", onScroll); };
  }, [screen]);
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector(".app-content")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [googleProfile, setGoogleProfile] = useState(null);
  const [infoSectionIndex, setInfoSectionIndex] = useState(0);
  useEffect(() => {
    (async () => {
      try { await window.storage.get(COOKIE_CONSENT_KEY, false); }
      catch (e) { setShowCookieConsent(true); /* nunca respondió, se le muestra */ }
    })();
  }, []);
  const resolveCookieConsent = (choice) => {
    setShowCookieConsent(false);
    try { window.storage.set(COOKIE_CONSENT_KEY, choice, false); } catch (e) { /* storage unavailable */ }
  };
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(SESSION_KEY, false);
        if (res?.value) { setCartSessionId(res.value); return; }
      } catch (e) { /* sin sesión guardada aún */ }
      const fresh = genId("sess");
      try { await window.storage.set(SESSION_KEY, fresh, false); } catch (e) { /* storage unavailable */ }
      setCartSessionId(fresh);
    })();
  }, []);
  const [mode, setMode] = useState("store"); // store | staffLogin | staff
  const [session, setSession] = useState(null); // { staffMember } — perfil de staff_profiles
  const [clubPoints, setClubPoints] = useState(0);
  const isStaffRef = useRef(false);
  const toastTimer = useRef(null);

  useEffect(() => {
    (async () => { const loaded = await loadCatalog(); setCatalog(loaded || seedCatalog()); })();
    (async () => { try { const res = await window.storage.get(WISHLIST_KEY, false); if (res?.value) setFavs(new Set(JSON.parse(res.value))); } catch (e) { /* no wishlist saved yet */ } })();
    (async () => { try { const res = await window.storage.get(CLUB_KEY, false); if (res?.value) setClubMember(JSON.parse(res.value)); } catch (e) { /* not registered yet */ } })();
    (async () => { try { const res = await window.storage.get(VIEWED_KEY, false); if (res?.value) setViewedIds(JSON.parse(res.value)); } catch (e) { /* sin historial aún */ } })();
  }, []);

  // Solo el staff guarda en Supabase; lo que hace una clienta va por funciones del servidor.
  const updateCatalog = (updater) => setCatalog((prev) => { const next = updater(prev); if (isStaffRef.current) persistStaffChanges(next, prev); return next; });

  // ---- Panel del staff: se abre solo con la dirección /#staff ----
  useEffect(() => {
    const check = () => { if (window.location.hash === "#staff") setMode((m) => (m === "store" ? "staffLogin" : m)); };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const clearStaffHash = () => { try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* sin history */ } };
  const refreshPrivate = async () => {
    try { const priv = await loadPrivateData(); setCatalog((c) => (c ? { ...c, ...priv } : c)); }
    catch (e) { console.warn("No se pudieron cargar los datos privados:", e); }
  };
  const enterStaff = (profile) => {
    isStaffRef.current = true;
    setSession({ staffMember: profile });
    setMode("staff");
    refreshPrivate();
  };
  const exitStaff = async (reason) => {
    isStaffRef.current = false;
    try { await supabase.auth.signOut(); } catch (e) { /* sin conexión */ }
    setSession(null);
    setMode("store");
    setCatalog((c) => (c ? { ...c, sales: [], customers: [], stockMovements: [], staff: [] } : c));
    clearStaffHash();
    if (reason) showToast(reason);
  };
  const reserveNumber = async (serie) => {
    const { data, error } = await supabase.rpc("next_doc_number", { p_serie: serie });
    if (error) throw error;
    return data;
  };
  // Mientras el panel está abierto: trae pedidos nuevos cada 45 s y cierra la sesión tras 30 min sin uso.
  useEffect(() => {
    if (mode !== "staff") return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    const onFocus = () => refreshPrivate();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => {
      if (Date.now() - last > STAFF_IDLE_MINUTES * 60 * 1000) exitStaff("Sesión cerrada por inactividad");
      else refreshPrivate();
    }, 45000);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); events.forEach((ev) => window.removeEventListener(ev, touch)); };
  }, [mode]);

  const showToast = (msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2200); };

  const trackView = (productId) => {
    setViewedIds((prev) => {
      const next = [productId, ...prev.filter((id) => id !== productId)].slice(0, MAX_VIEWED);
      try { window.storage.set(VIEWED_KEY, JSON.stringify(next), false); } catch (e) { /* storage unavailable */ }
      return next;
    });
  };
  const openProduct = (product) => { trackView(product.id); setSelectedProduct(product); };
  const removeFromViewed = (productId) => {
    setViewedIds((prev) => {
      const next = prev.filter((id) => id !== productId);
      try { window.storage.set(VIEWED_KEY, JSON.stringify(next), false); } catch (e) { /* storage unavailable */ }
      return next;
    });
  };

  const syncReservation = (variantId, qty) => {
    if (!variantId || !cartSessionId) return;
    supabase.rpc("set_reservation", { p_session: cartSessionId, p_variant: variantId, p_qty: qty }).then(({ error }) => { if (error) console.warn("Reserva no guardada:", error.message); });
    setCatalog((c) => {
      const others = (c.reservations || []).filter((r) => !(r.sessionId === cartSessionId && r.variantId === variantId));
      if (qty <= 0) return { ...c, reservations: others };
      return { ...c, reservations: [...others, { sessionId: cartSessionId, variantId, qty, expiresAt: Date.now() + RESERVATION_MINUTES * 60 * 1000 }] };
    });
  };
  const clearMyReservations = () => {
    if (cartSessionId) supabase.rpc("clear_reservations", { p_session: cartSessionId });
    setCatalog((c) => ({ ...c, reservations: (c.reservations || []).filter((r) => r.sessionId !== cartSessionId) }));
  };

  const addToCart = (product, size, color, qty) => {
    const variant = product.variants.find((v) => v.size === size && v.colorName === color?.n);
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.size === size && i.color?.n === color?.n);
      const newQty = existing ? existing.qty + qty : qty;
      syncReservation(variant?.id, newQty);
      if (existing) return prev.map((i) => (i.cartId === existing.cartId ? { ...i, qty: newQty } : i));
      return [...prev, { cartId: genId("cart"), productId: product.id, variantId: variant?.id, name: product.name, price: product.price, image: mainImageUrl(product), size, color, qty }];
    });
    setSelectedProduct(null);
    showToast("Agregado a tu cesta — reservado por 15 minutos");
  };
  const updateQty = (cartId, delta) => setCart((prev) => {
    const next = prev.map((i) => (i.cartId === cartId ? { ...i, qty: Math.max(1, i.qty + delta) } : i)).filter((i) => i.qty > 0);
    const item = next.find((i) => i.cartId === cartId);
    syncReservation(item?.variantId, item?.qty || 0);
    return next;
  });
  const removeItem = (cartId) => setCart((prev) => {
    const item = prev.find((i) => i.cartId === cartId);
    if (item) syncReservation(item.variantId, 0);
    return prev.filter((i) => i.cartId !== cartId);
  });
  const toggleFav = (id) => setFavs((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id);
    try { window.storage.set(WISHLIST_KEY, JSON.stringify([...next]), false); } catch (e) { /* storage unavailable */ }
    return next;
  });
  const addReview = async (productId, review) => {
    const { data, error } = await supabase.rpc("add_review", { p_product: productId, p_review: review });
    if (error) { alert(error.message?.includes("FOTO") ? "La foto es muy pesada. Prueba con otra." : "No se pudo publicar tu reseña. Intenta de nuevo."); return; }
    setCatalog((c) => ({ ...c, reviews: { ...c.reviews, [productId]: [...(c.reviews[productId] || []), data] } }));
    showToast("Gracias, tu reseña ya está publicada");
  };
  const confirmOnlineOrder = async ({ cart: orderCart, subtotal, shipping, discount, promoCode, total, deliveryMethod, deliveryAddress, customerName, customerPhone, paymentMethod }) => {
    // Primera revisión rápida en el navegador; la definitiva la hace el servidor (stock y precios reales).
    for (const item of orderCart) {
      const product = catalog.products.find((p) => p.id === item.productId);
      const variant = product?.variants.find((v) => v.id === item.variantId) || product?.variants.find((v) => v.size === item.size && v.colorName === item.color?.n);
      const realStock = variant ? variant.stock : 0;
      if (realStock < item.qty) {
        alert(`Lo sentimos, "${item.name}" (${item.size}/${item.color?.n}) ya no tiene suficiente stock (quedan ${realStock}). Ajusta la cantidad en tu cesta antes de continuar.`);
        return null;
      }
    }
    const payload = {
      items: orderCart.map((i) => ({ productId: i.productId, variantId: i.variantId || null, name: i.name, size: i.size, colorName: i.color?.n, qty: i.qty, unitPrice: i.price })),
      subtotal, discount, promoCode, shipping, total, paymentMethod, customerName, customerPhone, deliveryMethod, deliveryAddress,
    };
    // El servidor asigna el número, revisa stock y precios, y marca el pago como "por validar".
    // El stock se descuenta recién cuando Administración valida que el pago llegó.
    const { data, error } = await supabase.rpc("place_order", { p_sale: payload, p_session: cartSessionId || "" });
    if (error) {
      const m = error.message || "";
      if (m.includes("SIN_STOCK")) alert(`Lo sentimos, "${m.split("SIN_STOCK:")[1] || "una prenda"}" ya no tiene stock suficiente. Ajusta tu cesta.`);
      else if (m.includes("PRECIO_CAMBIO")) alert("El precio de una prenda cambió. Recarga la página para ver el precio actualizado.");
      else alert("No se pudo registrar tu pedido. Revisa tu conexión e intenta de nuevo.");
      return null;
    }
    setCatalog((c) => ({ ...c, reservations: (c.reservations || []).filter((r) => r.sessionId !== cartSessionId) }));
    setCart([]);
    if (clubMember?.google && !clubMember.phone && customerPhone) {
      const member = { ...clubMember, phone: customerPhone };
      setClubMember(member);
      try { window.storage.set(CLUB_KEY, JSON.stringify(member), false); } catch (e) { /* storage unavailable */ }
    }
    return data;
  };

  const registerClub = async (data) => {
    const { data: c, error } = await supabase.rpc("register_customer", { p_name: data.name, p_phone: data.phone, p_email: data.email || "", p_captcha: data.captcha || null });
    if (error || !c) {
      const m = error?.message || "";
      alert(m.includes("CAPTCHA") ? "No pudimos confirmar la verificación. Intenta de nuevo." : m.includes("CORREO") ? "Revisa tu correo, no se ve válido." : "No se pudo completar el registro. Revisa tus datos e intenta de nuevo.");
      return false;
    }
    const member = { name: c.name, phone: c.phone, email: c.email || "" };
    setClubMember(member);
    setClubPoints(Number(c.points) || 0);
    try { window.storage.set(CLUB_KEY, JSON.stringify(member), false); } catch (e) { /* storage unavailable */ }
    showToast(c.existing ? `¡Hola de nuevo, ${member.name.split(" ")[0]}!` : `¡Bienvenida al Club Fly, ${member.name.split(" ")[0]}!`);
    return true;
  };
  useEffect(() => {
    if (!clubMember?.phone) { if (!clubMember?.google) setClubPoints(0); return; }
    supabase.rpc("customer_points", { p_phone: clubMember.phone }).then(({ data }) => setClubPoints(Number(data) || 0)).catch(() => {});
  }, [clubMember?.phone]);
  const points = clubMember ? clubPoints : 0;
  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
      if (error) alert("No se pudo iniciar con Google: " + error.message + " — revisa que Google esté activado en Supabase (Authentication → Providers).");
    } catch (e) { alert("No se pudo iniciar con Google: " + e.message); }
  };
  // Solo cuenta como "sesión de Google" si de verdad entró con Google. Una sesión del
  // staff (usuario@staff.flyboutique.pe) que quedó abierta en el navegador no se usa aquí.
  const googleUser = (u) => {
    if (!u || String(u.email || "").endsWith("@" + STAFF_EMAIL_DOMAIN)) return null;
    const viaGoogle = u.app_metadata?.provider === "google" || (u.app_metadata?.providers || []).includes("google") || (u.identities || []).some((i) => i.provider === "google");
    return viaGoogle ? { name: u.user_metadata?.full_name || u.user_metadata?.name || "", email: u.email || "" } : null;
  };
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const g = googleUser(data?.session?.user);
      if (g && !clubMember) setGoogleProfile(g);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setGoogleProfile(googleUser(session?.user));
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);
  // Al volver de Google, la clienta queda registrada sola (sin formulario ni captcha:
  // Google ya confirmó que es una persona real). El celular se pide recién al comprar.
  useEffect(() => {
    if (!googleProfile?.email) return;
    if (clubMember && !clubMember.google) return; // ya tiene cuenta manual en este navegador
    if (clubMember?.google && clubMember.email === googleProfile.email && clubMember.phone) return;
    supabase.rpc("register_google_customer").then(({ data: c, error }) => {
      if (error || !c) return; // si falla, queda el formulario normal
      const member = { name: c.name, phone: c.phone || "", email: c.email, google: true };
      const isNew = !clubMember;
      setClubMember(member);
      setClubPoints(Number(c.points) || 0);
      try { window.storage.set(CLUB_KEY, JSON.stringify(member), false); } catch (e) { /* storage unavailable */ }
      if (isNew) showToast(c.existing ? `¡Hola de nuevo, ${member.name.split(" ")[0]}!` : `¡Bienvenida al Club Fly, ${member.name.split(" ")[0]}!`);
    });
  }, [googleProfile?.email]);

  const redeemReward = async (reward) => {
    if (!clubMember || points < reward.cost) return;
    const { data, error } = await supabase.rpc("redeem_points", { p_phone: clubMember.phone, p_cost: reward.cost });
    if (error) { showToast("No tienes puntos suficientes"); return; }
    setClubPoints(Number(data) || 0);
    showToast(`Canjeaste: ${reward.n}`);
  };
  const logoutClub = () => {
    if (clubMember?.google) { try { supabase.auth.signOut(); } catch (e) { /* sin conexión */ } setGoogleProfile(null); }
    setClubMember(null); try { window.storage.delete(CLUB_KEY, false); } catch (e) { /* storage unavailable */ } showToast("Cerraste sesión de Club Fly"); };

  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.qty, 0), [cart]);

  const frameStyle = { width: "100%", maxWidth: 430, height: "92vh", background: C.paper, position: "relative", borderRadius: 20, overflow: "hidden", boxShadow: "0 30px 70px rgba(21,19,18,0.3)", border: `8px solid ${C.ink}`, display: "flex", flexDirection: "column" };

  return (
    <div className="app-page" style={{ width: "100%", minHeight: "100vh", background: "#D9D9D9", display: "flex", justifyContent: "center", padding: "18px 0", boxSizing: "border-box", fontFamily: FONT_BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,500;0,700;0,800;0,900&family=Jost:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body { height: 100%; overflow: hidden; margin: 0; }
        #root { height: 100%; }
        .app-content::-webkit-scrollbar, .hscroll::-webkit-scrollbar { display: none; }
        .app-content { scrollbar-width: none; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes popIn { from { transform: scale(.97); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes galleryIn { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes toastIn { from { transform: translate(-50%, -10px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        button { font-family: inherit; }
        input:focus, button:focus-visible, select:focus, textarea:focus { outline: 2px solid ${C.ink}; outline-offset: 2px; }

        /* ---------- Celular: la app ocupa TODA la pantalla ---------- */
        /* En celular y tablet. Antes se dibujaba un "marco de teléfono" dentro del propio teléfono (con bordes
           negros y fondo gris), por eso se veía pequeña y cuadrada. */
        @media (max-width: 899px) {
          .app-page { padding: 0 !important; background: ${C.paper} !important; }
          .app-frame { max-width: none !important; height: 100vh !important; height: 100dvh !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
          .pdp-slide { max-height: 64vh; }
        }
        @media (min-width: 600px) and (max-width: 899px) {
          .product-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        .back-top { bottom: 92px !important; }
        .pdp-thumbs { display: none; }
        .pdp-arrow { display: none !important; }
        @media (hover: hover) { .hint-touch { display: none !important; } }
        @media (hover: none) { .hint-mouse { display: none !important; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }

        /* ---------- Adaptación a pantallas grandes (tablet/PC) ---------- */
        /* En celular el menú va abajo (como cualquier app); en pantallas anchas
           sube arriba, como una barra de navegación web normal — más cómodo
           para usar con mouse/teclado. Todo lo demás se acomoda solo. */
        @media (min-width: 900px) {
          /* Fondo blanco parejo: sin franjas grises a los lados */
          .app-page { padding: 0 !important; background: ${C.paper} !important; }
          .app-frame {
            max-width: 1240px !important; width: 100% !important;
            height: auto !important; min-height: 100vh !important;
            border-width: 0 !important; border-radius: 0 !important; box-shadow: none !important;
            overflow: visible !important;
          }
          html, body { overflow: auto !important; }
          /* La franja negra y el menú van DENTRO del mismo contenedor que el contenido
             (pegados arriba al bajar), así siempre quedan alineados y centrados.
             El color se extiende de borde a borde de la pantalla. */
          .app-ticker {
            display: block !important; order: -2; position: sticky !important; top: 0; z-index: 51;
            box-shadow: 0 0 0 100vmax ${C.ink}; clip-path: inset(0 -100vmax);
          }
          .app-nav {
            order: -1; position: sticky !important; top: 28px !important; bottom: auto !important; left: auto !important; right: auto !important;
            transform: none !important; width: 100% !important; z-index: 50 !important;
            background: ${C.paper} !important; border-top: none !important; border-bottom: 1px solid ${C.line} !important;
            box-shadow: 0 0 0 100vmax ${C.paper}; clip-path: inset(0 -100vmax -1px);
            justify-content: flex-start !important; gap: 6px !important; padding: 10px 20px !important;
          }
          .app-nav .nav-brand { display: flex !important; margin-right: 22px; transition: transform .2s ease; }
          .app-nav .nav-brand:hover { transform: scale(1.04); }
          .app-nav .nav-brand-hint { opacity: 0; transition: opacity .2s ease; }
          .app-nav .nav-brand:hover .nav-brand-hint { opacity: 1; }
          .app-nav .nav-search { display: flex !important; flex: 1 1 auto; max-width: 520px; margin-right: auto; }
          .app-nav .nav-search:hover { border-color: ${C.ink} !important; }
          .app-nav .nav-item {
            flex-direction: row !important; flex: none !important; gap: 8px !important;
            padding: 10px 14px !important; border-radius: 999px !important;
          }
          .app-nav .nav-item:hover, .app-nav .nav-item.is-active { background: ${C.paperDeep} !important; }
          .app-nav .nav-label { font-size: 13px !important; }
          .app-header { display: none !important; }
          /* Panel del staff en PC: menú arriba (fijo al bajar) y título debajo, sin superponerse */
          .staff-nav {
            order: -1; position: sticky !important; top: 0 !important; bottom: auto !important; left: auto !important; right: auto !important;
            width: 100% !important; z-index: 50 !important; background: ${C.paper} !important;
            border-top: none !important; border-bottom: 1px solid ${C.line} !important;
            box-shadow: 0 0 0 100vmax ${C.paper}; clip-path: inset(0 -100vmax -1px);
            justify-content: flex-start !important; gap: 6px !important; padding: 12px 20px !important;
          }
          .staff-nav .nav-item { flex-direction: row !important; flex: none !important; gap: 8px !important; padding: 10px 14px !important; border-radius: 999px !important; }
          .staff-nav .nav-item:hover, .staff-nav .nav-item.is-active { background: ${C.paperDeep} !important; }
          .staff-nav .nav-label { font-size: 13px !important; }
          .admin-topbar { position: static !important; margin: 16px 20px 0; border-radius: 12px; }
          .app-content { overflow-y: visible !important; height: auto !important; padding-bottom: 0 !important; padding-top: 0 !important; }
          /* Banner con los mismos márgenes que la grilla de productos */
          .hero { margin: 20px 20px 32px !important; border-radius: 16px; }
          .product-grid { grid-template-columns: repeat(4, 1fr) !important; }
          .back-top { bottom: 28px !important; }
          .app-toast { top: 130px !important; }
          .filter-bar { top: 113px !important; }
          /* Ventanas que en celular suben desde abajo: en PC aparecen centradas */
          .overlay-sheet { justify-content: center !important; align-items: center !important; }
          .sheet-panel { width: 540px; max-width: 92vw; border-radius: 16px !important; max-height: 86vh !important; }
          .sheet-small { width: 400px; }
          /* Ficha de producto en PC: ventana centrada; se cierra tocando afuera */
          .pdp-overlay { justify-content: center !important; align-items: center !important; }
          .pdp { width: min(1040px, 92vw); height: auto !important; max-height: 88vh; border-radius: 16px !important; animation: popIn .25s cubic-bezier(.2,.8,.2,1) !important; }
          .pdp-wrap { display: grid !important; grid-template-columns: minmax(0, 440px) minmax(0, 1fr); gap: 36px; padding: 22px 28px 30px; align-items: start; }
          .pdp-info { padding: 0 !important; }
          .pdp-slide { aspect-ratio: auto !important; height: min(calc(88vh - 150px), 590px); border-radius: 12px; }
          .pdp-buybar { display: none !important; }
          .pdp-inline-buy { display: block !important; }
          .pdp-thumbs { display: flex; }
          .pdp-arrow { display: flex !important; }
        }
      `}</style>

      <div className="app-frame" style={frameStyle}>
        {!catalog ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, background: C.paper }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 52, fontWeight: 900, color: C.ink, letterSpacing: "0.04em" }}>FLY</div>
            <div className="spin" style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.line}`, borderTopColor: C.ink }} />
          </div>
        ) : mode === "staffLogin" ? (
          <StaffAccess onDone={enterStaff} onCancel={() => { setMode("store"); clearStaffHash(); }} />
        ) : mode === "staff" && session ? (
          <StaffApp catalog={catalog} updateCatalog={updateCatalog} role={session.staffMember.role} staffName={session.staffMember.name} staffUsername={session.staffMember.username}
            currentUserId={session.staffMember.user_id} reserveNumber={reserveNumber} onExit={() => exitStaff("Sesión cerrada")} />
        ) : (
          <>
            <div className="app-content" style={{ flex: 1, overflowY: "auto", position: "relative", paddingBottom: 78 }}>
              <Header onSearch={() => setSearchOpen(true)} onBell={() => showToast("Sin notificaciones nuevas")} onHome={() => { setScreen("home"); try { document.querySelector(".app-content")?.scrollTo({ top: 0, behavior: "smooth" }); window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { /* sin scroll */ } }} />
              {screen === "home" && <HomeScreen catalog={catalog} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} setScreen={setScreen} setActiveCategory={setActiveCategory} points={points} notifyMe={() => showToast("Te avisaremos primero ✓")} viewedIds={viewedIds} onQuickAdd={addToCart} cartSessionId={cartSessionId} onOpenInfo={(i) => { setInfoSectionIndex(i); setScreen("info"); }} />}
              {screen === "info" && <InfoScreen sectionIndex={infoSectionIndex} setScreen={setScreen} />}
              {screen === "category" && <CategoryScreen catalog={catalog} activeCategory={activeCategory} setActiveCategory={setActiveCategory} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} onQuickAdd={addToCart} cartSessionId={cartSessionId} />}
              {screen === "viewed" && <ViewedScreen catalog={catalog} viewedIds={viewedIds} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} onQuickAdd={addToCart} cartSessionId={cartSessionId} onRemoveViewed={removeFromViewed} setScreen={setScreen} />}
              {screen === "cart" && <CartScreen cart={cart} updateQty={updateQty} removeItem={removeItem} setScreen={setScreen} culqiPublicKey={catalog.settings?.culqiPublicKey} payAccounts={catalog.settings}
                promoCodes={catalog.promoCodes} clubMember={clubMember} onConfirmOrder={confirmOnlineOrder} />}
              {screen === "loyalty" && <LoyaltyScreen points={points} onRedeem={redeemReward} clubMember={clubMember} onRegister={registerClub} onLogoutClub={logoutClub} onGoogleSignIn={signInWithGoogle} googlePrefill={googleProfile} turnstileSiteKey={catalog.settings?.turnstileSiteKey || ""} />}
              {screen === "profile" && <ProfileScreen points={points} favCount={favs.size} clubMember={clubMember} onLogoutClub={logoutClub} setScreen={setScreen} catalog={catalog} />}
              {screen === "orders" && <OrdersScreen catalog={catalog} clubMember={clubMember} setScreen={setScreen} />}
            </div>
            <div className="app-ticker" style={{ display: "none" }}><Marquee /></div>
            <BottomNav screen={screen} setScreen={setScreen} cartCount={cartCount} onSearch={() => setSearchOpen(true)} />
            {searchOpen && <SearchOverlay products={catalog.products.filter((p) => p.showOnline !== false)} onClose={() => setSearchOpen(false)} onOpenProduct={(p) => { openProduct(p); setSearchOpen(false); }} />}
            {selectedProduct && <ProductSheet product={selectedProduct} onClose={() => setSelectedProduct(null)} onAdd={addToCart} fav={favs.has(selectedProduct.id)} onToggleFav={toggleFav}
              reviews={catalog.reviews} onAddReview={addReview} collections={catalog.collections} allProducts={catalog.products} onOpenProduct={openProduct} catalog={catalog} cartSessionId={cartSessionId} />}
            {toast && <Toast message={toast} />}
            {showCookieConsent && <CookieConsent onAcceptAll={() => resolveCookieConsent("all")} onEssentialOnly={() => resolveCookieConsent("essential")} />}
            {showBackToTop && (
              <button className="back-top" onClick={scrollToTop} aria-label="Volver arriba" style={{ position: "fixed", bottom: 28, right: 28, zIndex: 55, width: 44, height: 44, borderRadius: "50%", background: C.ink, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(0,0,0,0.25)" }}>
                <ChevronUp size={20} color={C.white} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
