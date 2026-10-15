import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Home, LayoutGrid, ShoppingBag, Star, User, Search, Heart, X, Plus, Minus, Eye, ChevronUp,
  ChevronRight, ChevronDown, Sparkles, MapPin, Bell, Award, Gift, Ticket, Trash2, Clock, Check,
  LogOut, CreditCard, Package, Settings2, SlidersHorizontal, ArrowUpDown,
  Mail, Pencil, Upload, Image as ImageIcon, KeyRound, LayoutDashboard,
  Layers, AlertCircle, ArrowLeft, Link as LinkIcon, ShieldCheck, Loader2,
  FileText, Truck, ArrowLeftRight, UserCog, Images, FolderArchive, ClipboardList, History, Share, SquarePlus, Contact, BadgePercent, Wallet, BookOpenCheck, HardDriveDownload,
  MessageCircle, Download, FileSpreadsheet, Users, ShoppingCart, Menu, BarChart3, Undo2, Receipt, Scan, Ruler, Navigation, Cookie, BookOpen, Globe, Store, Banknote, Smartphone, Landmark, RotateCcw, DatabaseBackup, Play, EyeOff,
} from "lucide-react";
// Excel y códigos de barras solo se descargan cuando el staff los usa (la tienda abre más rápido en celular)
const loadXLSX = () => import("xlsx");
let jsBarcodeMod = null;
const loadJsBarcode = () => (jsBarcodeMod ||= import("jsbarcode").then((m) => m.default || m));
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import { supabase, setStaffSessionMode, clearStaffSessionMode } from "./supabaseClient.js";
import { t, getLang, setLang, setStaffMode } from "./i18n.js";

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
// Sin filtros de color sobre las fotos: se ven tal cual son y el deslizar es más fluido en equipos antiguos.
const imgGrade = {};
const STORAGE_KEY = "flyboutique:catalog:v1";
const WISHLIST_KEY = "flyboutique:wishlist:v1";
const CLUB_KEY = "flyboutique:clubmember:v1";
const VIEWED_KEY = "flyboutique:viewed:v1";
const MAX_VIEWED = 10;
const SESSION_KEY = "flyboutique:session:v1";
const CART_KEY = "flyboutique:cesta:v1"; // la cesta sobrevive a «Actualizar» y a recargar (se borra con lo personal tras 1 h sin uso)
const COOKIE_CONSENT_KEY = "flyboutique:cookieconsent:v1";

// Estadísticas: Google Analytics 4 (visitas, de dónde vienen, embudo de compra) y
// Microsoft Clarity (mapas de calor y grabaciones anónimas: dónde se traban las clientas).
// Solo se cargan si la clienta aceptó "Aceptar todo" en el aviso de cookies.
function scrollAllTop(smooth = false) {
  const opts = { top: 0, left: 0, behavior: smooth ? "smooth" : "auto" };
  try {
    window.scrollTo(opts);
    [document.scrollingElement, document.documentElement, document.body, ...document.querySelectorAll(".app-content")].forEach((el) => {
      if (!el) return;
      if (el.scrollTo) el.scrollTo(opts); else { el.scrollTop = 0; el.scrollLeft = 0; }
    });
  } catch (e) { /* sin scroll */ }
}
let analyticsLoaded = false;
function loadAnalytics({ gaId, clarityId }) {
  if (analyticsLoaded || typeof document === "undefined") return;
  analyticsLoaded = true;
  if (gaId) {
    const sc = document.createElement("script");
    sc.async = true; sc.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(sc);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", gaId, { send_page_view: false });
  }
  if (clarityId) {
    (function (c, l, a, r, i) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      const t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
      const y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", clarityId);
  }
}
function track(event, params = {}) {
  try {
    if (window.gtag) window.gtag("event", event, params);
    if (window.clarity) window.clarity("event", event);
  } catch (e) { /* sin estadísticas */ }
}
const gaItem = (p, extra = {}) => ({ item_id: p.id, item_name: p.name, item_category: p.category, price: p.price, ...extra });
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
const CATEGORY_GROUPS = [["Ropa", ["Vestidos", "Blusas", "Pantalones", "Faldas", "Abrigos"]], ["Calzado", ["Calzado"]], ["Accesorios", ["Accesorios"]]];
const groupOfCategory = (cat) => (CATEGORY_GROUPS.find(([, cats]) => cats.includes(cat)) || ["Ropa"])[0];
const genId = (p = "id") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (n) => `S/ ${Number(n || 0).toFixed(0)}`;
const money2 = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
// Igual que money(), pero muestra céntimos si el monto no es entero (ej. valor de los puntos S/ 2.50)
const moneyExact = (n) => (Number.isInteger(Number(n || 0)) ? money(n) : `S/ ${Number(n).toFixed(2)}`);

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

// Minutos que una prenda queda apartada en la cesta (se cambia en Staff → Pedidos Online; entre 5 y 60).
const cartHoldMinutes = (settings = SHOP_SETTINGS) => Math.min(60, Math.max(5, Math.round(Number(settings?.cartHoldMinutes) || 20)));
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
const ROLE_LABELS = { superadmin: "Super Administrador", administrador: "Administrador", cajero: "Cajero(a)", vendedora_tienda: "Vendedora Tienda", vendedora_online: "Vendedora Online", almacen: "Almacén" };

/* ------------------------------------------------------------------ */
/*  STORAGE — Supabase con permisos separados                            */
/* ------------------------------------------------------------------ */
// Público (lo lee cualquiera): catálogo, banners, colecciones, códigos y datos de pago.
// Privado (solo staff con sesión): ventas, clientas, movimientos de stock.
// Las clientas nunca escriben directo: usan funciones del servidor (place_order, etc.).
const PUBLIC_KEYS = ["products", "collections", "banners", "settings", "promoCodes"];
const pickPublic = (c) => Object.fromEntries(PUBLIC_KEYS.map((k) => [k, c[k]]));

// Unidades apartadas en carritos de OTRAS clientas (el servidor no muestra los códigos de carrito ajenos).
async function loadReservations() {
  let mySession = "";
  try { mySession = localStorage.getItem(SESSION_KEY) || ""; } catch (e) { /* sin sesión guardada */ }
  const { data, error } = await supabase.rpc("reserved_stock", { p_session: mySession });
  if (!error) return (data || []).map((r) => ({ sessionId: "otras", variantId: r.variant_id, qty: Number(r.qty) || 0, expiresAt: Number.MAX_SAFE_INTEGER }));
  // Si aún no se corrió el SQL de la Fase 2a, se usa la lectura anterior
  const old = await supabase.from("reservations").select("session_id,variant_id,qty,expires_at").gt("expires_at", new Date().toISOString());
  return (old.data || []).map((r) => ({ sessionId: r.session_id, variantId: r.variant_id, qty: r.qty, expiresAt: new Date(r.expires_at).getTime() }));
}

// Devuelve el catálogo, o null si la tienda aún no tiene catálogo guardado.
// Si falla la conexión, lanza un error: nunca se muestra (ni se guarda) el catálogo de muestra en su lugar.
async function loadCatalog() {
  // Pedidos web sin pago vencidos: el servidor los anula y libera su stock (no espera respuesta)
  supabase.rpc("expire_unpaid_orders").then(() => {}, () => {});
  const [main, rev, reservations] = await Promise.all([
    supabase.from("store_data").select("data").eq("id", "main").maybeSingle(),
    supabase.from("product_reviews").select("product_id,data").order("created_at"),
    loadReservations().catch(() => []),
  ]);
  if (main.error) throw main.error;
  if (!main.data?.data) return null;
  const reviews = {};
  (rev.data || []).forEach((r) => { (reviews[r.product_id] = reviews[r.product_id] || []).push(r.data); });
  return normalizeCatalog({ ...main.data.data, reviews, reservations, staff: [], sales: [], customers: [], stockMovements: [] });
}

async function loadPrivateData() {
  const [sales, customers, priv] = await Promise.all([
    supabase.from("sales").select("data").order("created_at", { ascending: false }).limit(3000),
    supabase.from("customers").select("phone,data"),
    supabase.from("store_private").select("data").eq("id", "main").maybeSingle(),
  ]);
  if (sales.error) throw sales.error;
  return {
    sales: (sales.data || []).map((r) => r.data),
    // Las cuentas de Google sin celular guardan el celular vacío: se usa la clave de la fila (g:correo)
    customers: (customers.data || []).map((r) => (r.data?.phone ? r.data : { ...r.data, phone: r.phone })),
    stockMovements: priv.data?.data?.stockMovements || [],
  };
}

// Guarda el catálogo sin pisar el stock real: el servidor conserva el stock actual de cada variante
// y solo aplica los cambios de stock hechos a propósito en este cambio (diferencia entre antes y después).
async function saveCatalogSafely(next, prev) {
  const prevStock = new Map();
  (prev?.products || []).forEach((p) => (p.variants || []).forEach((v) => prevStock.set(v.id, Number(v.stock) || 0)));
  const deltas = {};
  (next.products || []).forEach((p) => (p.variants || []).forEach((v) => {
    if (!prevStock.has(v.id)) return;
    const diff = (Number(v.stock) || 0) - prevStock.get(v.id);
    if (diff) deltas[v.id] = diff;
  }));
  // Solo se mandan los productos y secciones que ESTA persona cambió: si otra persona editó otro producto
  // al mismo tiempo, el servidor conserva su cambio (no se pisan).
  const prevById = new Map((prev?.products || []).map((p) => [p.id, p]));
  const nextIds = new Set((next.products || []).map((p) => p.id));
  const changed = (next.products || []).filter((p) => prevById.get(p.id) !== p).map((p) => p.id);
  const deleted = (prev?.products || []).filter((p) => !nextIds.has(p.id)).map((p) => p.id);
  const keys = PUBLIC_KEYS.filter((k) => k !== "products" && prev && next[k] !== prev[k]);
  let res = prev
    ? await supabase.rpc("save_catalog", { p_data: pickPublic(next), p_stock_deltas: deltas, p_changed: changed, p_deleted: deleted, p_keys: keys })
    : { error: { code: "PGRST202" } };
  // Si aún no se corrió el SQL 14, se guarda como antes (todo el catálogo, respetando el stock)
  if (res.error?.code === "PGRST202") res = await supabase.rpc("save_catalog", { p_data: pickPublic(next), p_stock_deltas: deltas });
  // Si tampoco existe el de la Fase 2a
  if (res.error?.code === "PGRST202") return supabase.from("store_data").upsert({ id: "main", data: pickPublic(next), updated_at: new Date().toISOString() });
  return res;
}

// Guarda solo lo que cambió (y solo si quien guarda es staff).
let STAFF_CAN_WRITE = false; // solo Super Admin y Administrador guardan cambios directos
async function persistStaffChanges(next, prev) {
  if (!STAFF_CAN_WRITE) return;
  const tasks = [];
  if (!prev || JSON.stringify(pickPublic(next)) !== JSON.stringify(pickPublic(prev))) tasks.push(saveCatalogSafely(next, prev));
  const prevSales = new Map((prev?.sales || []).map((s) => [s.id, s]));
  const changedSales = (next.sales || []).filter((s) => s.id && prevSales.get(s.id) !== s);
  if (changedSales.length) tasks.push(supabase.from("sales").upsert(changedSales.map((s) => ({ id: s.id, data: s, created_at: new Date(s.createdAt || Date.now()).toISOString() }))));
  const prevCust = new Map((prev?.customers || []).map((c) => [c.phone, c]));
  const changedCust = (next.customers || []).filter((c) => c.phone && prevCust.get(c.phone) !== c);
  if (changedCust.length) tasks.push(supabase.from("customers").upsert(changedCust.map((c) => ({ phone: c.phone, data: c }))));
  // El historial de stock ya no se sube desde aquí: lo anota la base de datos sola (SQL 14), sin que nadie lo pise.
  try {
    const results = await Promise.all(tasks);
    const err = results.find((r) => r.error)?.error;
    if (err) {
      console.error("No se pudo guardar:", err);
      const m = err.message || "";
      alert(m.includes("PRECIO_INVALIDO") ? "No se guardó: hay un precio vacío, negativo o demasiado alto. Revisa el precio y vuelve a guardar."
        : m.includes("CODIGO_REPETIDO") ? `No se guardó: el código ${m.split("CODIGO_REPETIDO:")[1] || ""} ya lo tiene otra prenda. Cada talla y color necesita su propio código.`
        : "No se pudo guardar el cambio: " + m + "\nSi dice 'row-level security', vuelve a iniciar sesión.");
      if (/PRECIO_INVALIDO|CODIGO_REPETIDO/.test(m)) window.location.reload(); // vuelve a mostrar lo que sí está guardado
    }
  } catch (e) { console.error(e); alert("No se pudo guardar el cambio. Revisa tu conexión."); }
}

/* ------------------------------------------------------------------ */
/*  IMAGE HELPERS                                                       */
/* ------------------------------------------------------------------ */
// ---- Fotos y videos en Supabase Storage (carpeta "productos") ----
// Las fotos se achican antes de subir (máx. 1400 px, JPG) para que la tienda cargue rápido.
// Los videos se suben tal cual (máx. 50 MB).
const MEDIA_BUCKET = "productos";
const MAX_VIDEO_MB = 50;
function resizeImageToBlob(file, maxW = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la foto"))), "image/jpeg", quality);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
const mediaErrorText = (err) => {
  const m = err?.message || String(err || "");
  if (m.includes("VIDEO_GRANDE")) return `El video pesa más de ${MAX_VIDEO_MB} MB. Recórtalo o comprímelo (por ejemplo con CapCut) y vuelve a intentar.`;
  if (/row-level security|unauthorized|403/i.test(m)) return "No tienes permiso para subir archivos. Cierra sesión del panel y vuelve a entrar.";
  if (/bucket not found/i.test(m)) return "Falta activar el almacenamiento: corre el archivo storage-fotos-videos.sql en Supabase.";
  if (/mime type|not supported/i.test(m)) return "Ese tipo de archivo no se permite. Usa fotos JPG/PNG/WEBP o videos MP4/MOV.";
  return "No se pudo subir el archivo: " + m;
};
async function uploadBlob(blob, folder, ext, contentType) {
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { cacheControl: "31536000", contentType, upsert: false });
  if (error) throw error;
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
async function uploadMedia(file, folder = "productos") {
  const isVideo = (file.type || "").startsWith("video/");
  if (isVideo) {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error("VIDEO_GRANDE");
    const ext = ((file.name || "").split(".").pop() || "mp4").toLowerCase();
    return { url: await uploadBlob(file, folder, ext, file.type), type: "video" };
  }
  const blob = await resizeImageToBlob(file);
  const url = await uploadBlob(blob, folder, "jpg", "image/jpeg");
  return { url, type: "image", thumb: await makeThumb(blob, folder) };
}
// Miniatura liviana (600 px) para tarjetas, listas y cesta: en el celular se bajan ~5 veces menos datos.
// La foto grande se sigue usando en la ficha y el visor. Si falla, se usa la grande (nunca se pierde la foto).
async function makeThumb(blobOrFile, folder = "productos") {
  try { return await uploadBlob(await resizeImageToBlob(blobOrFile, 600, 0.8), folder, "jpg", "image/jpeg"); } catch (e) { console.error(e); return null; }
}
// Si una miniatura no carga, la foto usa la original (nunca se queda sin foto)
const THUMB_ORIGINAL = new Map();
// Nombre y descripción de la prenda en el idioma elegido (si se escribió en inglés en el editor)
const pName = (p) => (getLang() === "en" && p?.nameEn) || p?.name || "";
const pDesc = (p) => (getLang() === "en" && p?.descriptionEn) || p?.description || "";
// Textos que escribe el panel (banners): en inglés usa su versión «En»; si está vacía, el diccionario; si tampoco, el español.
const bText = (b, f) => (getLang() === "en" ? (b?.[`${f}En`] || t(b?.[f] || "")) : b?.[f] || "");
const imgThumb = (m) => { if (!m) return null; if (m.thumb && m.url) THUMB_ORIGINAL.set(m.thumb, m.url); return m.thumb || m.url; };
// Para mover fotos viejas guardadas dentro de la base de datos (data:image/...) a Storage
async function uploadDataUrl(dataUrl, folder) {
  const blob = await (await fetch(dataUrl)).blob();
  const type = blob.type || "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return uploadBlob(blob, folder, ext, type);
}

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

const mainImageUrl = (product) => imgThumb(product?.images?.[0]) || null;
// Segunda foto disponible (de cualquier color) — para mostrar al pasar el mouse sobre la tarjeta.
const hoverImageUrl = (product) => {
  const imgs = (product?.images || []).filter((im) => im.type !== "video" && im.url);
  const main = imgs[0]?.url;
  return imgThumb(imgs.find((im) => im.url !== main)) || null;
};
// Fotos de un color para la tarjeta: la principal y "otro ángulo" del MISMO color
const colorPhotos = (product, colorName) => {
  const imgs = (product?.images || []).filter((im) => im.type !== "video" && im.url);
  if (!colorName) return imgs;
  const own = imgs.filter((im) => im.colorName === colorName);
  const general = imgs.filter((im) => !im.colorName);
  return own.length ? [...own, ...general] : [];
};
const hasColorPhoto = (product, colorName) => (product?.images || []).some((im) => im.url && im.colorName === colorName);
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

// Encabezados del Excel → claves simples: "Código de barras" → codigo_barras, "Stock mínimo" → stock_minimo
const normalizeRowKeys = (raw) => Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [
  String(k).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)/g, "").trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^codigo_de_barras$/, "codigo_barras"),
  v,
]));
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
  const XLSX = await loadXLSX();
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
// ---- Outlet: prendas de liquidación a precio final, en su propia sección (no se mezclan con la colección) ----
const isOutlet = (p) => p?.outlet === true;
// El Outlet se abre o se pausa en Panel → Configuración. Pausado: sus prendas no se ven ni se venden en la web.
const outletOn = (settings = SHOP_SETTINGS) => settings?.outletEnabled !== false;
const webVisible = (p) => p.showOnline !== false && (!isOutlet(p) || outletOn());
const OUTLET_RULES = ["Precio final: no aplican cupones ni puntos del Club, y no suman puntos.", "El envío se paga aparte (no cuenta para el envío gratis).", "Sin cambios ni devoluciones, salvo falla de fábrica."];
const OutletRules = ({ compact }) => (
  <div style={{ background: C.paperDeep, borderRadius: 10, padding: compact ? "10px 12px" : "12px 14px", fontFamily: FONT_BODY, fontSize: compact ? 11.5 : 12, color: C.inkSoft, lineHeight: 1.55 }}>
    <strong style={{ color: C.ink, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 10.5 }}>{t("Outlet · Venta final")}</strong>
    {OUTLET_RULES.map((r) => <div key={r}>· {t(r)}</div>)}
  </div>
);
const BadgeLogo = ({ size = 34, dark }) => (
  <div style={{ height: size, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: size * 0.52, letterSpacing: "0.02em", lineHeight: 1, color: dark ? "#FFFFFF" : "#000000" }}>FLY</span>
  </div>
);
const FlightPath = ({ width = 70, color = C.ink }) => (
  <svg width={width} height={width * 0.26} viewBox="0 0 100 26" fill="none">
    <path d="M2 22C24 22 30 4 52 4C68 4 74 15 96 9" stroke={color} strokeWidth="1.3" strokeDasharray="0.5 5.5" strokeLinecap="round" />
    <circle cx="2" cy="22" r="2" fill={color} />
    <path d="M89 5.5L96 9L88.5 13" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

// Aviso de versión nueva: al volver a la app (o cada 15 min) se revisa si se publicó otra versión.
// Un toque en «Actualizar» la carga. No recarga sola (para no cortar una venta a medias).
const currentBuild = () => document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") || "";
const UpdateBanner = ({ staff }) => {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return undefined; // modo desarrollo
    let alive = true;
    const check = async () => {
      try {
        const html = await (await fetch(`/?v=${Date.now()}`, { cache: "no-store" })).text();
        const m = html.match(/\/assets\/index-[\w-]+\.js/);
        if (alive && m && !mine.endsWith(m[0])) { setReady(true); setHidden(false); }
      } catch (e) { /* sin internet: se revisa luego */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(check, 15 * 60 * 1000);
    const first = setTimeout(check, 20000);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); clearInterval(t); clearTimeout(first); };
  }, []);
  if (!ready || hidden) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 12, right: 12, bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 90, maxWidth: 460, margin: "0 auto", background: C.ink, color: C.paper, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: FONT_BODY }}>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}><strong>{t("Hay una versión nueva de Fly.")}</strong>{staff ? t(" Termina lo que estás haciendo y actualiza.") : ""}</div>
      <button onClick={() => window.location.reload()} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t("Actualizar")}</button>
      <button onClick={() => setHidden(true)} aria-label={t("Más tarde")} style={{ background: "none", border: "none", color: C.paper, cursor: "pointer", padding: 4 }}><X size={16} /></button>
    </div>
  );
};

const ProductImg = ({ src, alt, style, dim, priority }) => {
  // Intentos: miniatura → foto original → un reintento (internet lento o cortado) → logo FLY
  const [cur, setCur] = useState(src);
  const [tries, setTries] = useState(0);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false); // mientras carga se ve un brillo gris; al llegar aparece suave
  const ref = useRef(null);
  useEffect(() => { setCur(src); setTries(0); setBroken(false); setLoaded(false); }, [src]);
  useEffect(() => { if (ref.current?.complete && ref.current.naturalWidth) setLoaded(true); }, [cur]); // ya estaba en caché
  const onError = () => {
    const orig = THUMB_ORIGINAL.get(cur);
    if (orig && orig !== cur) { setCur(orig); return; }
    if (tries < 1) { setTries(1); setTimeout(() => setCur(`${cur}${cur.includes("?") ? "&" : "?"}r=${Date.now()}`), 1500); return; }
    setBroken(true);
  };
  if (!cur || broken) {
    return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", background: C.paperDeep }}><BadgeLogo size={30} /></div>;
  }
  return <img ref={ref} src={cur} alt={alt} className={loaded ? "fimg is-loaded" : "fimg"} style={{ ...imgGrade, ...style, ...(dim ? { filter: "saturate(0) contrast(1.02)", opacity: 0.45 } : {}) }}
    onLoad={() => setLoaded(true)} onError={onError} loading={priority ? "eager" : "lazy"} fetchpriority={priority ? "high" : "auto"} decoding="async" />;
};

// Video que solo se reproduce cuando está en pantalla (ahorra datos y batería). Con «ahorro de datos» espera a que lo toquen.
const saveData = () => { try { return !!navigator.connection?.saveData; } catch { return false; } };
const SmartVideo = ({ src, poster, style, active = true }) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual] = useState(saveData);
  const [play, setPlay] = useState(!manual);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (visible && active && play) el.play?.()?.catch?.(() => {}); else el.pause?.();
  }, [visible, active, play]);
  useEffect(() => { // al volver a la app, sigue reproduciendo solo si se ve
    const onVis = () => { const el = ref.current; if (el && document.visibilityState === "visible" && visible && active && play) el.play?.()?.catch?.(() => {}); };
    document.addEventListener("visibilitychange", onVis); return () => document.removeEventListener("visibilitychange", onVis);
  }, [visible, active, play]);
  return (
    <div className={ready ? "fvid is-loaded" : "fvid"} style={{ position: "relative", width: "100%", height: "100%", ...style }}>
      <video ref={ref} src={src} poster={poster || undefined} muted loop playsInline preload={visible || !manual ? "metadata" : "none"} onLoadedData={() => setReady(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {!play && <button onClick={() => setPlay(true)} aria-label={t("Reproducir video")} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer" }}>
        <span style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}><Play size={22} color={C.ink} fill={C.ink} style={{ marginLeft: 3 }} /></span>
      </button>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  SMALL UI PRIMITIVES                                                */
/* ------------------------------------------------------------------ */
// Traduce si es texto (los componentes compartidos con el staff quedan en español allí)
const tt = (x) => (typeof x === "string" ? t(x) : x);
const Eyebrow = ({ children, color = C.stone }) => (
  <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.2em", textTransform: "uppercase", color, fontWeight: 500, marginBottom: 5 }}>{tt(children)}</div>
);
const SectionTitle = ({ eyebrow, title, action, onAction }) => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 20px", marginBottom: 14 }}>
    <div>{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{tt(title)}</h2></div>
    {action && <button onClick={onAction} style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 2, fontFamily: FONT_BODY, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, cursor: "pointer", padding: 4, fontWeight: 600 }}>{tt(action)} <ChevronRight size={13} /></button>}
  </div>
);
const Chip = ({ children, active, onClick }) => (
  <button onClick={onClick} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.03em", whiteSpace: "nowrap", padding: "9px 15px", borderRadius: 8,
    border: `1px solid ${active ? C.ink : C.line}`, background: active ? C.ink : "transparent", color: active ? C.paper : C.ink, cursor: "pointer", fontWeight: 500 }}>{tt(children)}</button>
);
const Tag = ({ label }) => {
  const map = { Nuevo: { bg: C.ink, fg: C.paper, border: C.ink }, Oferta: { bg: C.accent, fg: C.white, border: C.accent },
    Bestseller: { bg: "transparent", fg: C.ink, border: C.ink }, Agotado: { bg: C.white, fg: C.stone, border: C.stone }, Outlet: { bg: C.white, fg: C.ink, border: C.ink } };
  const s = map[label];
  if (!s) return null;
  return <span style={{ position: "absolute", top: 10, left: 10, background: s.bg, color: s.fg, border: `1px solid ${s.border}`, fontFamily: FONT_BODY, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 8px", borderRadius: 3, fontWeight: 600, zIndex: 2 }}>{t(label)}</span>;
};
const PrimaryButton = ({ children, onClick, dark = true, style, disabled, className }) => (
  <button onClick={onClick} disabled={disabled} className={className} style={{ fontFamily: FONT_BODY, fontSize: 12.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600,
    background: disabled ? C.line : dark ? C.ink : "transparent", color: disabled ? C.stone : dark ? C.paper : C.ink, border: dark ? "none" : `1px solid ${C.ink}`,
    padding: "14px 22px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", ...style }}>{children}</button>
);
const Switch = ({ on, onClick, label }) => (
  <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
    {label && <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{tt(label)}</span>}
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
  const pickColor = (c) => { setColor(c); if (size && effStock(size, c.n) <= 0) setSize(null); };
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.white, borderRadius: "18px 18px 0 0", padding: "20px 20px 26px", animation: "slideUp .25s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 56, height: 70, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={mainImageUrl(product)} alt={pName(product)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, fontWeight: 600, marginBottom: 2 }}>{pName(product)}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: C.ink, fontWeight: 800 }}>{money(product.price)}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start" }}><X size={18} color={C.stone} /></button>
        </div>
        {colors.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.stone, marginBottom: 8 }}>{t("Color —")} {t(color?.n)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {colors.map((c) => <button key={c.n} onClick={() => pickColor(c)} style={{ width: 28, height: 28, borderRadius: "50%", background: c.h, border: color?.n === c.n ? `2px solid ${C.ink}` : `1px solid ${C.line}`, cursor: "pointer" }} />)}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.stone, marginBottom: 8 }}>{t("Talla")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sizes.map((s) => {
              const st = effStock(s, color?.n);
              return <button key={s} disabled={st === 0} onClick={() => setSize(s)} style={{ minWidth: 40, padding: "8px 6px", borderRadius: 8, border: `1px solid ${size === s ? C.ink : C.line}`, background: size === s ? C.ink : "transparent", color: st === 0 ? C.line : size === s ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: st === 0 ? "not-allowed" : "pointer", textDecoration: st === 0 ? "line-through" : "none" }}>{s}</button>;
            })}
          </div>
        </div>
        <PrimaryButton disabled={!canAdd} onClick={() => { onQuickAdd(product, size, color, 1); onClose(); }}>{canAdd ? t("Agregar a la bolsa") : t("Elige talla")}</PrimaryButton>
      </div>
    </div>
  );
};

const ProductCard = ({ product, onOpen, fav, onToggleFav, wide, onQuickAdd, catalog, cartSessionId }) => {
  const soldOut = productSoldOut(product);
  const label = soldOut ? "Agotado" : isOutlet(product) ? "Outlet" : product.tag;
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const colors = productColors(product);
  const [cardColor, setCardColor] = useState(null);
  const shown = cardColor ? colorPhotos(product, cardColor) : [];
  const baseObj = shown[0] || (product.images || [])[0];
  const baseImg = imgThumb(baseObj) || mainImageUrl(product);
  const sameColor = (cardColor ? shown : colorPhotos(product, (product.images || [])[0]?.colorName)).filter((im) => im.url !== baseObj?.url);
  const altImg = imgThumb(sameColor[0]) || (cardColor ? null : hoverImageUrl(product));
  return (
    <div className={wide ? undefined : "pcard"} style={{ width: wide ? 300 : "100%", flexShrink: 0, cursor: "pointer", position: "relative" }} onClick={() => onOpen(product, cardColor)}>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: C.paperDeep }} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <Tag label={label} />
        <button aria-label={fav ? t("Quitar de favoritos") : t("Guardar en favoritos")} onClick={(e) => { e.stopPropagation(); onToggleFav(product.id); }} style={{ position: "absolute", top: 8, right: 8, zIndex: 2, width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.92)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Heart key={fav ? "on" : "off"} className={fav ? "heart-pop" : ""} size={14} color={C.ink} fill={fav ? C.ink : "none"} strokeWidth={1.6} />
        </button>
        <ProductImg src={hovering && altImg ? altImg : baseImg} alt={pName(product)} dim={soldOut} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block", animation: "fadeIn .25s ease" }} />
        {!soldOut && onQuickAdd && (
          <button aria-label={t("Añadir a la cesta")} onClick={(e) => { e.stopPropagation(); setQuickAddOpen(true); }} style={{ position: "absolute", bottom: 8, right: 8, zIndex: 2, width: 32, height: 32, borderRadius: "50%", background: C.ink, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Plus size={15} color={C.paper} />
          </button>
        )}
      </div>
      <div style={{ padding: "9px 1px 0" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, fontWeight: 500, lineHeight: 1.25, marginBottom: 4 }}>{pName(product)}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, color: product.compareAtPrice ? C.accent : C.ink, fontWeight: 800 }}>{money(product.price)}</span>
          {product.compareAtPrice && <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, textDecoration: "line-through" }}>{money(product.compareAtPrice)}</span>}
        </div>
        {colors.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, marginLeft: -4 }}>
            {colors.slice(0, 5).map((c) => {
              const active = cardColor === c.n;
              const withPhoto = hasColorPhoto(product, c.n);
              return (
                <button key={c.n} title={withPhoto ? t(c.n) : t("{c} (sin foto aún)", { c: t(c.n) })} aria-label={t("Ver en {c}", { c: t(c.n) })}
                  onClick={(e) => { e.stopPropagation(); if (withPhoto) setCardColor(active ? null : c.n); else onOpen(product, c.n); }}
                  onMouseEnter={() => withPhoto && setCardColor(c.n)}
                  style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.h, border: `1px solid ${C.line}`, boxShadow: active ? `0 0 0 2px ${C.paper}, 0 0 0 3px ${C.ink}` : "none" }} />
                </button>
              );
            })}
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
// Celular: Inicio · Catálogo · Favoritos · Cesta · Cuenta (como Zalando/Amazon). En PC el logo lleva al inicio y se ve «Visto».
const NAV_ITEMS = [
  { key: "home", label: "Inicio", icon: Home, only: "mobile" },
  { key: "category", label: "Catálogo", icon: LayoutGrid }, { key: "viewed", label: "Visto", icon: Eye, only: "desktop" }, { key: "favorites", label: "Favoritos", icon: Heart },
  { key: "cart", label: "Cesta", icon: ShoppingBag }, { key: "profile", label: "Cuenta", icon: User },
];
const closeDrop = (e) => { const w = e.currentTarget; w.classList.add("nav-drop-closed"); try { document.activeElement && document.activeElement.blur(); } catch (err) { /* nada */ } };
const reopenDrop = (e) => e.currentTarget.classList.remove("nav-drop-closed");
const BottomNav = ({ screen, setScreen, cartCount, onSearch, cart = [], clubMember, points = 0, onLogoutClub, products = [], onOpenProduct, onSearchQuery, onCategory, favCount = 0, hasOutlet = false, lang, onLang }) => (
  <div className="app-nav" style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.paperDeep, borderTop: `1px solid ${C.line}`, padding: "10px 6px calc(10px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 30 }}>
    <button className="nav-brand" onClick={() => setScreen("home")} title={t("Ir al inicio")} aria-label={t("Ir al inicio")} style={{ display: "none", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
      <BadgeLogo size={64} />
      <span className="nav-brand-hint" style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{t("Inicio")}</span>
    </button>
    <div className="nav-search" style={{ display: "none", position: "relative" }}>
      <SearchBox products={products} onOpenProduct={onOpenProduct} onSearch={onSearchQuery} />
    </div>
    {NAV_ITEMS.map(({ key, label, icon: Icon, only }) => {
      const active = screen === key;
      const btn = (
        // Tocar otra vez la pestaña en la que ya estás te sube al principio
        <button key={key} className={`nav-item${active ? " is-active" : ""}${only ? ` nav-only-${only}` : ""}`} aria-current={active ? "page" : undefined} onClick={() => (active ? scrollAllTop(true) : setScreen(key))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 6px", position: "relative", flex: 1 }}>
          <div style={{ position: "relative" }}>
            <Icon size={20} strokeWidth={active ? 2.1 : 1.5} color={active ? C.ink : C.stone} />
            {key === "favorites" && favCount > 0 && <span style={{ position: "absolute", top: -6, right: -9, background: C.ink, color: C.white, fontSize: 9, fontFamily: FONT_BODY, fontWeight: 600, borderRadius: 999, minWidth: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{favCount}</span>}
            {key === "cart" && cartCount > 0 && <span key={cartCount} className="badge-bump" style={{ position: "absolute", top: -6, right: -9, background: C.ink, color: C.white, fontSize: 9, fontFamily: FONT_BODY, fontWeight: 600, borderRadius: 999, minWidth: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{cartCount}</span>}
          </div>
          <span className="nav-label" style={{ fontFamily: FONT_BODY, fontSize: 10, color: active ? C.ink : C.stone, fontWeight: active ? 600 : 400 }}>{t(label)}</span>
        </button>
      );
      if (key === "category") {
        const cats = [...new Set(products.map((p) => p.category))];
        return (
          <div key={key} className="nav-drop-wrap" onClickCapture={closeDrop} onMouseLeave={reopenDrop} style={{ position: "relative", display: "flex", flex: 1 }}>
            {btn}
            <div className="nav-dropdown nav-mega" style={{ display: "none" }}>
              <div style={{ display: "flex", gap: 34, padding: "18px 24px" }}>
                {CATEGORY_GROUPS.map(([group, list]) => {
                  const items = [...list.filter((c) => cats.includes(c)), ...(group === "Ropa" ? cats.filter((c) => !CATEGORY_GROUPS.some(([, l]) => l.includes(c))) : [])];
                  if (!items.length) return null;
                  return (
                    <div key={group} style={{ minWidth: 140 }}>
                      <button onClick={() => onCategory && onCategory("Todo", group)} style={{ display: "block", background: "none", border: "none", padding: "0 0 8px", cursor: "pointer", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink }}>{t(group)}</button>
                      {items.map((c) => <button key={c} onClick={() => onCategory && onCategory(c)} className="nav-drop-link" style={{ display: "block", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft, textAlign: "left" }}>{t(c)}</button>)}
                    </div>
                  );
                })}
                <div style={{ minWidth: 140 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink, paddingBottom: 8 }}>{t("Destacado")}</div>
                  <button onClick={() => onCategory && onCategory("Todo")} className="nav-drop-link" style={{ display: "block", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft }}>{t("Ver todo")}</button>
                  {hasOutlet && <button onClick={() => setScreen("outlet")} className="nav-drop-link" style={{ display: "block", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, letterSpacing: "0.08em" }}>{t("OUTLET")}</button>}
                </div>
              </div>
            </div>
          </div>
        );
      }
      if (key !== "profile" && key !== "cart") return btn;
      const link = (text, target, extra) => <button key={text} onClick={() => setScreen(target)} className="nav-drop-link" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 4px", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, cursor: "pointer" }}>{t(text)}{extra}</button>;
      const subtotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
      return (
        <div key={key} className="nav-drop-wrap" onClickCapture={closeDrop} onMouseLeave={reopenDrop} style={{ position: "relative", display: "flex", flex: 1 }}>
          {btn}
          <div className="nav-dropdown" style={{ display: "none" }}>
            {key === "profile" ? (
              <div style={{ padding: "14px 18px", width: 260 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 6 }}>{clubMember ? t("Hola, {n}", { n: clubMember.name.split(" ")[0] }) : t("Mi cuenta")}</div>
                {!clubMember && <button onClick={() => setScreen("loyalty")} style={{ width: "100%", padding: "11px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", margin: "4px 0 8px" }}>{t("Únete al Club Fly gratis")}</button>}
                {link("Tu perfil", "profile")}
                {link("Mis pedidos", "orders")}
                {link("Mis favoritos", "favorites")}
                {link("Mis direcciones", "addresses")}
                {link("Rastrear un pedido", "track")}
                {clubMember && link("Club Fly", "loyalty", <span style={{ color: C.stone }}> · {points} {t("puntos")}</span>)}
                {clubMember && <button onClick={onLogoutClub} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${C.line}`, marginTop: 6, padding: "12px 4px 2px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, cursor: "pointer" }}>{t("¿No eres {n}? Cerrar sesión", { n: clubMember.name.split(" ")[0] })}</button>}
              </div>
            ) : (
              <div style={{ padding: "14px 18px", width: 340 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink, marginBottom: 10 }}>{t("Cesta")} {cartCount ? `(${cartCount})` : ""}</div>
                {cart.length === 0 ? (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, padding: "6px 0 10px" }}>{t("Tu cesta está vacía.")}</div>
                ) : (
                  <>
                    <div style={{ maxHeight: 260, overflowY: "auto" }}>
                      {cart.slice(0, 6).map((i) => (
                        <div key={i.cartId} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
                          <div style={{ width: 48, height: 60, borderRadius: 6, overflow: "hidden", background: C.paperDeep, flexShrink: 0 }}><ProductImg src={i.image} alt={i.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</div>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>{t("Color:")} {t(i.color?.n)} {t("· Talla:")} {i.size} {t("· Cant.:")} {i.qty}</div>
                            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: C.ink }}>{money(i.price * i.qty)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink, padding: "12px 0" }}><span>{t("Subtotal")}</span><span>{money(subtotal)}</span></div>
                  </>
                )}
                <button onClick={() => setScreen("cart")} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Ir a la cesta")}</button>
              </div>
            )}
          </div>
        </div>
      );
    })}
    <LangSwitch className="nav-lang" lang={lang} onLang={onLang} />
  </div>
);

/* ------------------------------------------------------------------ */
/*  HEADER + MARQUEE                                                   */
/* ------------------------------------------------------------------ */
// Ajustes de la tienda a mano para textos fijos (la cinta de arriba); se actualiza al cargar el catálogo
let SHOP_SETTINGS = {};
const Marquee = () => {
  const text = `${t("ENVÍO GRATIS EN TRUJILLO DESDE S/ {n}", { n: localShippingOf(SHOP_SETTINGS).freeFrom })}  ·  ${clubOn(SHOP_SETTINGS) ? `${t("CLUB FLY: GANA PUNTOS EN CADA COMPRA")}  ·  ` : ""}${t("NUEVA COLECCIÓN DISPONIBLE")}  ·  `;
  return (
    <div style={{ background: C.ink, overflow: "hidden", height: 28, display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", animation: "marquee 22s linear infinite" }}>
        {[0, 1].map((i) => <span key={i} style={{ fontFamily: FONT_BODY, fontSize: 10, letterSpacing: "0.14em", color: C.paper, whiteSpace: "nowrap" }}>{text}</span>)}
      </div>
    </div>
  );
};
const iconBtnStyle = { width: 34, height: 34, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.paperDeep, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const RECENT_SEARCH_KEY = "flyboutique:busquedas:v1";
function normText(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
// Barra de búsqueda de PC: escribes y se despliegan sugerencias debajo (como Zalando).
// Enter o "Ver resultados" lleva al catálogo con la búsqueda aplicada para seguir filtrando.
const SearchBox = ({ products, onOpenProduct, onSearch }) => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => { const off = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", off); return () => document.removeEventListener("mousedown", off); }, []);
  const nq = normText(q.trim());
  const cats = [...new Set(products.map((p) => p.category))];
  const catSug = nq ? cats.filter((c) => normText(c).includes(nq)) : cats;
  const prodSug = nq.length >= 2 ? products.filter((p) => normText(`${p.name} ${p.nameEn || ""} ${p.category} ${t(p.category)} ${productColors(p).map((c) => `${c.n} ${t(c.n)}`).join(" ")}`).includes(nq)).slice(0, 5) : [];
  const go = (term) => { const t = term.trim(); setOpen(false); setQ(""); onSearch(t); try { const rec = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]"); localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify([t, ...rec.filter((r) => r !== t)].slice(0, 6))); } catch (e) { /* nada */ } };
  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.paper, border: `1px solid ${open ? C.ink : C.line}`, borderRadius: open ? "20px 20px 0 0" : 999, padding: "11px 18px" }}>
        <Search size={16} color={C.stone} strokeWidth={1.8} />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) go(q); if (e.key === "Escape") setOpen(false); }}
          placeholder={t("¿Qué prenda buscas hoy?")} style={{ flex: 1, border: "none", outline: "none", fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, background: "transparent" }} />
        {q && <button onClick={() => setQ("")} aria-label={t("Borrar")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={15} color={C.stone} /></button>}
      </div>
      {open && (
        <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 70, background: C.paper, border: `1px solid ${C.ink}`, borderTop: "none", borderRadius: "0 0 20px 20px", boxShadow: "0 18px 40px rgba(0,0,0,0.14)", padding: "6px 0 10px", maxHeight: "70vh", overflowY: "auto" }}>
          {q.trim() && <button onClick={() => go(q)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "11px 18px", background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, textAlign: "left" }}><Search size={14} /> {t("Ver resultados de")} «<strong>{q.trim()}</strong>»</button>}
          {catSug.slice(0, 6).map((c) => (
            <button key={c} onClick={() => go(c)} style={{ display: "block", width: "100%", padding: "10px 18px", background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, textAlign: "left" }}>
              {nq ? <><strong>{c.slice(0, q.trim().length)}</strong>{c.slice(q.trim().length)}</> : c} <span style={{ color: C.stone, fontSize: 11.5 }}>{t("· categoría")}</span>
            </button>
          ))}
          {prodSug.length > 0 && <div style={{ borderTop: `1px solid ${C.paperDeep}`, margin: "6px 0 2px" }} />}
          {prodSug.map((p) => (
            <button key={p.id} onClick={() => { setOpen(false); setQ(""); onOpenProduct(p); }} style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "8px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 38, height: 48, borderRadius: 6, overflow: "hidden", background: C.paperDeep, flexShrink: 0 }}><ProductImg src={mainImageUrl(p)} alt={pName(p)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
              <span style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{pName(p)}</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: p.compareAtPrice ? C.accent : C.ink }}>{money(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
const SearchOverlay = ({ products, onClose, onOpenProduct, onSearchAll }) => {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState(() => { try { return JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]"); } catch (e) { return []; } });
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nq = norm(q.trim());
  const results = nq.length >= 2 ? products.filter((p) => norm(`${p.name} ${p.nameEn || ""} ${p.category} ${t(p.category)} ${p.tag || ""} ${productColors(p).map((c) => `${c.n} ${t(c.n)}`).join(" ")}`).includes(nq)) : [];
  const categories = [...new Set(products.map((p) => p.category))];
  const suggestions = nq.length >= 1
    ? [...new Set([...categories.filter((c) => norm(c).includes(nq)), ...products.filter((p) => norm(p.name).includes(nq)).map((p) => p.name)])].slice(0, 6)
    : [];
  const remember = (term) => {
    const t = term.trim(); if (!t) return;
    const next = [t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 6);
    setRecent(next); try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next)); } catch (e) { /* sin guardado */ }
  };
  const pick = (p) => { remember(q || p.name); onOpenProduct(p); };
  const chip = { padding: "8px 13px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paperDeep, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, cursor: "pointer" };
  return (
    <div className="search-overlay" style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", flexDirection: "column" }}>
      <div className="search-scrim" onClick={onClose} style={{ position: "absolute", inset: 0, background: C.paper }} />
      <div className="search-panel" style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", background: C.paper, minHeight: 0 }}>
        <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.line}` }}>
          <button onClick={onClose} aria-label={t("Cerrar búsqueda")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><ArrowLeft size={19} color={C.ink} /></button>
          <Search size={16} color={C.stone} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("¿Qué prenda buscas hoy?")}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { remember(q); if (onSearchAll) { onSearchAll(q.trim()); onClose(); } } }}
            style={{ flex: 1, border: "none", outline: "none", fontFamily: FONT_BODY, fontSize: 14, background: "transparent", color: C.ink }} />
          {q && <button onClick={() => setQ("")} aria-label={t("Borrar")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={16} color={C.stone} /></button>}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 16px" }}>
          {suggestions.length > 0 && (
            <div style={{ padding: "4px 0 8px", borderBottom: `1px solid ${C.paperDeep}` }}>
              {suggestions.map((sg) => (
                <button key={sg} onClick={() => setQ(sg)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink }}>
                  <Search size={14} color={C.stone} />
                  <span><strong>{sg.slice(0, q.trim().length)}</strong>{sg.slice(q.trim().length)}</span>
                </button>
              ))}
            </div>
          )}
          {nq.length < 2 ? (
            <div style={{ padding: "12px 20px" }}>
              {recent.length > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Eyebrow>{t("Búsquedas recientes")}</Eyebrow>
                    <button onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_SEARCH_KEY); } catch (e) { /* nada */ } }} style={{ background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, textDecoration: "underline", cursor: "pointer" }}>{t("Borrar")}</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>{recent.map((r) => <button key={r} onClick={() => setQ(r)} style={chip}>{r}</button>)}</div>
                </>
              )}
              <Eyebrow>{t("Categorías")}</Eyebrow>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>{categories.map((c) => <button key={c} onClick={() => { onSearchAll && onSearchAll(c); onClose(); }} style={chip}>{c}</button>)}</div>
              <Eyebrow>{t("Lo más nuevo")}</Eyebrow>
              <div className="search-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {products.filter((p) => !productSoldOut(p)).slice(0, 6).map((p) => (
                  <button key={p.id} onClick={() => pick(p)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ borderRadius: 8, overflow: "hidden", background: C.paperDeep }}><ProductImg src={mainImageUrl(p)} alt={pName(p)} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} /></div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pName(p)}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 800, color: p.compareAtPrice ? C.accent : C.ink }}>{money(p.price)}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>{t("No encontramos «{q}». Prueba con otra palabra, como «vestido» o «negro».", { q })}</div>
          ) : (
            <div style={{ padding: "12px 20px" }}>
              <Eyebrow>{t(results.length === 1 ? "{n} resultado" : "{n} resultados", { n: results.length })}</Eyebrow>
              <div className="search-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {results.slice(0, 18).map((p) => (
                  <button key={p.id} onClick={() => pick(p)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                    <div style={{ borderRadius: 8, overflow: "hidden", background: C.paperDeep }}><ProductImg src={mainImageUrl(p)} alt={pName(p)} dim={productSoldOut(p)} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} /></div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pName(p)}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 800, color: p.compareAtPrice ? C.accent : C.ink }}>{money(p.price)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Idioma de la tienda: ES | EN (lo elegido se recuerda en este equipo)
const LangSwitch = ({ lang, onLang, className }) => (
  <div className={className} role="group" aria-label="Idioma / Language" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, fontFamily: FONT_BODY, fontSize: 12 }}>
    {[["es", "ES"], ["en", "EN"]].map(([k, l], i) => (
      <React.Fragment key={k}>
        {i > 0 && <span style={{ color: C.line }}>|</span>}
        <button onClick={() => onLang(k)} aria-pressed={lang === k} lang={k} title={k === "es" ? "Español" : "English"}
          style={{ background: "none", border: "none", padding: "6px 5px", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.06em", color: lang === k ? C.ink : C.stone, fontWeight: lang === k ? 700 : 400, textDecoration: lang === k ? "underline" : "none", textUnderlineOffset: 4 }}>{l}</button>
      </React.Fragment>
    ))}
  </div>
);

const Header = ({ onSearch, onHome, lang, onLang }) => (
  <div className="app-header" style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper }}>
    <Marquee />
    <div style={{ padding: "14px 20px 12px", display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={onHome} aria-label={t("Ir al inicio")} title={t("Ir al inicio")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}><BadgeLogo size={34} /></button>
      <button onClick={onSearch} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: C.paperDeep, border: `1px solid ${C.line}`, borderRadius: 999, padding: "10px 14px", cursor: "pointer", textAlign: "left" }}>
        <Search size={15} color={C.stone} strokeWidth={1.8} />
        <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>{t("¿Qué prenda buscas hoy?")}</span>
      </button>
      <LangSwitch lang={lang} onLang={onLang} />
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
      <SectionTitle title={t("Visto recientemente")} action="Ver todo" onAction={onSeeAll} />
      <div className="hscroll" style={{ display: "flex", gap: 12, overflowX: "auto", padding: "0 20px 4px", scrollbarWidth: "none" }}>
        {items.map((p) => {
          const soldOut = productSoldOut(p);
          return (
            <div key={p.id} style={{ width: 136, flexShrink: 0 }}>
              <div onClick={() => onOpen(p)} style={{ cursor: "pointer", borderRadius: 8, overflow: "hidden", background: C.paperDeep }}>
                <ProductImg src={mainImageUrl(p)} alt={pName(p)} dim={soldOut} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} />
              </div>
              <div onClick={() => onOpen(p)} style={{ cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pName(p)}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: p.compareAtPrice ? C.accent : C.ink, marginTop: 2 }}>{money(p.price)}</div>
              <button disabled={soldOut} onClick={() => setQuick(p)} style={{ width: "100%", marginTop: 8, padding: "9px 6px", borderRadius: 8, border: `1px solid ${soldOut ? C.line : C.ink}`, background: "transparent", color: soldOut ? C.stone : C.ink, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: soldOut ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <ShoppingBag size={13} /> {soldOut ? t("Agotado") : t("Añadir a la cesta")}
              </button>
            </div>
          );
        })}
      </div>
      {quick && createPortal(<QuickAddSheet product={quick} onClose={() => setQuick(null)} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />, document.body)}
    </div>
  );
};

// Aparece subiendo suave la primera vez que entra en pantalla (si el teléfono pide «reducir movimiento», se ve directo)
const Reveal = ({ children, style }) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <div ref={ref} className={inView ? "reveal is-in" : "reveal"} style={style}>{children}</div>;
};

// Anuncio que sube desde abajo una sola vez (a los 9 s en el inicio) para invitar al Club Fly. Solo si el Club está activo y la persona no es socia.
const CLUB_INVITE_KEY = "flyboutique:invitacion-club:v1";
const ClubInvite = ({ onJoin }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = false; try { seen = !!localStorage.getItem(CLUB_INVITE_KEY); } catch (e) { seen = true; }
    if (seen) return;
    const tm = setTimeout(() => setShow(true), 9000);
    return () => clearTimeout(tm);
  }, []);
  const close = () => { setShow(false); try { localStorage.setItem(CLUB_INVITE_KEY, String(Date.now())); } catch (e) { /* sin guardado */ } };
  if (!show) return null;
  return (
    <div role="dialog" aria-label={t("Club Fly")} className="club-invite" style={{ position: "fixed", left: 12, right: 12, bottom: "calc(86px + env(safe-area-inset-bottom))", zIndex: 80, maxWidth: 420, margin: "0 auto", background: C.ink, color: C.paper, borderRadius: 14, padding: "16px 16px 14px", boxShadow: "0 12px 32px rgba(0,0,0,.28)", fontFamily: FONT_BODY, animation: "slideUp .45s ease" }}>
      <button onClick={close} aria-label={t("Cerrar")} style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: C.paper, cursor: "pointer", padding: 6 }}><X size={16} /></button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 24 }}>
        <span className="gift-wiggle" style={{ width: 42, height: 42, borderRadius: "50%", background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Gift size={20} color={C.ink} /></span>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800 }}>{t("Únete al Club Fly gratis")}</div>
          <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.4 }}>{t("Gana puntos con cada compra y recibe novedades primero.")}</div>
        </div>
      </div>
      <button className="btn-ready" onClick={() => { close(); onJoin(); }} style={{ width: "100%", marginTop: 12, padding: "11px", borderRadius: 9, border: "none", background: C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("Quiero unirme")}</button>
    </div>
  );
};

// Portada: los banners activos rotan solos con fundido (cada 6 s), se pueden deslizar con el dedo o tocar los puntitos.
// Solo se cargan el banner visible y el siguiente; la rotación se pausa si la portada no se ve o la app está en segundo plano.
const HeroCarousel = ({ banners, onCta }) => {
  const [idx, setIdx] = useState(0);
  const [seen, setSeen] = useState(() => new Set([0, 1]));
  const [visible, setVisible] = useState(true);
  const boxRef = useRef(null);
  const touch = useRef(null);
  const n = banners.length;
  const go = (i) => { const k = (i + n) % n; setIdx(k); setSeen((s) => (s.has(k) && s.has((k + 1) % n) ? s : new Set([...s, k, (k + 1) % n]))); };
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (n < 2 || !visible) return;
    const tm = setTimeout(() => { if (!document.hidden) go(idx + 1); }, 6000);
    return () => clearTimeout(tm);
  }, [idx, n, visible]);
  const cur = banners[idx] || banners[0];
  return (
    <div ref={boxRef} className="hero" style={{ position: "relative", marginBottom: 30, height: "min(60vh, 560px)", minHeight: 360, overflow: "hidden", background: C.paperDeep, touchAction: "pan-y" }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (touch.current == null || n < 2) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(dx) > 45) go(idx + (dx < 0 ? 1 : -1)); }}>
      {banners.map((b, i) => seen.has(i) && (
        <div key={b.id} aria-hidden={i !== idx} style={{ position: "absolute", inset: 0, opacity: i === idx ? 1 : 0, transition: "opacity .9s ease", zIndex: i === idx ? 1 : 0 }}>
          <div className={i === idx ? "hero-zoom" : ""} style={{ position: "absolute", inset: 0 }}>
            {b.videoUrl
              ? <SmartVideo src={b.videoUrl} poster={b.image} active={i === idx && visible} />
              : <ProductImg src={b.image} alt={bText(b, "title")} priority={i === 0} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          </div>
        </div>
      ))}
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: `linear-gradient(0deg, ${C.scrim}CC 0%, ${C.scrim}10 42%, transparent 68%)` }} />
      <div key={cur.id} style={{ position: "absolute", left: 20, right: 20, bottom: 28, zIndex: 3, animation: "slideUp .6s ease" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 36, color: C.white, fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.01em", marginBottom: 14 }}>{bText(cur, "title")}</div>
        <button className="cta-glow" onClick={() => onCta(cur)} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", color: C.white, border: `1px solid ${C.white}`, padding: "12px 22px", borderRadius: 9, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>{cur.ctaLabel ? bText(cur, "ctaLabel") : t("Ver colección")} <ChevronRight size={14} /></button>
      </div>
      {n > 1 && (
        <div style={{ position: "absolute", bottom: 6, right: 12, display: "flex", gap: 2, zIndex: 3 }}>
          {banners.map((b, i) => (
            <button key={b.id} onClick={() => go(i)} aria-label={`${t("Banner")} ${i + 1}`} style={{ padding: "8px 3px", background: "none", border: "none", cursor: "pointer", display: "flex" }}>
              <span style={{ width: i === idx ? 18 : 6, height: 5, borderRadius: 999, background: i === idx ? C.white : `${C.white}77`, transition: "width .35s ease, background .35s ease" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const HomeScreen = ({ catalog, onOpen, favs, onToggleFav, setScreen, setActiveCategory, points, notifyMe, viewedIds, onQuickAdd, cartSessionId, onOpenInfo }) => {
  const products = catalog.products.filter((p) => p.showOnline !== false && !isOutlet(p));
  const outletCount = outletOn(catalog.settings) ? catalog.products.filter((p) => p.showOnline !== false && isOutlet(p) && !productSoldOut(p)).length : 0;
  const { banners, collections } = catalog;
  const vistos = (viewedIds || []).map((id) => products.find((p) => p.id === id)).filter(Boolean);
  const nuevos = products.filter((p) => p.tag === "Nuevo" && !productSoldOut(p));
  // "Destacados" no repite lo que ya sale en "Nueva colección"
  const nuevosIds = new Set(nuevos.map((p) => p.id));
  const featuredAll = products.filter((p) => p.featured !== false && !productSoldOut(p));
  const featuredRest = featuredAll.filter((p) => !nuevosIds.has(p.id));
  const destacados = (featuredRest.length >= 4 ? featuredRest : featuredAll).slice(0, 8);
  const ofertas = products.filter((p) => p.compareAtPrice > p.price && !productSoldOut(p));
  // Descuento máximo REAL de las ofertas (nunca un número inventado)
  const maxOff = ofertas.reduce((m, p) => Math.max(m, Math.round((1 - p.price / p.compareAtPrice) * 100)), 0);
  const activeBanners = banners.filter((b) => b.active).sort((a, b) => a.order - b.order);
  const hero = activeBanners[0];
  const featuredCollections = collections.filter((c) => c.featured).sort((a, b) => a.order - b.order);

  const heroTarget = (b = hero) => {
    if (!b) return setScreen("category");
    if (b.ctaType === "category" && b.ctaValue && b.ctaValue !== "Todo") { setActiveCategory(b.ctaValue); setScreen("category"); }
    else setScreen("category");
  };

  return (
    <div style={{ paddingBottom: 12 }}>
      {hero ? (
        <HeroCarousel banners={activeBanners} onCta={heroTarget} />
      ) : (
        <div style={{ margin: "0 20px 30px", padding: 30, textAlign: "center", border: `1px dashed ${C.line}`, borderRadius: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>{t("Aún no hay un banner activo. Agrégalo desde el panel admin.")}</div>
        </div>
      )}

      {outletCount > 0 && (
        <button className="outlet-card" onClick={() => setScreen("outlet")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "calc(100% - 40px)", margin: "0 20px 30px", padding: "18px 20px", borderRadius: 12, border: "none", background: C.ink, cursor: "pointer", textAlign: "left" }}>
          <span>
            <span style={{ display: "block", fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", color: C.paper }}>{t("OUTLET")}</span>
            <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, color: `${C.paper}BB`, marginTop: 3 }}>{t(outletCount === 1 ? "Últimas unidades a precio final · {n} prenda" : "Últimas unidades a precio final · {n} prendas", { n: outletCount })}</span>
          </span>
          <ChevronRight className="nudge-x" size={18} color={C.paper} />
        </button>
      )}

      <Reveal>
      <SectionTitle eyebrow="Recién llegado" title={t("Nueva colección")} action="Ver todo" onAction={() => setScreen("category")} />
      <div className="nuevos-row" style={{ display: "flex", gap: 14, overflowX: "auto", padding: "0 20px 6px", marginBottom: 32, scrollbarWidth: "none" }}>
        {nuevos.length ? nuevos.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} wide onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)
          : <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, padding: "10px 0" }}>{t("Sin novedades por ahora.")}</div>}
      </div>
      </Reveal>

      <Reveal>
      <SectionTitle eyebrow="Lo más amado" title={t("Destacados")} />
      <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 20px", marginBottom: 32 }}>
        {destacados.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)}
      </div>
      </Reveal>

      {ofertas.length > 0 && (
        <Reveal><div style={{ margin: "0 20px 32px", borderRadius: 14, border: `1px solid ${C.line}`, padding: "22px 20px" }}>
          <Eyebrow color={C.accent}>{t("Ofertas")}</Eyebrow>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, marginBottom: 4 }}>{maxOff > 0 ? t("Hasta {n}% de descuento", { n: maxOff }) : t("En oferta")}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 16, maxWidth: 240 }}>{t("En piezas seleccionadas, hasta agotar stock.")}</div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none" }}>
            {ofertas.map((p) => (
              <div key={p.id} style={{ width: 108, flexShrink: 0, cursor: "pointer" }} onClick={() => onOpen(p)}>
                <div style={{ borderRadius: 8, overflow: "hidden" }}><ProductImg src={mainImageUrl(p)} alt={pName(p)} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover" }} /></div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginTop: 6, fontWeight: 600 }}>{money(p.price)}</div>
              </div>
            ))}
          </div>
        </div></Reveal>
      )}


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
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{t("Ordenar por")}</div>
        <button onClick={onClose} aria-label={t("Cerrar")} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={19} color={C.ink} /></button>
      </div>
      {SORT_OPTIONS.map(([key, label]) => (
        <button key={key} onClick={() => { setSort(key); onClose(); }} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 2px", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.ink, fontWeight: sort === key ? 600 : 400 }}>{t(label)}</span>
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
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, color: C.ink }}>{t("Filtrar")}</div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={19} color={C.ink} /></button>
          </div>
          <Eyebrow>{t("Precio máximo —")} {money(priceLimit)}</Eyebrow>
          <input type="range" min={0} max={maxPrice} step={10} value={priceLimit} onChange={(e) => setPriceLimit(Number(e.target.value))} style={{ width: "100%", marginBottom: 22, accentColor: C.ink }} />
          <Eyebrow>{t("Destacado")}</Eyebrow>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {TAGS.map((tg) => <button key={tg} onClick={() => toggle(tags, setTags, tg)} style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, border: `1px solid ${tags.has(tg) ? C.ink : C.line}`, background: tags.has(tg) ? C.ink : "transparent", color: tags.has(tg) ? C.paper : C.ink }}>{t(tg)}</button>)}
          </div>
          <Eyebrow>{t("Talla")}</Eyebrow>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {allSizes.map((s) => <button key={s} onClick={() => toggle(sizes, setSizes, s)} style={{ minWidth: 44, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, border: `1px solid ${sizes.has(s) ? C.ink : C.line}`, background: sizes.has(s) ? C.ink : "transparent", color: sizes.has(s) ? C.paper : C.ink }}>{s}</button>)}
          </div>
          <Eyebrow>{t("Color")}</Eyebrow>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 26 }}>
            {allColors.map((c) => (
              <button key={c.n} onClick={() => toggle(colors, setColors, c.n)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 6px 6px", borderRadius: 999, border: `1px solid ${colors.has(c.n) ? C.ink : C.line}`, background: "transparent", cursor: "pointer" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: c.h, border: `1px solid ${C.line}` }} /><span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink }}>{t(c.n)}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClear} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>{t("Limpiar")}</button>
            <button onClick={onClose} style={{ flex: 2, padding: "14px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>{t("Aplicar")}</button>
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
  const products = catalog.products.filter(webVisible);
  const vistos = (viewedIds || []).map((id) => products.find((p) => p.id === id)).filter(Boolean);
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: 0 }}>{t("Visto")}</h1>
        {vistos.length > 0 && <button onClick={() => { if (confirm(t("¿Vaciar tu historial de vistos?"))) vistos.forEach((p) => onRemoveViewed(p.id)); }} style={{ background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 12, color: C.stone, textDecoration: "underline", cursor: "pointer" }}>{t("Eliminar")}</button>}
      </div>
      {vistos.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 320, textAlign: "center" }}>
          <Eye size={30} color={C.line} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, marginBottom: 20, maxWidth: 240 }}>{t("Aún no has visto ninguna prenda. Explora el catálogo y lo que mires va a quedar guardado aquí.")}</div>
          <button onClick={() => setScreen("category")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", background: C.ink, color: C.paper, border: "none", padding: "13px 26px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>{t("Explorar")}</button>
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

const CategoryScreen = ({ outlet = false, onOutlet, catalog, activeCategory, setActiveCategory, onOpen, favs, onToggleFav, onQuickAdd, cartSessionId, searchQuery = "", setSearchQuery, group = null, setGroup }) => {
  const [panel, setPanel] = useState(null);
  const products = catalog.products.filter((p) => p.showOnline !== false && (outlet ? isOutlet(p) && outletOn(catalog.settings) : !isOutlet(p)));
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

  const groupCats = group ? (CATEGORY_GROUPS.find(([g]) => g === group) || [null, []])[1] : null;
  let filtered = activeCategory === "Todo" ? [...products] : products.filter((p) => p.category === activeCategory);
  if (activeCategory === "Todo" && group) filtered = filtered.filter((p) => (group === "Ropa" ? groupOfCategory(p.category) === "Ropa" : groupCats.includes(p.category)));
  const nq = normText(searchQuery.trim());
  if (nq) filtered = filtered.filter((p) => normText(`${p.name} ${p.nameEn || ""} ${p.category} ${t(p.category)} ${p.tag || ""} ${p.description || ""} ${productColors(p).map((c) => `${c.n} ${t(c.n)}`).join(" ")}`).includes(nq));
  if (activeCollection) { const col = collections.find((c) => c.id === activeCollection); if (col) filtered = filtered.filter((p) => col.productIds.includes(p.id)); }
  if (sizes.size) filtered = filtered.filter((p) => productSizes(p).some((s) => sizes.has(s)));
  if (colors.size) filtered = filtered.filter((p) => productColors(p).some((c) => colors.has(c.n)));
  if (tags.size) filtered = filtered.filter((p) => p.tag && tags.has(p.tag));
  if (priceLimit < maxPrice) filtered = filtered.filter((p) => p.price <= priceLimit);
  if (sort === "price-asc") filtered.sort((a, b) => a.price - b.price);
  if (sort === "price-desc") filtered.sort((a, b) => b.price - a.price);
  if (sort === "new") filtered.sort((a, b) => (b.tag === "Nuevo") - (a.tag === "Nuevo"));

  const activeFilterCount = sizes.size + colors.size + tags.size + (priceLimit < maxPrice ? 1 : 0) + (sort !== "relevance" ? 1 : 0) + (searchQuery ? 1 : 0) + (activeCategory !== "Todo" || group ? 1 : 0);
  const clearAll = () => { setSizes(new Set()); setColors(new Set()); setTags(new Set()); setPriceLimit(maxPrice); setSort("relevance"); setActiveCollection(null); setSearchQuery && setSearchQuery(""); setGroup && setGroup(null); setActiveCategory("Todo"); setPanel(null); };
  const toggleSet = (set, setter, v) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n); };
  const allTags = [...new Set(products.map((p) => p.tag).filter(Boolean))];
  const visibleCats = [...new Set(products.map((p) => p.category))].filter((c) => !group || (group === "Ropa" ? groupOfCategory(c) === "Ropa" : groupCats.includes(c)));
  const title = outlet ? "Outlet" : searchQuery ? `"${searchQuery}"` : activeCategory !== "Todo" ? t(activeCategory) : group ? t(group) : t("Todo el catálogo");
  const filterBtn = (key, label, Icon, count) => (
    <button key={key} onClick={() => setPanel(panel === key ? null : key)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 999, border: `1px solid ${panel === key || count ? C.ink : C.line}`, background: count ? C.ink : panel === key ? C.paperDeep : C.paper, color: count ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
      <Icon size={13} /> {t(label)}{count ? ` (${count})` : ""} <ChevronDown size={13} style={{ transform: panel === key ? "rotate(180deg)" : "none" }} />
    </button>
  );

  return (
    <div style={{ paddingBottom: 20, position: "relative" }}>
      <div style={{ padding: "18px 20px 4px" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 6 }}>
          <button onClick={clearAll} style={{ background: "none", border: "none", padding: 0, color: C.stone, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12 }}>{t("Catálogo")}</button>
          {group && <> / <button onClick={() => { setActiveCategory("Todo"); setSearchQuery && setSearchQuery(""); }} style={{ background: "none", border: "none", padding: 0, color: C.stone, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12 }}>{t(group)}</button></>}
          {activeCategory !== "Todo" && <> / <span style={{ color: C.ink }}>{t(activeCategory)}</span></>}
        </div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>{title}</h1>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 14 }}>{t(filtered.length === 1 ? "{n} prenda" : "{n} prendas", { n: filtered.length })}{outlet ? ` · ${t("últimas unidades")}` : ""}</div>
        {outlet && (outletOn(catalog.settings) ? <div style={{ marginBottom: 14 }}><OutletRules compact /></div> : <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft, marginBottom: 14 }}>{t("El Outlet está cerrado por ahora. Vuelve pronto.")}</div>)}
      </div>
      <div className="filter-bar" style={{ padding: "10px 20px", marginBottom: 12, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 88, zIndex: 15, background: C.paper }}>
        <div className="hscroll" style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {filterBtn("categoria", activeCategory !== "Todo" ? activeCategory : group || "Categoría", LayoutGrid, activeCategory !== "Todo" || group ? 1 : 0)}
          {filterBtn("talla", "Talla", Ruler, sizes.size)}
          {filterBtn("color", "Color", Sparkles, colors.size)}
          {filterBtn("precio", "Precio", Ticket, priceLimit < maxPrice ? 1 : 0)}
          {allTags.length > 0 && filterBtn("destacado", "Destacado", Star, tags.size)}
          {filterBtn("orden", sort === "relevance" ? "Ordenar" : (SORT_OPTIONS.find(([k]) => k === sort) || [, "Ordenar"])[1], ArrowUpDown, 0)}
          {!outlet && onOutlet && <button onClick={onOutlet} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 999, border: `1px solid ${C.ink}`, background: C.paper, color: C.ink, fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{t("OUTLET")} <ChevronRight size={13} /></button>}
        </div>
        {panel && (
          <div style={{ padding: "14px 0 6px" }}>
            {panel === "categoria" && (
              <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                {CATEGORY_GROUPS.map(([g, list]) => {
                  const cats = [...new Set(products.map((p) => p.category))].filter((c) => (g === "Ropa" ? groupOfCategory(c) === "Ropa" : list.includes(c)));
                  if (!cats.length) return null;
                  return (
                    <div key={g} style={{ minWidth: 140 }}>
                      <button onClick={() => { setGroup && setGroup(g); setActiveCategory("Todo"); setPanel(null); }} style={{ background: "none", border: "none", padding: "0 0 6px", cursor: "pointer", fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink, textDecoration: group === g && activeCategory === "Todo" ? "underline" : "none" }}>{t(g)}</button>
                      {cats.map((c) => <button key={c} onClick={() => { setGroup && setGroup(g); setActiveCategory(c); setPanel(null); }} style={{ display: "block", background: "none", border: "none", padding: "5px 0", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: activeCategory === c ? C.ink : C.inkSoft, fontWeight: activeCategory === c ? 700 : 400 }}>{t(c)}</button>)}
                    </div>
                  );
                })}
              </div>
            )}
            {panel === "talla" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{allSizes.map((sz) => <button key={sz} onClick={() => toggleSet(sizes, setSizes, sz)} style={{ minWidth: 48, padding: "9px 12px", borderRadius: 8, border: `1px solid ${sizes.has(sz) ? C.ink : C.line}`, background: sizes.has(sz) ? C.ink : "transparent", color: sizes.has(sz) ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>{sz}</button>)}</div>}
            {panel === "color" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{allColors.map((c) => <button key={c.n} onClick={() => toggleSet(colors, setColors, c.n)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 999, border: `1px solid ${colors.has(c.n) ? C.ink : C.line}`, background: colors.has(c.n) ? C.paperDeep : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}><span style={{ width: 14, height: 14, borderRadius: "50%", background: c.h, border: `1px solid ${C.line}` }} />{t(c.n)}</button>)}</div>}
            {panel === "precio" && (
              <div style={{ maxWidth: 420 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, marginBottom: 8 }}>{t("Hasta")} <strong>{money(priceLimit)}</strong></div>
                <input type="range" min={Math.min(...products.map((p) => p.price), 0)} max={maxPrice} step="1" value={priceLimit} onChange={(e) => setPriceLimit(Number(e.target.value))} style={{ width: "100%", accentColor: C.ink }} />
              </div>
            )}
            {panel === "destacado" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{allTags.map((tg) => <Chip key={tg} active={tags.has(tg)} onClick={() => toggleSet(tags, setTags, tg)}>{tg}</Chip>)}</div>}
            {panel === "orden" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{SORT_OPTIONS.map(([k, l]) => <Chip key={k} active={sort === k} onClick={() => { setSort(k); setPanel(null); }}>{l}</Chip>)}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <button onClick={clearAll} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline", cursor: "pointer", padding: 0 }}><RotateCcw size={12} /> {t("Restablecer todos")}</button>
              <button onClick={() => setPanel(null)} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("Ver {n} prendas", { n: filtered.length })}</button>
            </div>
          </div>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="hscroll" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 4px", marginBottom: 14, scrollbarWidth: "none", alignItems: "center" }}>
          {searchQuery && <button onClick={() => setSearchQuery && setSearchQuery("")} style={activeChipStyle}>{t("Búsqueda:")} {searchQuery} <X size={11} /></button>}
          {group && <button onClick={() => setGroup && setGroup(null)} style={activeChipStyle}>{group} <X size={11} /></button>}
          {activeCategory !== "Todo" && <button onClick={() => setActiveCategory("Todo")} style={activeChipStyle}>{t(activeCategory)} <X size={11} /></button>}
          {[...sizes].map((x) => <button key={"s" + x} onClick={() => toggleSet(sizes, setSizes, x)} style={activeChipStyle}>{t("Talla")} {x} <X size={11} /></button>)}
          {[...colors].map((x) => <button key={"c" + x} onClick={() => toggleSet(colors, setColors, x)} style={activeChipStyle}>{x} <X size={11} /></button>)}
          {[...tags].map((x) => <button key={"t" + x} onClick={() => toggleSet(tags, setTags, x)} style={activeChipStyle}>{x} <X size={11} /></button>)}
          {priceLimit < maxPrice && <button onClick={() => setPriceLimit(maxPrice)} style={activeChipStyle}>{t("Hasta")} {money(priceLimit)} <X size={11} /></button>}
          {sort !== "relevance" && <button onClick={() => setSort("relevance")} style={activeChipStyle}>{(SORT_OPTIONS.find(([k]) => k === sort) || [])[1]} <X size={11} /></button>}
          <button onClick={clearAll} style={{ ...activeChipStyle, border: "none", background: "transparent", color: C.ink, fontWeight: 600, textDecoration: "underline", flexShrink: 0 }}><RotateCcw size={11} /> {t("Restablecer todos")}</button>
        </div>
      )}

      <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 20px" }}>
        {filtered.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav={favs.has(p.id)} onToggleFav={onToggleFav} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)}
      </div>
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ color: C.stone, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 14 }}>{t("No hay piezas que combinen todos esos filtros a la vez.")}</div>
          {activeFilterCount > 0 && <button onClick={clearAll} style={{ padding: "11px 22px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Quitar filtros")}</button>}
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
          <span className="hint-touch" style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.ink }}>{t("Mantén presionado para ampliar")}</span>
          <span className="hint-mouse" style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.ink }}>{t("Pasa el mouse para ampliar")}</span>
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
// Visor a pantalla completa (como Zalando): foto entera sobre fondo blanco, miniaturas,
// flechas y un clic para acercar donde apuntas (sin lupa deforme). En celular se pellizca para ampliar.
const PhotoViewer = ({ items, start = 0, alt, onClose }) => {
  const [idx, setIdx] = useState(start);
  const [zoom, setZoom] = useState(null);          // PC: punto donde se acerca con el clic
  const [tz, setTz] = useState({ s: 1, x: 0, y: 0 }); // celular: zoom propio con los dedos (solo la foto, nunca la página)
  const areaRef = useRef(null);
  const tzRef = useRef(tz); tzRef.current = tz;
  const lastTouch = useRef(0);
  const imgs = items.filter((m) => m.type !== "video");
  const cur = imgs[idx];
  const go = (d) => { setZoom(null); setTz({ s: 1, x: 0, y: 0 }); setIdx((i) => (i + d + imgs.length) % imgs.length); };
  const goRef = useRef(go); goRef.current = go;
  useEffect(() => {
    const k = (e) => { if (["Escape", "ArrowRight", "ArrowLeft"].includes(e.key)) { e.stopImmediatePropagation(); e.preventDefault(); } if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [imgs.length]);
  // Gestos del celular: pellizcar acerca SOLO la foto (antes se agrandaba/achicaba toda la página y quedaba descuadrada),
  // arrastrar mueve la foto acercada, deslizar cambia de foto y doble toque acerca/aleja.
  useEffect(() => {
    const el = areaRef.current; if (!el) return undefined;
    const g = { mode: null, d0: 0, s0: 1, x0: 0, y0: 0, px: 0, py: 0, sx: 0, sy: 0, t: 0, tap: 0 };
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const clamp = (z) => {
      const r = el.getBoundingClientRect(); const mx = ((z.s - 1) * r.width) / 2, my = ((z.s - 1) * r.height) / 2;
      return z.s <= 1.01 ? { s: 1, x: 0, y: 0 } : { s: z.s, x: Math.max(-mx, Math.min(mx, z.x)), y: Math.max(-my, Math.min(my, z.y)) };
    };
    const onStart = (e) => {
      lastTouch.current = Date.now();
      const z = tzRef.current;
      if (e.touches.length === 2) { g.mode = "pinch"; g.d0 = dist(e.touches[0], e.touches[1]); g.s0 = z.s; g.x0 = z.x; g.y0 = z.y; }
      else if (e.touches.length === 1) { g.mode = z.s > 1 ? "pan" : "swipe"; g.px = e.touches[0].clientX; g.py = e.touches[0].clientY; g.sx = g.px; g.sy = g.py; g.x0 = z.x; g.y0 = z.y; g.t = Date.now(); }
    };
    const onMove = (e) => {
      e.preventDefault(); // nunca deja que el navegador haga zoom o mueva la página
      if (g.mode === "pinch" && e.touches.length === 2) {
        const s2 = Math.max(1, Math.min(4, (g.s0 * dist(e.touches[0], e.touches[1])) / (g.d0 || 1)));
        setTz(clamp({ s: s2, x: g.x0, y: g.y0 }));
      } else if (g.mode === "pan" && e.touches.length === 1) {
        setTz(clamp({ s: tzRef.current.s, x: g.x0 + e.touches[0].clientX - g.px, y: g.y0 + e.touches[0].clientY - g.py }));
      }
    };
    const onEnd = (e) => {
      lastTouch.current = Date.now();
      if (g.mode === "swipe" && e.changedTouches.length) {
        const dx = e.changedTouches[0].clientX - g.sx, dy = e.changedTouches[0].clientY - g.sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && imgs.length > 1) goRef.current(dx < 0 ? 1 : -1);
        else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - g.t < 300) {
          if (Date.now() - g.tap < 300) { setTz({ s: 2.5, x: 0, y: 0 }); g.tap = 0; } else g.tap = Date.now();
        }
      } else if (g.mode === "pan" && e.changedTouches.length) {
        const dx = e.changedTouches[0].clientX - g.sx, dy = e.changedTouches[0].clientY - g.sy;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { if (Date.now() - g.tap < 300) { setTz({ s: 1, x: 0, y: 0 }); g.tap = 0; } else g.tap = Date.now(); }
      }
      if (e.touches.length === 0) g.mode = null;
      else if (e.touches.length === 1) { g.mode = tzRef.current.s > 1 ? "pan" : null; g.px = e.touches[0].clientX; g.py = e.touches[0].clientY; g.x0 = tzRef.current.x; g.y0 = tzRef.current.y; }
    };
    // Safari (iPhone) tiene su propio gesto de zoom: también se bloquea mientras el visor está abierto
    const stopGesture = (e) => e.preventDefault();
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    document.addEventListener("gesturestart", stopGesture, { passive: false });
    document.addEventListener("gesturechange", stopGesture, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart); el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd); el.removeEventListener("touchcancel", onEnd);
      document.removeEventListener("gesturestart", stopGesture); document.removeEventListener("gesturechange", stopGesture);
    };
  }, [imgs.length]);
  const point = (e) => { const r = e.currentTarget.getBoundingClientRect(); return `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; };
  const round = { width: 42, height: 42, borderRadius: "50%", background: C.paper, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  if (!cur) return null;
  const touchZoomed = tz.s > 1;
  const imgTransform = touchZoomed ? `translate(${tz.x}px, ${tz.y}px) scale(${tz.s})` : zoom ? "scale(2.3)" : "none";
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 95, background: C.white, display: "flex", flexDirection: "column", touchAction: "none", overscrollBehavior: "contain" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", paddingTop: "max(10px, env(safe-area-inset-top))" }}>
        <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>
          {imgs.length > 1 ? `${idx + 1} / ${imgs.length} · ` : ""}
          <span className="hint-mouse">{zoom ? t("Clic para alejar") : t("Clic en la foto para acercar")}</span>
          <span className="hint-touch">{touchZoomed ? t("Doble toque para alejar") : t("Pellizca o toca dos veces para acercar")}</span>
        </span>
        <button onClick={onClose} aria-label={t("Cerrar")} style={round}><X size={18} /></button>
      </div>
      <div className="viewer-body" style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, padding: "0 16px 16px" }}>
        {imgs.length > 1 && (
          <div className="viewer-thumbs hscroll" style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", width: 72, flexShrink: 0, touchAction: "pan-x pan-y" }}>
            {imgs.map((m, i) => <button key={i} onClick={() => { setZoom(null); setTz({ s: 1, x: 0, y: 0 }); setIdx(i); }} style={{ width: 68, height: 88, flexShrink: 0, padding: 0, borderRadius: 6, overflow: "hidden", border: `2px solid ${i === idx ? C.ink : "transparent"}`, background: C.paperDeep, cursor: "pointer" }}><ProductImg src={imgThumb(m)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></button>)}
          </div>
        )}
        <div ref={areaRef} style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden", touchAction: "none", cursor: zoom ? "zoom-out" : "zoom-in" }}
          onClick={(e) => { if (Date.now() - lastTouch.current < 700) return; setZoom(zoom ? null : point(e)); }} onMouseMove={(e) => zoom && setZoom(point(e))}>
          <img src={cur.url} alt={alt} draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transform: imgTransform, transformOrigin: touchZoomed ? "center" : zoom || "center", transition: touchZoomed ? "none" : zoom ? "transform-origin .05s linear" : "transform .2s ease", userSelect: "none", WebkitUserSelect: "none" }} />
          {imgs.length > 1 && !touchZoomed && <>
            <button onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label={t("Anterior")} style={{ ...round, position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }}><ArrowLeft size={17} /></button>
            <button onClick={(e) => { e.stopPropagation(); go(1); }} aria-label={t("Siguiente")} style={{ ...round, position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}><ChevronRight size={18} /></button>
          </>}
        </div>
      </div>
    </div>, document.body);
};

// Miniatura de un video: primer cuadro del video con el botón de reproducir encima
const VideoThumb = ({ url }) => (
  <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <video src={`${url}#t=0.1`} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}><Play size={14} color={C.ink} fill={C.ink} style={{ marginLeft: 2 }} /></span>
    </span>
  </div>
);

const ProductGallery = ({ items, alt, dim }) => {
  const [viewer, setViewer] = useState(null);
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
    <div key={sig} className={`pdp-gal${items.length > 1 ? " has-thumbs" : ""}`} style={{ animation: "galleryIn .35s ease" }}>
      <div className="pdp-gal-main" style={{ position: "relative" }}>
        <div ref={trackRef} onScroll={onScroll} className="hscroll" style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none" }}>
          {items.map((m, i) => (
            <div key={m.id || i} className="pdp-slide" style={{ flex: "0 0 100%", width: "100%", scrollSnapAlign: "start", aspectRatio: "3/4", alignSelf: "flex-start", background: C.paperDeep, position: "relative", overflow: "hidden" }}>
              {m.type === "video" ? (
                <SmartVideo src={m.url} active={idx === i} style={{ position: "absolute", inset: 0, filter: dim ? "grayscale(1)" : "none", opacity: dim ? 0.5 : 1 }} />
              ) : (
                <button onClick={() => !dim && setViewer(items.filter((x) => x.type !== "video").findIndex((x) => x.url === m.url))} aria-label={t("Ver foto en grande")} style={{ position: "absolute", inset: 0, padding: 0, border: "none", background: "none", cursor: dim ? "default" : "zoom-in" }}>
                  <ProductImg src={m.url} alt={alt} dim={dim} priority={i === 0} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {!dim && <span style={{ position: "absolute", bottom: 12, right: 12, background: "rgba(255,255,255,0.92)", borderRadius: 999, padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, fontFamily: FONT_BODY, fontSize: 10.5, color: C.ink }}><Search size={11} /> <span className="hint-touch">{t("Toca para ampliar")}</span><span className="hint-mouse">{t("Clic para ampliar")}</span></span>}
                </button>
              )}
            </div>
          ))}
        </div>
        {items.length > 1 && (
          <>
            <button className="pdp-arrow" onClick={() => go(idx - 1)} aria-label={t("Foto anterior")} style={{ ...arrowStyle, left: 12, display: "flex" }}><ArrowLeft size={16} color={C.ink} /></button>
            <button className="pdp-arrow" onClick={() => go(idx + 1)} aria-label={t("Foto siguiente")} style={{ ...arrowStyle, right: 12, display: "flex" }}><ChevronRight size={17} color={C.ink} /></button>
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
                ? <VideoThumb url={m.url} />
                : <ProductImg src={imgThumb(m)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            </button>
          ))}
        </div>
      )}
      {viewer !== null && viewer >= 0 && <PhotoViewer items={items} start={viewer} alt={alt} onClose={() => setViewer(null)} />}
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

const SizeGuideModal = ({ category, onClose, onRecommend }) => {
  const isShoes = category === "Calzado";
  const [m, setM] = useState(() => loadMeasures() || { busto: "", cintura: "", cadera: "" });
  const rec = recommendSize(m);
  const saveMeasures = () => { try { localStorage.setItem(MEASURES_KEY, JSON.stringify(m)); } catch (e) { /* sin guardado */ } if (onRecommend) onRecommend(rec); onClose(); };
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 30px", animation: "slideUp .25s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, color: C.ink }}>{t("Guía de tallas")}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.ink} /></button>
        </div>
        {isShoes ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[t("Talla PE"), t("Largo (cm)")].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{SIZE_CHART_SHOES.map(([t, cm]) => <tr key={t}><td style={tdStyle}>{t}</td><td style={tdStyle}>{cm}</td></tr>)}</tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[t("Talla"), t("Busto (cm)"), t("Cintura (cm)"), t("Cadera (cm)")].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>{SIZE_CHART_CLOTHING.map((r) => <tr key={r.talla}><td style={tdStyle}>{r.talla}</td><td style={tdStyle}>{r.busto}</td><td style={tdStyle}>{r.cintura}</td><td style={tdStyle}>{r.cadera}</td></tr>)}</tbody>
          </table>
        )}
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 16, lineHeight: 1.6 }}>{t("Medidas referenciales. Si estás entre dos tallas, te recomendamos elegir la mayor.")}</div>
        {!isShoes && (
          <div style={{ background: C.paper, borderRadius: 12, padding: "14px 16px", marginTop: 16 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 4 }}>{t("¿Dudas sobre tu talla?")}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 10, lineHeight: 1.5 }}>{t("Escribe tus medidas en centímetros y te recomendamos la talla. Las guardamos en este celular para las próximas prendas.")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {[["busto", t("Busto")], ["cintura", t("Cintura")], ["cadera", t("Cadera")]].map(([k, l]) => (
                <label key={k} style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{l}
                  <input inputMode="numeric" value={m[k] || ""} onChange={(e) => setM((x) => ({ ...x, [k]: e.target.value.replace(/\D/g, "").slice(0, 3) }))} placeholder={t("cm")} style={{ ...inputStyle, marginTop: 4, textAlign: "center" }} />
                </label>
              ))}
            </div>
            {rec && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{t("Te recomendamos la talla")} <strong style={{ fontSize: 16 }}>{rec === "XL+" ? t("XL (escríbenos para confirmar)") : rec}</strong></div>
                <button onClick={saveMeasures} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>{t("Usar esta talla")}</button>
              </div>
            )}
          </div>
        )}
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
      <span style={sheetLabelStyle}>{t("Tu calificación")}</span>
      <div style={{ marginBottom: 10 }}><StarRating value={rating} onChange={setRating} size={20} /></div>
      <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t("Tu nombre")} style={{ ...inputStyle, marginBottom: 8 }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Cuéntanos qué te pareció…")} style={{ ...inputStyle, minHeight: 60, marginBottom: 8 }} />
      {photo && <div style={{ width: 60, height: 60, borderRadius: 8, overflow: "hidden", marginBottom: 8 }}><ProductImg src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>}
      <button onClick={() => fileRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, cursor: "pointer", marginBottom: 12 }}><ImageIcon size={13} /> {photo ? t("Cambiar foto") : t("Agregar foto (opcional)")}</button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>{t("Cancelar")}</button>
        <button disabled={!author.trim() || !text.trim()} onClick={() => onSubmit({ author: author.trim(), rating, text: text.trim(), photo })}
          style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: (!author.trim() || !text.trim()) ? C.line : C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("Publicar reseña")}</button>
      </div>
      <Faltan tr={t} items={[!author.trim() && "escribe tu nombre", !text.trim() && "escribe tu opinión"]} />
    </div>
  );
};

const Accordion = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 0", background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink }}>
        {tt(title)}<ChevronDown size={16} color={C.ink} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {open && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.7, paddingBottom: 16 }}>{children}</div>}
    </div>
  );
};

// Ficha de producto a pantalla completa (estilo tienda grande): galería grande arriba
// (o a la izquierda en PC), datos y selección a la derecha, y en celular una barra
// fija abajo con el precio y el botón de compra, siempre a mano.
const ProductSheet = ({ product, initialColor, onClose, onAdd, fav, onToggleFav, reviews, onAddReview, collections, allProducts, onOpenProduct, catalog, cartSessionId, onNavigate, favs }) => {
  const sizes = productSizes(product);
  const colors = productColors(product);
  const [color, setColor] = useState(colors[0] || null);
  const [size, setSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [hoverColor, setHoverColor] = useState(null);
  const [sizeNote, setSizeNote] = useState("");
  const [recSize, setRecSize] = useState(() => recommendSize(loadMeasures()));
  const scrollRef = useRef(null);
  const soldOut = productSoldOut(product);

  useEffect(() => {
    const firstColor = (initialColor && colors.find((c) => c.n === initialColor)) || colors.find((c) => colorTotalStock(product, c.n) > 0) || colors[0] || null;
    setColor(firstColor);
    setSize(sizes.find((s) => variantStock(product, s, firstColor?.n) > 0) || null);
    setQty(1); setShowReviewForm(false); setSizeNote("");
    scrollAllTop();
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
  const canAdd = !soldOut && stock > 0 && qty <= stock;
  // Al cambiar de color, si la talla elegida no existe (o no tiene stock) en ese color, se quita: no se puede seguir con algo que no hay
  const pickColor = (c) => {
    setColor(c);
    if (size && effectiveVariantStock(size, c.n) <= 0) { setSizeNote(t("La talla {s} no está disponible en {c}. Elige otra.", { s: size, c: c.n })); setSize(null); setQty(1); return; }
    setSizeNote("");
    if (size) setQty((q) => Math.max(1, Math.min(q, effectiveVariantStock(size, c.n))));
  };
  const pickSize = (sz) => { setSize(sz); setSizeNote(""); setQty((q) => Math.max(1, Math.min(q, effectiveVariantStock(sz, color?.n)))); };
  const shownColor = hoverColor && hasColorPhoto(product, hoverColor) ? hoverColor : color?.n;
  const gallery = productGallery(product, shownColor);
  const productReviews = reviews?.[product.id] || [];
  const avgRating = productReviews.length ? productReviews.reduce((a, r) => a + r.rating, 0) / productReviews.length : null;
  const discountPct = product.compareAtPrice && product.compareAtPrice > product.price ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;

  const look = collections?.find((c) => c.productIds.includes(product.id) && c.productIds.length > 1);
  const lookItems = look ? look.productIds.filter((id) => id !== product.id).map((id) => allProducts.find((p) => p.id === id)).filter(Boolean) : [];

  const buyLabel = soldOut ? "Agotado" : canAdd ? t("Agregar a la cesta") : !size ? t("Elige una talla") : t("Sin stock en esta talla");
  const needSize = !soldOut && !size;
  const sizesRef = useRef(null);
  const [nudge, setNudge] = useState(0);
  const addNow = () => {
    if (canAdd) { onAdd(product, size, color, qty); return; }
    if (needSize) { sizesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); setNudge((x) => x + 1); }
  };

  return (
    <div className="pdp-page">
    <div ref={scrollRef} className="pdp" style={{ position: "relative", background: C.paper, display: "flex", flexDirection: "column", animation: "fadeIn .2s ease" }}>
      <div className="pdp-topbar" style={{ position: "sticky", top: 88, zIndex: 20, background: C.paper, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button onClick={onClose} aria-label={t("Volver")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, padding: 8 }}><ArrowLeft size={17} /> <span className="pdp-close-label">{t("Volver")}</span></button>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <button onClick={() => onNavigate && onNavigate("home")} style={{ background: "none", border: "none", padding: 0, color: C.stone, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12 }}>{t("Inicio")}</button> /{" "}
            <button onClick={() => onNavigate && onNavigate("category", product.category)} style={{ background: "none", border: "none", padding: 0, color: C.stone, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, textDecoration: "underline" }}>{t(product.category)}</button>
            <span className="pdp-crumb-name"> / <span style={{ color: C.ink }}>{pName(product)}</span></span>
          </span>
        </div>
        <button onClick={() => onToggleFav(product.id)} aria-label={fav ? t("Quitar de favoritos") : t("Guardar en favoritos")} style={{ width: 38, height: 38, borderRadius: "50%", background: "transparent", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Heart key={fav ? "on" : "off"} className={fav ? "heart-pop" : ""} size={17} color={C.ink} fill={fav ? C.ink : "none"} strokeWidth={1.6} />
        </button>
      </div>

      <div className="pdp-wrap" style={{ flex: "1 0 auto", width: "100%", maxWidth: 1180, margin: "0 auto" }}>
        <div className="pdp-gallery" style={{ position: "relative" }}>
          {(soldOut || product.tag || isOutlet(product)) && <Tag label={soldOut ? "Agotado" : isOutlet(product) ? "Outlet" : product.tag} />}
          <ProductGallery items={gallery} alt={pName(product)} dim={soldOut} />
          {colors.length > 1 && color && !hasColorPhoto(product, color.n) && (
            <div style={{ position: "absolute", top: 12, right: 12, zIndex: 13, background: "rgba(255,255,255,0.94)", borderRadius: 999, padding: "6px 11px", fontFamily: FONT_BODY, fontSize: 11, color: C.ink, display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: color.h, border: `1px solid ${C.line}` }} />
              {t("Foto referencial, color {c} sin foto aún", { c: t(color.n).toLowerCase() })}
            </div>
          )}
        </div>

        <div className="pdp-info" style={{ padding: "20px 20px 28px" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 4 }}>{t(product.category)}</div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{pName(product)}</h1>
          {avgRating && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <StarRating value={Math.round(avgRating)} />
              <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>{avgRating.toFixed(1)} ({t(productReviews.length === 1 ? "{n} reseña" : "{n} reseñas", { n: productReviews.length })})</span>
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
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft }}>{t("Este producto está agotado por ahora.")}</span>
            </div>
          ) : (
            <>
              {colors.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, marginBottom: 10 }}>{t("Color:")} <strong style={{ fontWeight: 600 }}>{t(hoverColor || color?.n)}</strong>{colorTotalStock(product, hoverColor || color?.n) === 0 && <span style={{ color: C.stone }}> {t("(agotado)")}</span>}</div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} onMouseLeave={() => setHoverColor(null)}>
                    {colors.map((c) => {
                      const outOfStock = colorTotalStock(product, c.n) === 0;
                      const active = color?.n === c.n;
                      const tilePhoto = hasColorPhoto(product, c.n) ? imgThumb(colorPhotos(product, c.n)[0]) : null;
                      return (
                        // Con foto de ese color: miniatura de la prenda (como Zalando). Sin foto: círculo del color.
                        tilePhoto ? (
                          <button key={c.n} onClick={() => pickColor(c)} onMouseEnter={() => setHoverColor(c.n)} onFocus={() => setHoverColor(c.n)} title={outOfStock ? `${t(c.n)} (agotado)` : c.n} aria-label={t(c.n)} aria-pressed={active}
                            style={{ position: "relative", width: 60, height: 80, borderRadius: 8, overflow: "hidden", background: C.paperDeep, cursor: "pointer", border: `2px solid ${active ? C.ink : C.line}`, opacity: outOfStock ? 0.45 : 1, transition: "border-color .15s ease", padding: 0 }}>
                            <ProductImg src={tilePhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            {outOfStock && <span style={{ position: "absolute", inset: 0, background: `linear-gradient(to top right, transparent calc(50% - 1px), ${C.ink} calc(50% - 1px), ${C.ink} calc(50% + 1px), transparent calc(50% + 1px))` }} />}
                          </button>
                        ) : (
                        <button key={c.n} onClick={() => pickColor(c)} onMouseEnter={() => setHoverColor(c.n)} title={outOfStock ? `${t(c.n)} (agotado)` : c.n} aria-label={t(c.n)}
                          style={{ position: "relative", width: active ? 42 : 36, height: active ? 42 : 36, borderRadius: "50%", background: c.h, cursor: "pointer", border: `1px solid ${C.line}`, boxShadow: active ? `0 0 0 3px ${C.paper}, 0 0 0 4px ${C.ink}` : "none", opacity: outOfStock ? 0.4 : 1, transition: "all .15s ease", padding: 0, alignSelf: "center" }}>
                          {outOfStock && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `linear-gradient(to top right, transparent calc(50% - 1px), ${C.ink} calc(50% - 1px), ${C.ink} calc(50% + 1px), transparent calc(50% + 1px))` }} />}
                        </button>
                        )
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{t("Talla:")} <strong style={{ fontWeight: 600 }}>{size || t("elige una")}</strong></div>
                  <button onClick={() => setShowSizeGuide(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline", padding: 0 }}>{recSize ? t("Guía de tallas") : t("¿Dudas con la talla?")}</button>
                </div>
                <div ref={sizesRef} key={nudge} className={nudge ? "size-nudge" : ""} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sizes.map((s) => {
                    const sStock = effectiveVariantStock(s, color?.n);
                    const active = size === s;
                    return <button key={s} onClick={() => pickSize(s)} disabled={sStock === 0} style={{ minWidth: 52, height: 46, padding: "0 10px", borderRadius: 8, cursor: sStock === 0 ? "not-allowed" : "pointer", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 500, border: `1px solid ${active ? C.ink : C.line}`, background: active ? C.ink : "transparent", color: sStock === 0 ? C.line : active ? C.paper : C.ink, textDecoration: sStock === 0 ? "line-through" : "none" }}>{s}</button>;
                  })}
                </div>
                {recSize && product.category !== "Calzado" && sizes.length > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: C.paperDeep, borderRadius: 8, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 12, color: C.ink }}>
                    <Ruler size={14} color={C.ink} /> {t("Según tus medidas, te recomendamos la talla")} <strong>{recSize === "XL+" ? "XL" : recSize}</strong>
                    {sizes.includes(recSize) && size !== recSize && effectiveVariantStock(recSize, color?.n) > 0 && <button onClick={() => pickSize(recSize)} style={{ marginLeft: "auto", background: "none", border: "none", textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", color: C.ink }}>{t("Elegir")}</button>}
                  </div>
                )}
                {sizeNote && !size && <div role="status" style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, fontWeight: 600, marginTop: 10 }}>{sizeNote}</div>}
                {stock > 0 && stock <= 5 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, fontWeight: 600, marginTop: 10 }}>{stock === 1 ? t("¡Última unidad en esta talla!") : t("¡Solo quedan {n} unidades en esta talla!", { n: stock })}</div>}
                {stock === 0 && size && (() => {
                  const v = product.variants.find((vv) => vv.size === size && vv.colorName === color?.n);
                  const reservedElsewhere = v && v.stock > 0;
                  return <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginTop: 10 }}>{reservedElsewhere ? t("Otra persona la tiene en su cesta ahora mismo. Vuelve a intentar en unos minutos.") : t("Sin stock en esta combinación.")}</div>;
                })()}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 20px" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{t("Cantidad")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px" }}>
                  <button aria-label={t("Menos")} onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Minus size={14} color={C.ink} /></button>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 14, minWidth: 14, textAlign: "center" }}>{qty}</span>
                  <button aria-label={t("Más")} onClick={() => setQty((q) => Math.min(stock || 1, q + 1))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Plus size={14} color={C.ink} /></button>
                </div>
              </div>
            </>
          )}

          <div className="pdp-inline-buy" style={{ display: "none", marginBottom: 20 }}>
            <PrimaryButton key={canAdd ? "ok" : "no"} className={canAdd ? "btn-ready" : ""} disabled={!canAdd && !needSize} onClick={addNow}><ShoppingBag size={16} /> {canAdd ? `${buyLabel} · ${money(product.price * qty)}` : buyLabel}</PrimaryButton>
          </div>

          {isOutlet(product) && <div style={{ marginBottom: 18 }}><OutletRules compact /></div>}
          <div style={{ display: isOutlet(product) ? "none" : "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft }}><Package size={15} color={C.ink} /> {t("Envío gratis en Trujillo desde S/")} {localShippingOf(catalog?.settings).freeFrom}{t(", o recojo en tienda gratis.")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft }}><Undo2 size={15} color={C.ink} /> {t("Cambios de talla o color hasta 7 días después de recibir.")}</div>
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, marginBottom: 22 }}>
            {product.description && <Accordion title={t("Detalles")} defaultOpen>{pDesc(product)}</Accordion>}
            <Accordion title={t("Talla y corte")}>
              {product.fit || t("Calce regular: si estás entre dos tallas, elige la mayor.")}
              {product.category !== "Calzado" && <div style={{ marginTop: 8 }}><button onClick={() => setShowSizeGuide(true)} style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, cursor: "pointer" }}>{t("Ver guía de tallas y recomendación")}</button></div>}
            </Accordion>
            <Accordion title={t("Composición y cuidado")}>
              {product.materials ? <div><strong style={{ color: C.ink, fontWeight: 600 }}>{t("Composición:")}</strong> {product.materials}</div> : null}
              <div style={{ marginTop: product.materials ? 6 : 0 }}><strong style={{ color: C.ink, fontWeight: 600 }}>{t("Cuidado:")}</strong> {product.care || t("Lavar a mano o en ciclo delicado con agua fría. No usar secadora. Planchar a baja temperatura.")}</div>
            </Accordion>
            <Accordion title={t("Envío y devoluciones")}>
              <div>Recojo en tienda gratis (Av. Larco 126, Trujillo). Delivery en Trujillo S/ {localShippingOf(catalog?.settings).price}{t(", gratis desde S/")} {localShippingOf(catalog?.settings).freeFrom}{t(". Envío a provincia desde S/ 12 según departamento.")}</div>
              <div style={{ marginTop: 6 }}>{t("Tienes 7 días desde que recibes tu pedido para cambiar talla o color, con la prenda sin uso y con etiquetas.")}</div>
            </Accordion>
          </div>

          {lookItems.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div style={sheetLabelStyle}>{t("Completa el look")}</div>
              <div className="hscroll" style={{ display: "flex", gap: 10, overflowX: "auto", scrollbarWidth: "none" }}>
                {lookItems.map((p) => (
                  <button key={p.id} onClick={() => onOpenProduct(p)} style={{ width: 104, flexShrink: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                    <div style={{ borderRadius: 8, overflow: "hidden", marginBottom: 6, background: C.paperDeep }}><ProductImg src={mainImageUrl(p)} alt={pName(p)} style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }} /></div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pName(p)}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12.5, color: C.ink, fontWeight: 800 }}>{money(p.price)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ ...sheetLabelStyle, marginBottom: 0 }}>{t("Reseñas")} ({productReviews.length})</div>
              {!showReviewForm && <button onClick={() => setShowReviewForm(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline" }}>{t("Escribir reseña")}</button>}
            </div>
            {showReviewForm && <ReviewForm onCancel={() => setShowReviewForm(false)} onSubmit={(r) => { onAddReview(product.id, r); setShowReviewForm(false); }} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              {productReviews.length === 0 && !showReviewForm && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>{t("Todavía no hay reseñas. Cuéntanos qué te pareció si ya la tienes.")}</div>}
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

      {(() => {
        const rel = (allProducts || []).filter((p) => p.id !== product.id && p.showOnline !== false && !productSoldOut(p) && isOutlet(p) === isOutlet(product))
          .sort((a, b) => (b.category === product.category) - (a.category === product.category) || (groupOfCategory(b.category) === groupOfCategory(product.category)) - (groupOfCategory(a.category) === groupOfCategory(product.category))).slice(0, 8);
        if (!rel.length) return null;
        return (
          <div style={{ width: "100%", maxWidth: 1240, margin: "0 auto", padding: "10px 0 30px" }}>
            <SectionTitle title={t("También te puede gustar")} />
            <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 20px" }}>
              {rel.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpenProduct} fav={favs ? favs.has(p.id) : false} onToggleFav={onToggleFav} catalog={catalog} cartSessionId={cartSessionId} />)}
            </div>
          </div>
        );
      })()}
      <div className="pdp-buybar" style={{ position: "sticky", bottom: 0, zIndex: 20, background: C.paper, borderTop: `1px solid ${C.line}`, padding: "10px 16px calc(10px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: discountPct ? C.accent : C.ink }}>{money(product.price * qty)}</div>
          {!soldOut && size && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{t("Talla")} {size}{color ? `, ${t(color.n)}` : ""}</div>}
        </div>
        <PrimaryButton key={canAdd ? "ok" : "no"} className={canAdd ? "btn-ready" : ""} disabled={!canAdd && !needSize} onClick={addNow} style={{ flex: 1, width: "auto", padding: "14px 16px" }}><ShoppingBag size={16} /> {buyLabel}</PrimaryButton>
      </div>

      {showSizeGuide && createPortal(<SizeGuideModal category={t(product.category)} onClose={() => setShowSizeGuide(false)} onRecommend={(r) => { setRecSize(r); if (r && sizes.includes(r) && effectiveVariantStock(r, color?.n) > 0) pickSize(r); }} />, document.body)}
    </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  CART SCREEN                                                        */
/* ------------------------------------------------------------------ */
const Row = ({ label, value, bold }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
    <span style={{ fontFamily: FONT_BODY, fontSize: bold ? 14 : 12.5, color: C.ink, fontWeight: bold ? 600 : 400 }}>{tt(label)}</span>
    <span style={{ fontFamily: FONT_DISPLAY, fontSize: bold ? 17 : 12.5, color: C.ink, fontWeight: bold ? 800 : 500 }}>{value}</span>
  </div>
);

// ---- Celular con código de país ----
const PHONE_COUNTRIES = "AF|Afganistán|93;AL|Albania|355;DE|Alemania|49;AD|Andorra|376;AO|Angola|244;AG|Antigua y Barbuda|1268;SA|Arabia Saudita|966;DZ|Argelia|213;AR|Argentina|54;AM|Armenia|374;AW|Aruba|297;AU|Australia|61;AT|Austria|43;AZ|Azerbaiyán|994;BS|Bahamas|1242;BH|Baréin|973;BD|Bangladés|880;BB|Barbados|1246;BE|Bélgica|32;BZ|Belice|501;BJ|Benín|229;BY|Bielorrusia|375;BO|Bolivia|591;BA|Bosnia y Herzegovina|387;BW|Botsuana|267;BR|Brasil|55;BN|Brunéi|673;BG|Bulgaria|359;BF|Burkina Faso|226;BI|Burundi|257;BT|Bután|975;CV|Cabo Verde|238;KH|Camboya|855;CM|Camerún|237;CA|Canadá|1;QA|Catar|974;TD|Chad|235;CL|Chile|56;CN|China|86;CY|Chipre|357;CO|Colombia|57;KM|Comoras|269;CG|Congo|242;CD|Congo (RD)|243;KR|Corea del Sur|82;CI|Costa de Marfil|225;CR|Costa Rica|506;HR|Croacia|385;CU|Cuba|53;CW|Curazao|599;DK|Dinamarca|45;DM|Dominica|1767;EC|Ecuador|593;EG|Egipto|20;SV|El Salvador|503;AE|Emiratos Árabes Unidos|971;ER|Eritrea|291;SK|Eslovaquia|421;SI|Eslovenia|386;ES|España|34;US|Estados Unidos|1;EE|Estonia|372;SZ|Esuatini|268;ET|Etiopía|251;PH|Filipinas|63;FI|Finlandia|358;FJ|Fiyi|679;FR|Francia|33;GA|Gabón|241;GM|Gambia|220;GE|Georgia|995;GH|Ghana|233;GD|Granada|1473;GR|Grecia|30;GT|Guatemala|502;GN|Guinea|224;GQ|Guinea Ecuatorial|240;GW|Guinea-Bisáu|245;GY|Guyana|592;HT|Haití|509;HN|Honduras|504;HK|Hong Kong|852;HU|Hungría|36;IN|India|91;ID|Indonesia|62;IQ|Irak|964;IR|Irán|98;IE|Irlanda|353;IS|Islandia|354;IL|Israel|972;IT|Italia|39;JM|Jamaica|1876;JP|Japón|81;JO|Jordania|962;KZ|Kazajistán|7;KE|Kenia|254;KG|Kirguistán|996;KW|Kuwait|965;LA|Laos|856;LS|Lesoto|266;LV|Letonia|371;LB|Líbano|961;LR|Liberia|231;LY|Libia|218;LI|Liechtenstein|423;LT|Lituania|370;LU|Luxemburgo|352;MO|Macao|853;MK|Macedonia del Norte|389;MG|Madagascar|261;MY|Malasia|60;MW|Malaui|265;MV|Maldivas|960;ML|Malí|223;MT|Malta|356;MA|Marruecos|212;MU|Mauricio|230;MR|Mauritania|222;MX|México|52;MD|Moldavia|373;MC|Mónaco|377;MN|Mongolia|976;ME|Montenegro|382;MZ|Mozambique|258;MM|Myanmar|95;NA|Namibia|264;NP|Nepal|977;NI|Nicaragua|505;NE|Níger|227;NG|Nigeria|234;NO|Noruega|47;NZ|Nueva Zelanda|64;OM|Omán|968;NL|Países Bajos|31;PK|Pakistán|92;PA|Panamá|507;PG|Papúa Nueva Guinea|675;PY|Paraguay|595;PE|Perú|51;PL|Polonia|48;PT|Portugal|351;PR|Puerto Rico|1787;GB|Reino Unido|44;CF|República Centroafricana|236;CZ|República Checa|420;DO|República Dominicana|1809;RW|Ruanda|250;RO|Rumania|40;RU|Rusia|7;WS|Samoa|685;KN|San Cristóbal y Nieves|1869;SM|San Marino|378;LC|Santa Lucía|1758;VC|San Vicente y las Granadinas|1784;ST|Santo Tomé y Príncipe|239;SN|Senegal|221;RS|Serbia|381;SC|Seychelles|248;SL|Sierra Leona|232;SG|Singapur|65;SY|Siria|963;SO|Somalia|252;LK|Sri Lanka|94;ZA|Sudáfrica|27;SD|Sudán|249;SE|Suecia|46;CH|Suiza|41;SR|Surinam|597;TH|Tailandia|66;TW|Taiwán|886;TZ|Tanzania|255;TJ|Tayikistán|992;TL|Timor Oriental|670;TG|Togo|228;TO|Tonga|676;TT|Trinidad y Tobago|1868;TN|Túnez|216;TM|Turkmenistán|993;TR|Turquía|90;UA|Ucrania|380;UG|Uganda|256;UY|Uruguay|598;UZ|Uzbekistán|998;VU|Vanuatu|678;VE|Venezuela|58;VN|Vietnam|84;YE|Yemen|967;DJ|Yibuti|253;ZM|Zambia|260;ZW|Zimbabue|263".split(";").map((x) => x.split("|"));
const POPULAR_COUNTRIES = ["PE", "ES", "US", "CL", "CO", "EC", "BO", "AR", "MX", "VE", "IT", "BR"];
const flagUrl = (iso) => `https://flagcdn.com/w40/${String(iso).toLowerCase()}.png`;
const splitPhone = (full) => {
  const d = String(full || "").replace(/\D/g, "");
  const order = [...PHONE_COUNTRIES].sort((a, b) => b[2].length - a[2].length || POPULAR_COUNTRIES.indexOf(b[0]) - POPULAR_COUNTRIES.indexOf(a[0]));
  const match = order.find((c) => d.startsWith(c[2]) && d.length > c[2].length + 5)
    || (d.length <= 9 ? order.find((c) => d === c[2]) || order.find((c) => d.startsWith(c[2])) : null);
  return match ? { code: match[2], number: d.slice(match[2].length) } : { code: "51", number: d };
};
const phoneIsValid = (full) => { const { number } = splitPhone(full); return number.length >= 6 && number.length <= 12; };
const CountryCodeSelect = ({ code, onPick }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => { const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", off); document.addEventListener("touchstart", off); return () => { document.removeEventListener("mousedown", off); document.removeEventListener("touchstart", off); }; }, []);
  const current = PHONE_COUNTRIES.find((c) => c[2] === code && POPULAR_COUNTRIES.includes(c[0])) || PHONE_COUNTRIES.find((c) => c[2] === code) || ["PE", "Perú", "51"];
  const nq = normText(q.trim());
  const list = [...PHONE_COUNTRIES].filter((c) => !nq || normText(c[1]).includes(nq) || c[2].startsWith(nq.replace("+", "")))
    .sort((a, b) => { const pa = POPULAR_COUNTRIES.indexOf(a[0]), pb = POPULAR_COUNTRIES.indexOf(b[0]); if (!nq && (pa >= 0 || pb >= 0)) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb); return a[1].localeCompare(b[1], "es"); });
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={t("País: {c}", { c: t(current[1]) })} style={{ ...inputStyle, width: 112, display: "flex", alignItems: "center", gap: 7, cursor: "pointer", paddingRight: 8 }}>
        <img src={flagUrl(current[0])} alt="" width="22" height="15" style={{ borderRadius: 2, objectFit: "cover", flexShrink: 0 }} />
        <span style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink }}>+{current[2]}</span>
        <ChevronDown size={13} style={{ marginLeft: "auto" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 80, width: 280, marginTop: 4, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 14px 34px rgba(0,0,0,0.16)" }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${C.paperDeep}` }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar país o código")} style={{ ...inputStyle, padding: "9px 10px" }} />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {list.map((c, i) => (
              <button key={c[0]} type="button" onClick={() => { onPick(c[2]); setOpen(false); setQ(""); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: c[2] === code ? C.paperDeep : "none", border: "none", borderTop: !nq && i === POPULAR_COUNTRIES.length ? `1px solid ${C.line}` : "none", cursor: "pointer", textAlign: "left" }}>
                <img src={flagUrl(c[0])} alt="" width="22" height="15" loading="lazy" style={{ borderRadius: 2, objectFit: "cover", flexShrink: 0 }} />
                <span style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{c[1]}</span>
                <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>+{c[2]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
const PhoneInput = ({ value, onChange, placeholder = t("Celular (WhatsApp)"), style }) => {
  const { code, number } = splitPhone(value);
  return (
    <div style={{ display: "flex", gap: 6, ...style }}>
      <CountryCodeSelect code={code} onPick={(c) => onChange(c + number)} />
      <input value={number} inputMode="tel" autoComplete="tel-national" placeholder={placeholder}
        onChange={(e) => { const raw = e.target.value; if (raw.trim().startsWith("+")) { const p = splitPhone(raw); onChange(p.code + p.number.slice(0, 12)); } else onChange(code + raw.replace(/\D/g, "").slice(0, 12)); }} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
    </div>
  );
};

// ---- Programa de puntos del Club Fly (se ajusta en Panel → Programa de puntos) ----
const DEFAULT_LOYALTY = { solesPerStep: 1, pointsPerStep: 1, blockPoints: 100, blockValue: 3 };
const loyaltyOf = (settings) => {
  const raw = settings?.loyalty || {};
  const l = { ...DEFAULT_LOYALTY, ...raw };
  // compatibilidad con la versión anterior (puntos por cada S/ 1)
  if (raw.pointsPerSol !== undefined && raw.solesPerStep === undefined) { l.solesPerStep = 1; l.pointsPerStep = Number(raw.pointsPerSol) || 0; }
  const solesPerStep = Math.max(0.01, Number(l.solesPerStep) || 1), pointsPerStep = Number(l.pointsPerStep) || 0;
  return { solesPerStep, pointsPerStep, pointsPerSol: pointsPerStep / solesPerStep, blockPoints: Math.max(1, Number(l.blockPoints) || 100), blockValue: Number(l.blockValue) || 0 };
};
const pointsEarned = (amount, settings) => { const l = loyaltyOf(settings); return Math.floor(Math.max(0, amount) / l.solesPerStep) * l.pointsPerStep; };
// El Club Fly se puede apagar desde el Panel (para probar si es rentable). Apagado: no se ganan ni se usan puntos
// (también lo revisa el servidor) y los puntos de cada clienta se conservan.
const clubOn = (settings) => settings?.clubEnabled !== false;
const pointsValue = (pts, settings) => { const l = loyaltyOf(settings); return Math.floor(Math.max(0, pts) / l.blockPoints) * l.blockValue; };

// ---- Datos de la empresa (para comprobantes y Libro de Reclamaciones) ----
const DEFAULT_COMPANY = { legalName: "Fly Boutique", ruc: "", address: "Av. Larco 126, Trujillo, La Libertad, Perú", email: "flyboutiqueperu@gmail.com", phone: "51978687704" };
const companyOf = (settings) => ({ ...DEFAULT_COMPANY, ...(settings?.company || {}) });
const DEFAULT_STORES = [{ id: "principal", name: "Tienda principal", address: "Av. Larco 126, Trujillo" }];
const storesOf = (settings) => (settings?.stores && settings.stores.length ? settings.stores : DEFAULT_STORES);

// ---- Envíos internacionales (Serpost con Exporta Fácil, o DHL Express) ----
const INTL_COUNTRIES = [
  ["US", "Estados Unidos", "america"], ["CA", "Canadá", "america"], ["MX", "México", "america"], ["CL", "Chile", "america"], ["CO", "Colombia", "america"],
  ["EC", "Ecuador", "america"], ["BO", "Bolivia", "america"], ["AR", "Argentina", "america"], ["BR", "Brasil", "america"], ["UY", "Uruguay", "america"],
  ["PY", "Paraguay", "america"], ["PA", "Panamá", "america"], ["CR", "Costa Rica", "america"], ["VE", "Venezuela", "america"],
  ["ES", "España", "europa"], ["IT", "Italia", "europa"], ["FR", "Francia", "europa"], ["DE", "Alemania", "europa"], ["PT", "Portugal", "europa"],
  ["GB", "Reino Unido", "europa"], ["NL", "Países Bajos", "europa"], ["CH", "Suiza", "europa"], ["BE", "Bélgica", "europa"],
  ["JP", "Japón", "resto"], ["AU", "Australia", "resto"], ["KR", "Corea del Sur", "resto"], ["CN", "China", "resto"], ["AE", "Emiratos Árabes", "resto"],
];
const INTL_ZONES = { america: "América", europa: "Europa", resto: "Resto del mundo" };
const INTL_CARRIERS = { serpost: { name: "Serpost (Exporta Fácil)", note: "Económico, con seguimiento" }, dhl: { name: "DHL Express", note: "Rápido, puerta a puerta" } };
const intlZone = (countryName) => (INTL_COUNTRIES.find((c) => c[1] === countryName) || [])[2] || "resto";
// Precio por país si se configuró; si no, el de su zona (América, Europa, Resto del mundo); si tampoco, "por cotizar".
const intlRate = (settings, countryName, carrier) => {
  const c = settings?.intlCountryRates?.[countryName]?.[carrier];
  if (c !== undefined && c !== "" && !isNaN(Number(c))) return Number(c);
  const r = settings?.intlRates?.[intlZone(countryName)]?.[carrier];
  return r ? Number(r) : null;
};

// ---- Envíos ----
const TRUJILLO_DISTRICTS = ["Trujillo (Cercado)", "Víctor Larco Herrera", "La Esperanza", "El Porvenir", "Florencia de Mora", "Huanchaco", "Moche", "Laredo", "Salaverry", "Alto Trujillo"];
// Tarifa de envío a provincia por departamento (S/). Se puede ajustar aquí.
const PROVINCE_ZONES = {
  12: ["La Libertad", "Lambayeque", "Piura", "Tumbes", "Cajamarca", "Áncash", "Amazonas", "San Martín"],
  15: ["Lima", "Callao", "Ica", "Junín", "Pasco", "Huánuco", "Huancavelica", "Ayacucho"],
  18: ["Arequipa", "Moquegua", "Tacna", "Cusco", "Puno", "Apurímac"],
  22: ["Loreto", "Ucayali", "Madre de Dios"],
};
const PERU_DEPARTMENTS = Object.values(PROVINCE_ZONES).flat().sort((a, b) => a.localeCompare(b, "es"));
// Las tarifas se pueden cambiar en Panel → Envíos. Si no se configuraron, se usan estas por defecto.
// El servidor (place_order) usa las mismas reglas para revisar el total.
const numOr = (v, d) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? d : Number(v));
const defaultProvinceRate = (dep) => { const hit = Object.entries(PROVINCE_ZONES).find(([, deps]) => deps.includes(dep)); return hit ? Number(hit[0]) : 15; };
const provinceRate = (dep, settings) => numOr(settings?.provinceRates?.[dep], defaultProvinceRate(dep));
const localShippingOf = (settings) => ({ price: numOr(settings?.localShipping?.price, 12), freeFrom: numOr(settings?.localShipping?.freeFrom, 200) });
const SHIPPING_AGENCIES = ["Shalom", "Olva Courier", "Marvisur", "Cualquiera (la más rápida)"];
const ADDRESSES_KEY = "flyboutique:direcciones:v1";

// ---- Recomendador de talla (con las medidas que guarda la clienta) ----
const MEASURES_KEY = "flyboutique:medidas:v1";
const rangeMax = (r) => Number(String(r).split("-").pop());
function recommendSize(m) {
  const vals = { busto: Number(m?.busto) || 0, cintura: Number(m?.cintura) || 0, cadera: Number(m?.cadera) || 0 };
  if (!vals.busto && !vals.cintura && !vals.cadera) return null;
  for (const row of SIZE_CHART_CLOTHING) {
    if ((!vals.busto || vals.busto <= rangeMax(row.busto)) && (!vals.cintura || vals.cintura <= rangeMax(row.cintura)) && (!vals.cadera || vals.cadera <= rangeMax(row.cadera))) return row.talla;
  }
  return "XL+";
}
const loadMeasures = () => { try { return JSON.parse(localStorage.getItem(MEASURES_KEY) || "null"); } catch (e) { return null; } };

const DELIVERY_LABELS_EXTRA = { internacional: "✈️ Envío internacional" };
const DELIVERY_LABELS = { recojo: "🏬 Recojo en tienda", local: "🛵 Delivery en Trujillo (zona local)", provincia: "🚚 Envío a otra provincia" };

const buildWhatsAppOrderMessage = (cart, subtotal, shipping, discount, promoCode, total, deliveryMethod, deliveryAddress, saleLabel, extraNote) => {
  const lines = [
    "¡Hola Fly Boutique! 👋 Quiero hacer este pedido:", "",
    ...cart.map((i) => `• ${i.name} — Talla ${i.size}, ${i.color?.n} × ${i.qty} — ${money(i.price * i.qty)}`),
    "",
    `Subtotal: ${money(subtotal)}`,
    ...(discount > 0 ? [`Descuento (${promoCode}): -${money(discount)}`] : []),
    `Envío: ${shipping === 0 ? t("Gratis") : money(shipping)}`,
    `Total: ${money(total)}`,
    "",
    DELIVERY_LABELS[deliveryMethod] || DELIVERY_LABELS_EXTRA[deliveryMethod] || deliveryMethod,
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
    script.onerror = () => reject(new Error(t("No se pudo cargar Culqi")));
    document.body.appendChild(script);
    setTimeout(() => reject(new Error("timeout")), 4000);
  });
}

// Aviso del tiempo que las prendas siguen apartadas (como en las tiendas grandes: claro, sin presionar).
const CartHoldNotice = ({ cart, onRenew }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const until = Math.min(...cart.map((i) => i.heldUntil || 0).filter(Boolean));
  if (!Number.isFinite(until)) return null;
  const left = Math.ceil((until - now) / 60000);
  const box = { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: C.paperDeep, fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.45, marginBottom: 14 };
  if (left <= 0) return (
    <div style={box}>
      <Clock size={16} color={C.ink} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{t("Pasó el tiempo de reserva: tus prendas siguen en la cesta, pero otra persona podría llevárselas.")}</span>
      {onRenew && <button onClick={onRenew} style={{ padding: "7px 10px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>{t("Apartar de nuevo")}</button>}
    </div>
  );
  return (
    <div style={box}>
      <Clock size={16} color={C.ink} style={{ flexShrink: 0 }} />
      <span>{t("Te apartamos estas prendas")} <strong style={{ color: C.ink }}>{t("{n} min más", { n: left })}</strong> {t("(hasta las {h}). Después quedan libres para otras personas.", { h: new Date(until).toLocaleTimeString(getLang() === "en" ? "en-US" : "es-PE", { hour: "2-digit", minute: "2-digit" }) })}</span>
    </div>
  );
};
const CartScreen = ({ cart, onRenewHold, updateQty, removeItem, setScreen, culqiPublicKey, payAccounts, promoCodes, clubMember, onConfirmOrder, points = 0 }) => {
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoMsg, setPromoMsg] = useState(null);
  const [culqiLoading, setCulqiLoading] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("recojo");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [addr, setAddr] = useState(null);
  const [savedAddrs] = useState(loadAddresses);
  const [opNumber, setOpNumber] = useState("");
  const [customerName, setCustomerName] = useState(clubMember?.name || "");
  const [customerPhone, setCustomerPhone] = useState(clubMember?.phone || "");
  const [paymentMethod, setPaymentMethod] = useState("Yape");
  const [confirmedSale, setConfirmedSale] = useState(null);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  // Outlet: precio final. Cupones, puntos y envío gratis se calculan solo con el resto (igual que el servidor).
  const regularSubtotal = cart.reduce((s, i) => s + (i.outlet ? 0 : i.price * i.qty), 0);
  const hasOutlet = cart.some((i) => i.outlet);
  const [intlCarrier, setIntlCarrier] = useState("serpost");
  const intlCost = deliveryMethod === "internacional" ? intlRate(payAccounts, addr?.country, intlCarrier) : null;
  const intlToQuote = deliveryMethod === "internacional" && intlCost === null;
  const shipping = cart.length === 0 || deliveryMethod === "recojo" ? 0 : deliveryMethod === "internacional" ? (intlCost || 0) : deliveryMethod === "provincia" ? provinceRate(addr?.department, payAccounts) : (regularSubtotal >= localShippingOf(payAccounts).freeFrom ? 0 : localShippingOf(payAccounts).price);
  useEffect(() => { if (deliveryMethod === "internacional" && (paymentMethod === "Yape" || paymentMethod === "Plin")) setPaymentMethod("Transferencia"); }, [deliveryMethod]);
  useEffect(() => { if (deliveryMethod !== "recojo") setDeliveryAddress(addr ? formatAddress(addr) : ""); }, [addr, deliveryMethod]);
  useEffect(() => { setAddr((a) => (a && a.type === deliveryMethod ? a : (savedAddrs.find((x) => x.type === deliveryMethod) || null))); }, [deliveryMethod]);
  const discount = appliedPromo ? computeDiscount(appliedPromo, regularSubtotal) : 0;
  const loyalty = loyaltyOf(payAccounts);
  const [usePoints, setUsePoints] = useState(false);
  // Usar puntos online requiere entrar con Google (así nadie usa los puntos de otra persona con solo su celular)
  const clubActive = clubOn(payAccounts);
  const maxBlocks = clubActive && clubMember?.phone && clubMember?.google ? Math.floor(points / loyalty.blockPoints) : 0;
  const pointsNeedGoogle = clubActive && !!clubMember?.phone && !clubMember?.google && points >= loyalty.blockPoints && loyalty.blockValue > 0;
  const blocksAllowed = Math.min(maxBlocks, loyalty.blockValue > 0 ? Math.floor(Math.max(0, regularSubtotal - discount) / loyalty.blockValue) : 0);
  const pointsUsed = usePoints ? blocksAllowed * loyalty.blockPoints : 0;
  const pointsDiscount = usePoints ? blocksAllowed * loyalty.blockValue : 0;
  const total = Math.max(0, subtotal + shipping - discount - pointsDiscount);
  const earned = pointsEarned(regularSubtotal - discount - pointsDiscount, payAccounts);

  const applyPromo = () => {
    const promo = findPromo(promoCodes, promoInput);
    if (!promo) { setPromoMsg({ ok: false, text: t("Código no válido") }); return; }
    if (promo.clubOnly && !clubMember) { setPromoMsg({ ok: false, text: t("Este código es solo para el Club Fly — únete gratis en la pestaña Club Fly.") }); return; }
    setAppliedPromo(promo);
    setPromoMsg({ ok: true, text: t("Código {c} aplicado", { c: promo.code }) });
  };

  const [placing, setPlacing] = useState(false);
  // Identificador de este pedido: si se corta internet y se reintenta, no se crea un pedido doble
  const requestIdRef = useRef(null);
  useEffect(() => { requestIdRef.current = null; }, [cart]);
  const placeOrder = async (extraNote, method) => {
    if (placing) return;
    setPlacing(true);
    if (!requestIdRef.current) requestIdRef.current = genId("req");
    // La pestaña de WhatsApp se abre ya (si se espera al servidor, el celular la bloquea)
    let popup = null;
    try { popup = window.open("", "_blank"); } catch (e) { popup = null; }
    const orderCart = cart;
    const sale = await onConfirmOrder({
      cart: orderCart, subtotal, shipping, discount, promoCode: appliedPromo?.code || null, total,
      deliveryMethod, deliveryAddress: deliveryAddress.trim(), customerName: customerName.trim(), customerPhone: customerPhone.replace(/\D/g, ""), paymentMethod: method,
      paymentRef: method === "Tarjeta" ? "" : opNumber.trim(),
      pointsUsed, pointsDiscount, clientRequestId: requestIdRef.current,
      deliveryDetails: deliveryMethod === "recojo" ? null : { ...(addr || {}), type: deliveryMethod, ...(deliveryMethod === "internacional" ? { carrier: INTL_CARRIERS[intlCarrier].name, toQuote: intlToQuote } : {}) },
    });
    setPlacing(false);
    if (!sale) { try { popup && popup.close(); } catch (e) { /* ya cerrada */ } return; }
    const label = `${sale.serie}-${String(sale.numero).padStart(6, "0")}`;
    const extra = [addr?.reference && `Referencia: ${addr.reference}`, addr?.agency && deliveryMethod === "provincia" && `Agencia: ${addr.agency}`, addr?.mapsUrl && deliveryMethod === "local" && `Ubicación: ${addr.mapsUrl}`, extraNote].filter(Boolean).join("\n");
    const msg = buildWhatsAppOrderMessage(orderCart, subtotal, shipping, discount, appliedPromo?.code, total, deliveryMethod, deliveryAddress, label, extra);
    const url = `https://wa.me/${STORE_WHATSAPP}?text=${msg}`;
    try { if (popup) popup.location.href = url; } catch (e) { /* bloqueada */ }
    setConfirmedSale({ ...sale, whatsappUrl: url });
  };

  const confirmManualPayment = () => {
    const note = `Pago por ${paymentMethod === "Transferencia" ? "transferencia bancaria" : paymentMethod}. N.° de operación: ${opNumber.trim()}. Adjunto la captura.`;
    placeOrder(note, paymentMethod);
  };

  const payWithCulqi = async () => {
    if (!customerName.trim() || !phoneIsValid(customerPhone) || !addressOk) { alert(deliveryMethod !== "recojo" ? t("Completa los datos con * (nombre, celular y dirección) antes de pagar.") : t("Completa los datos con * (nombre y celular) antes de pagar.")); return; }
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
          alert(t("No se pudo validar la tarjeta: ") + (culqiInstance.error?.user_message || t("intenta de nuevo.")));
        }
      };
      culqiInstance.open();
    } catch (err) {
      alert("No se pudo abrir el formulario de Culqi en esta vista previa (el entorno de prueba de Claude bloquea scripts externos). Esto funcionará normalmente una vez que la app esté publicada en tu propio dominio.");
    }
    setCulqiLoading(false);
  };

  if (confirmedSale) {
    const deliveryLabel = confirmedSale.deliveryMethod === "recojo" ? t("preparando para que lo recojas en tienda") : confirmedSale.deliveryMethod === "provincia" ? t("alistando para enviarlo a tu provincia") : t("alistando para el delivery en Trujillo");
    return (
      <div style={{ padding: "18px 20px", textAlign: "center" }}>
        <BadgeLogo size={48} />
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 800, color: C.ink, margin: "16px 0 6px" }}>{t("¡Pedido enviado!")}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 4 }}>{t("Pedido")} {confirmedSale.serie}-{String(confirmedSale.numero).padStart(6, "0")}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, marginBottom: 10, maxWidth: 260, marginLeft: "auto", marginRight: "auto" }}>
          Fly Boutique ya tiene tu pedido y lo está {deliveryLabel}.
        </div>
        {confirmedSale.paymentMethod !== "Tarjeta (Culqi)" && (
          <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 20, maxWidth: 280, marginLeft: "auto", marginRight: "auto", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>
            No olvides adjuntar la captura de tu pago en el mensaje de WhatsApp — así confirmamos más rápido y alistamos tu pedido.
          </div>
        )}
        <button onClick={() => setScreen("track")} style={{ display: "block", margin: "0 auto 12px", background: "none", border: "none", textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, cursor: "pointer" }}>{t("Guarda tu número de pedido: con él puedes rastrearlo aquí")}</button>
        {confirmedSale.whatsappUrl && (
          <a href={confirmedSale.whatsappUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, maxWidth: 280, margin: "0 auto 16px", padding: "13px 16px", borderRadius: 9, border: `1px solid ${C.ink}`, color: C.ink, textDecoration: "none", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600 }}>
            <MessageCircle size={15} /> ¿No se abrió WhatsApp? Toca aquí
          </a>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {clubMember && <button onClick={() => setScreen("orders")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", background: "transparent", color: C.ink, border: `1px solid ${C.ink}`, padding: "13px 20px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>{t("Ver mi pedido")}</button>}
          <button onClick={() => setScreen("home")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", background: C.ink, color: C.paper, border: "none", padding: "13px 20px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>{t("Seguir viendo")}</button>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 420, textAlign: "center" }}>
        <BadgeLogo size={52} />
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "18px 0 6px" }}>{t("Tu bolsa está vacía")}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, marginBottom: 22, maxWidth: 240 }}>{t("Explora el catálogo y encuentra piezas que valen la pena.")}</div>
        <button onClick={() => setScreen("home")} style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", background: C.ink, color: C.paper, border: "none", padding: "13px 26px", borderRadius: 9, cursor: "pointer", fontWeight: 600 }}>{t("Ir de compras")}</button>
      </div>
    );
  }

  const needsOp = paymentMethod === "Yape" || paymentMethod === "Plin" || paymentMethod === "Transferencia";
  const addressOk = deliveryMethod === "recojo" || addressComplete(addr, deliveryMethod);
  const canPlaceManual = customerName.trim() && phoneIsValid(customerPhone) && addressOk && (!needsOp || opNumber.trim().length >= 4);

  return (
    <div style={{ padding: "18px 20px 20px" }}>
      <Eyebrow>{cart.reduce((a, i) => a + i.qty, 0)} {t("artículos")}</Eyebrow>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{t("Mi Cesta")}</h1>
      <CartHoldNotice cart={cart} onRenew={onRenewHold} />
      {hasOutlet && <div style={{ marginBottom: 14 }}><OutletRules compact /></div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
        {cart.map((item) => (
          <div key={item.cartId} style={{ display: "flex", gap: 12, paddingBottom: 14, borderBottom: `1px solid ${C.paperDeep}` }}>
            <div style={{ width: 72, height: 90, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}><ProductImg src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.ink, fontWeight: 600, lineHeight: 1.25 }}>{item.name}</div>
                <button onClick={() => removeItem(item.cartId)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Trash2 size={14} color={C.stone} /></button>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, margin: "3px 0 6px" }}>{t("Talla")} {item.size} · {t(item.color?.n)}</div>
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

      <span style={labelStyle}>{t("Entrega")}</span>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Chip active={deliveryMethod === "recojo"} onClick={() => setDeliveryMethod("recojo")}>{t("Recojo en tienda")}</Chip>
        <Chip active={deliveryMethod === "local"} onClick={() => setDeliveryMethod("local")}>{t("Delivery en Trujillo")}</Chip>
        <Chip active={deliveryMethod === "provincia"} onClick={() => setDeliveryMethod("provincia")}>{t("Envío a otra provincia")}</Chip>
        <Chip active={deliveryMethod === "internacional"} onClick={() => setDeliveryMethod("internacional")}>{t("Envío internacional")}</Chip>
      </div>
      {deliveryMethod === "internacional" && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {Object.entries(INTL_CARRIERS).map(([k, c]) => (
              <button key={k} onClick={() => setIntlCarrier(k)} style={{ flex: "1 1 140px", textAlign: "left", padding: "10px 12px", borderRadius: 10, border: `1px solid ${intlCarrier === k ? C.ink : C.line}`, background: intlCarrier === k ? C.paperDeep : "transparent", cursor: "pointer" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{t(c.name)}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{t(c.note)}{addr?.country && intlRate(payAccounts, addr.country, k) ? ` · ${money(intlRate(payAccounts, addr.country, k))}` : ""}</div>
              </button>
            ))}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, lineHeight: 1.6 }}>{t("Enviamos desde Trujillo, Perú. Los impuestos de importación del país de destino los paga quien recibe.")} {intlToQuote ? t("Te confirmamos el costo exacto del envío por WhatsApp antes de que pagues.") : ""}</div>
        </div>
      )}
      {deliveryMethod !== "recojo" && (
        <div style={{ marginBottom: 6 }}>
          {savedAddrs.filter((x) => x.type === deliveryMethod).length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {savedAddrs.filter((x) => x.type === deliveryMethod).map((x) => <Chip key={x.id} active={addr?.id === x.id} onClick={() => setAddr(x)}>{x.label}</Chip>)}
              <Chip active={!!addr && !addr.id} onClick={() => setAddr({ type: deliveryMethod })}>{t("Otra dirección")}</Chip>
            </div>
          )}
          <AddressFields value={addr} type={deliveryMethod} onChange={(v) => setAddr({ ...v, id: undefined })} />
          {deliveryMethod === "provincia" && addr?.department && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 8 }}>{t("Envío a")} {addr.department}: {money(provinceRate(addr.department, payAccounts))}{t(". Te enviamos la clave de recojo de la agencia por WhatsApp.")}</div>}
        </div>
      )}
      {false && (
        <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder={deliveryMethod === "provincia" ? t("Dirección completa + ciudad/provincia") : t("Dirección de entrega en Trujillo")} style={{ ...inputStyle, marginBottom: 10 }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{t("Los datos con * son obligatorios.")}</div>
        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t("Tu nombre *")} style={inputStyle} />
        <PhoneInput value={customerPhone} onChange={setCustomerPhone} placeholder={t("Celular (WhatsApp) *")} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 8, padding: "0 12px" }}>
          <Ticket size={14} color={C.stone} />
          <input value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder={t("Código promocional")} disabled={!!appliedPromo} style={{ border: "none", outline: "none", padding: "11px 0", fontFamily: FONT_BODY, fontSize: 12.5, flex: 1, background: "transparent", color: C.ink }} />
        </div>
        {appliedPromo ? (
          <button onClick={() => { setAppliedPromo(null); setPromoInput(""); setPromoMsg(null); }} style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, cursor: "pointer" }}>{t("Quitar")}</button>
        ) : (
          <button onClick={applyPromo} style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, cursor: "pointer" }}>{t("Aplicar")}</button>
        )}
      </div>
      {promoMsg && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: promoMsg.ok ? C.ink : C.accent, marginBottom: 16 }}>{promoMsg.text}</div>}
      {pointsNeedGoogle && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, lineHeight: 1.5 }}>
          <Star size={13} color={C.ink} style={{ verticalAlign: "-2px", marginRight: 6 }} />{t("Tienes")} {points} puntos. Para usarlos en la web, confirma tu cuenta en Club Fly (con Google o con un código a tu correo), o úsalos en la tienda.
        </div>
      )}
      {blocksAllowed > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${usePoints ? C.ink : C.line}`, borderRadius: 10, padding: "11px 12px", marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
          <Star size={14} color={C.ink} />
          <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{t("Usar")} {blocksAllowed * loyalty.blockPoints} {t("puntos y ahorrar")} <strong>{money(blocksAllowed * loyalty.blockValue)}</strong> <span style={{ color: C.stone }}>({t("tienes {n}", { n: points })})</span></span>
        </label>
      )}
      <div style={{ background: C.paperDeep, borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
        <Row label={t("Subtotal")} value={money(subtotal)} />
        {discount > 0 && <Row label={t("Descuento ({c})", { c: appliedPromo.code })} value={`-${money(discount)}`} />}
        {pointsDiscount > 0 && <Row label={t("Puntos Fly ({n} pts)", { n: pointsUsed })} value={`-${money(pointsDiscount)}`} />}
        <Row label={t("Envío")} value={intlToQuote ? t("Por cotizar") : shipping === 0 ? t("Gratis") : money(shipping)} />
        <div style={{ height: 1, background: C.line, margin: "10px 0" }} />
        <Row label={t("Total")} value={money(total)} bold />
        {clubActive && earned > 0 && (<div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontFamily: FONT_BODY, fontSize: 11.5, color: C.brass }}><Star size={12} fill={C.brass} color={C.brass} /> {t("Ganarás")} {earned} {t("puntos Fly con esta compra")}</div>)}
      </div>
      {shipping > 0 && deliveryMethod === "local" && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 16, textAlign: "center" }}>{t("Agrega")} {money(200 - subtotal)} {t("más para envío gratis en Trujillo")}</div>}

      <span style={labelStyle}>{t("Método de pago")}</span>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(deliveryMethod === "internacional" ? ["Transferencia", "Tarjeta"] : ["Yape", "Plin", "Transferencia", "Tarjeta"]).map((m) => (
          <button key={m} onClick={() => setPaymentMethod(m)} aria-pressed={paymentMethod === m} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px 8px 8px", borderRadius: 12, border: `1.5px solid ${paymentMethod === m ? C.ink : C.line}`, background: paymentMethod === m ? C.paperDeep : C.paper, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
            <PayBadge method={m} size={28} /> {t(m)}
          </button>
        ))}
      </div>

      {paymentMethod === "Yape" && payAccounts?.yapeNumber && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 2 }}>{t("Yapea el total a:")}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{payAccounts.yapeNumber}</div>
        </div>
      )}
      {paymentMethod === "Plin" && payAccounts?.plinNumber && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 2 }}>{t("Plinea el total a:")}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{payAccounts.plinNumber}</div>
        </div>
      )}
      {paymentMethod === "Transferencia" && (payAccounts?.bankAccount || payAccounts?.bankCCI) && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, lineHeight: 1.7 }}>
          <div>{t("Banco:")} <strong>{payAccounts.bankName || "—"}</strong></div>
          <div>{t("Cuenta:")} <strong>{payAccounts.bankAccount || "—"}</strong></div>
          <div>{t("CCI:")} <strong>{payAccounts.bankCCI || "—"}</strong></div>
        </div>
      )}
      {(paymentMethod === "Yape" || paymentMethod === "Plin" || paymentMethod === "Transferencia") && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertCircle size={15} color={C.ink} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.6 }}>{t("Realiza el pago, escribe abajo el")} <strong>{t("número de operación")}</strong> {t("y adjunta la captura en el WhatsApp que se abrirá. Con ese número validamos tu pago rápido.")}</div>
        </div>
      )}
      {needsOp && (
        <input value={opNumber} onChange={(e) => setOpNumber(e.target.value.replace(/[^0-9A-Za-z-]/g, "").slice(0, 20))} placeholder={t("Número de operación del pago")} inputMode="numeric" style={{ ...inputStyle, marginBottom: 14 }} />
      )}

      {paymentMethod === "Tarjeta" ? (
        <PrimaryButton onClick={payWithCulqi} disabled={culqiLoading}><CreditCard size={16} /> {culqiLoading ? t("Abriendo…") : t("Pagar con tarjeta (Culqi)")}</PrimaryButton>
      ) : (
        <PrimaryButton key={canPlaceManual ? "ok" : "no"} className={canPlaceManual && !placing ? "btn-ready" : ""} onClick={confirmManualPayment} disabled={!canPlaceManual || placing}><MessageCircle size={16} /> {placing ? t("Registrando tu pedido…") : t("Confirmar pedido por WhatsApp")}</PrimaryButton>
      )}
      {paymentMethod !== "Tarjeta" && <Faltan tr={t} center items={[!customerName.trim() && "escribe tu nombre", !phoneIsValid(customerPhone) && "escribe un celular válido", ...(deliveryMethod !== "recojo" ? addressMissing(addr, deliveryMethod) : []), needsOp && opNumber.trim().length < 4 && "escribe el número de operación del pago"]} />}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  LOYALTY + PROFILE SCREENS                                          */
/* ------------------------------------------------------------------ */
const TIERS = [{ n: "Bronce", min: 0 }, { n: "Plata", min: 500 }, { n: "Oro", min: 1200 }];
const REWARDS = [{ n: "Envío gratis", cost: 150, icon: Package }, { n: "S/ 20 de descuento", cost: 300, icon: Gift }, { n: "Acceso anticipado a colección", cost: 450, icon: Sparkles }, { n: "S/ 50 de descuento", cost: 700, icon: Gift }];

const LoyaltyScreen = ({ points, onRedeem, clubMember, onRegister, onLogoutClub, onGoogleSignIn, googlePrefill, turnstileSiteKey, settings }) => {
  const loyalty = loyaltyOf(settings);
  if (!clubOn(settings)) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center" }}>
        <Award size={30} color={C.line} style={{ marginBottom: 14 }} />
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, color: C.ink, marginBottom: 8 }}>{t("Club Fly en pausa")}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, maxWidth: 280, margin: "0 auto", lineHeight: 1.6 }}>{t("Por ahora no se suman ni se canjean puntos.")}{clubMember ? ` ${t("Tus {n} puntos están guardados y seguirán ahí cuando el club vuelva.", { n: points })}` : ""}</div>
      </div>
    );
  }
  if (!clubMember) return <ClubFlySignup onRegister={onRegister} onGoogleSignIn={onGoogleSignIn} googlePrefill={googlePrefill} turnstileSiteKey={turnstileSiteKey} />;
  const tierIdx = points >= 1200 ? 2 : points >= 500 ? 1 : 0;
  const nextTier = TIERS[tierIdx + 1];
  const progress = nextTier ? Math.min(100, ((points - TIERS[tierIdx].min) / (nextTier.min - TIERS[tierIdx].min)) * 100) : 100;
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Eyebrow>{t("Programa de fidelidad")}</Eyebrow>
        <button onClick={onLogoutClub} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textDecoration: "underline" }}>{t("¿No eres {n}? Cerrar sesión", { n: clubMember.name.split(" ")[0] })}</button>
      </div>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{t("Club Fly")}</h1>
      {!clubMember.google && <VerifyAccountBox onGoogleSignIn={onGoogleSignIn} />}
      <div style={{ borderRadius: 14, padding: "24px 22px", background: C.ink, position: "relative", overflow: "hidden", marginBottom: 22, color: C.paper }}>
        <div style={{ position: "absolute", right: 18, top: 18, opacity: 0.5 }}><BadgeLogo size={28} dark /></div>
        <Eyebrow color={C.brassSoft}>{t("Nivel")} {t(TIERS[tierIdx].n)}</Eyebrow>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 800, margin: "2px 0 14px" }}>{points} <span style={{ fontSize: 14, fontFamily: FONT_BODY, fontWeight: 400, opacity: 0.75 }}>{t("puntos")}</span></div>
        {nextTier ? (<><div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.18)", overflow: "hidden", marginBottom: 8 }}><div style={{ height: "100%", width: `${progress}%`, background: C.brass, borderRadius: 999 }} /></div><div style={{ fontFamily: FONT_BODY, fontSize: 11.5, opacity: 0.8 }}>{nextTier.min - points} {t("puntos para nivel")} {t(nextTier.n)}</div></>) : <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, opacity: 0.8 }}>{t("Has alcanzado el nivel máximo")}</div>}
      </div>
      <SectionTitle title={t("Cómo funciona")} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 20px", marginBottom: 22 }}>
        {[
          [t(loyalty.pointsPerStep === 1 ? "Ganas {p} punto por cada S/ {s} en compras (web y tienda)" : "Ganas {p} puntos por cada S/ {s} en compras (web y tienda)", { p: loyalty.pointsPerStep, s: loyalty.solesPerStep }), Sparkles],
          [t("Cada {p} puntos valen {m} de descuento", { p: loyalty.blockPoints, m: money(loyalty.blockValue) }), Gift],
          [t("En la web los usas en la cesta al pagar (con tu cuenta confirmada: Google o código al correo)"), ShoppingBag],
          [t("En la tienda física, da tu DNI o celular al pagar para sumar y usar tus puntos"), Store],
        ].map(([text, Icon], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: C.paperDeep, borderRadius: 10, padding: "12px 14px" }}>
            <Icon size={16} color={C.ink} style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{text}</span>
          </div>
        ))}
      </div>
      <div style={{ margin: "0 20px", border: `1px solid ${C.ink}`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
        {/* Los puntos se canjean en bloques: se muestra cuánto ya puede usar y cuánto le falta para el siguiente descuento
            (no se muestran céntimos porque no se pueden canjear fracciones de un bloque) */}
        {(() => {
          const usable = pointsValue(points, settings);
          const rest = loyalty.blockPoints - (points % loyalty.blockPoints);
          const pct = Math.round(((points % loyalty.blockPoints) / loyalty.blockPoints) * 100);
          if (loyalty.blockValue <= 0) return <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{t("Tienes {n} puntos.", { n: points })}</div>;
          return (
            <>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>{usable > 0 ? t("Ya puedes usar") : t("Tu primer descuento")}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 800, color: C.ink }}>{usable > 0 ? t("{m} de descuento", { m: moneyExact(usable) }) : moneyExact(loyalty.blockValue)}</div>
              <div style={{ height: 6, borderRadius: 999, background: C.paperDeep, overflow: "hidden", margin: "10px 0 6px" }}><div style={{ height: "100%", width: `${pct}%`, background: C.ink, borderRadius: 999 }} /></div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft }}>{t("Te faltan")} <strong>{t("{n} puntos", { n: rest })}</strong> {t(usable > 0 ? "para sumar otros {m} de descuento." : "para ganar {m} de descuento.", { m: moneyExact(loyalty.blockValue) })}</div>
            </>
          );
        })()}
        {!clubMember.phone && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 4 }}>{t("Tu cuenta se activa para puntos con tu primera compra (al dar tu celular).")}</div>}
      </div>
      <MarketingConsentBox verified={!!clubMember.google} />
      {clubMember.google && googlePrefill && <ClubPasswordBox />}
    </div>
  );
};

// Permiso para recibir publicidad (Ley 29733): solo la persona con cuenta confirmada lo cambia desde aquí
const MarketingConsentBox = ({ verified }) => {
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!verified) return;
    supabase.rpc("my_marketing").then(({ data, error }) => { if (!error) setOn(data === true); }).catch(() => {});
  }, [verified]);
  const change = async () => {
    const next = !on;
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("set_marketing_consent", { p_optin: next });
    setBusy(false);
    if (error) { setMsg(t("No se pudo guardar. Intenta de nuevo.")); return; }
    setOn(next); setMsg(next ? t("Listo: te avisaremos de novedades y ofertas.") : t("Listo: ya no te enviaremos publicidad."));
  };
  return (
    <div style={{ margin: "16px 20px 0", background: C.paperDeep, borderRadius: 12, padding: "14px 16px", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{t("Novedades y ofertas")}</div>
          <div style={{ fontSize: 11.5, color: C.stone, lineHeight: 1.5 }}>{t("Por WhatsApp o correo. Los avisos de tus pedidos llegan siempre.")}</div>
        </div>
        {verified && on !== null && (
          <button onClick={change} disabled={busy} aria-pressed={on} aria-label={t("Recibir novedades y ofertas")} style={{ width: 44, height: 24, borderRadius: 999, border: "none", background: on ? C.ink : C.line, position: "relative", cursor: "pointer", flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
            <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: C.paper, transition: "left .15s ease" }} />
          </button>
        )}
      </div>
      {!verified && <div style={{ fontSize: 11.5, color: C.inkSoft, marginTop: 8, lineHeight: 1.5 }}>{t("Para cambiarlo aquí, confirma tu cuenta (Google o código al correo), o escríbenos por WhatsApp.")}</div>}
      {msg && <div style={{ fontSize: 11.5, color: C.ink, marginTop: 8 }}>{msg}</div>}
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
  const phoneValid = phoneIsValid(form.telefono);
  const canSubmit = nameValid && lastNameValid && emailValid && phoneValid && !fileError;

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); setFileError(""); return; }
    const okType = /\.(pdf|doc|docx)$/i.test(f.name);
    if (!okType) { setFile(null); setFileError(t("Solo se aceptan archivos PDF o Word (.pdf, .doc, .docx).")); return; }
    if (f.size > CV_MAX_MB * 1024 * 1024) { setFile(null); setFileError(t("El archivo pesa más de {n} MB — comprímelo o usa un PDF más liviano.", { n: CV_MAX_MB })); return; }
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
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{t("Trabaja con nosotros")}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.stone} /></button>
        </div>

        {sent ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <Check size={30} color={C.ink} style={{ marginBottom: 10 }} />
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, fontWeight: 600, marginBottom: 6 }}>{sendVia === "email" ? t("¡Listo, se abrió tu correo!") : t("¡Listo, se abrió WhatsApp!")}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, lineHeight: 1.6 }}>{file ? <>{t("No olvides")} <strong>{t("adjuntar tu archivo «{f}»", { f: file.name })}</strong> {t(sendVia === "email" ? "manualmente a ese correo antes de enviarlo — no se adjunta solo." : "manualmente en ese chat antes de enviarlo — no se adjunta solo.")}</> : t(sendVia === "email" ? "Envía el mensaje desde tu correo para completar tu postulación." : "Envía el mensaje en WhatsApp para completar tu postulación.")}</div>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, lineHeight: 1.6, marginBottom: 18 }}>{t("Fly es una boutique familiar en Trujillo. Cuéntanos sobre ti — guardamos tu contacto para cuando tengamos una vacante que encaje contigo.")}</div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{t("¿Cómo prefieres enviarla?")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSendVia("whatsapp")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${sendVia === "whatsapp" ? C.ink : C.line}`, background: sendVia === "whatsapp" ? C.ink : "transparent", color: sendVia === "whatsapp" ? C.white : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("WhatsApp")}</button>
                <button onClick={() => setSendVia("email")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${sendVia === "email" ? C.ink : C.line}`, background: sendVia === "email" ? C.ink : "transparent", color: sendVia === "email" ? C.white : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Correo")}</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div><label style={labelStyle}>{t("Nombre")}</label><input style={inputStyle} value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />{touched && !nameValid && <div style={errStyle}>{t("Requerido")}</div>}</div>
              <div><label style={labelStyle}>{t("Apellidos")}</label><input style={inputStyle} value={form.apellidos} onChange={(e) => set("apellidos", e.target.value)} />{touched && !lastNameValid && <div style={errStyle}>{t("Requerido")}</div>}</div>
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>{t("Correo electrónico")}</label><input style={inputStyle} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />{touched && !emailValid && <div style={errStyle}>{t("Correo inválido")}</div>}</div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>{t("Celular")}</label><PhoneInput value={form.telefono} onChange={(v) => set("telefono", v)} />{touched && !phoneValid && <div style={errStyle}>{t("Celular inválido")}</div>}</div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>{t("Puesto de interés")}</label>
              <select style={inputStyle} value={form.puesto} onChange={(e) => set("puesto", e.target.value)}>{JOB_ROLES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select>
            </div>
            <div style={{ marginBottom: 12 }}><label style={labelStyle}>{t("Cuéntanos sobre ti (opcional)")}</label><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={form.mensaje} onChange={(e) => set("mensaje", e.target.value)} /></div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>CV (PDF o Word, máx. {CV_MAX_MB}MB) — opcional</label>
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleFile} style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink }} />
              {fileError && <div style={errStyle}>{fileError}</div>}
              {file && !fileError && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 4 }}>✓ {file.name}</div>}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone, lineHeight: 1.5, marginBottom: 16 }}>{t("Tus datos se usan solo para evaluar tu postulación, según nuestra política de protección de datos.")}</div>
            <PrimaryButton onClick={submit}>{sendVia === "email" ? t("Enviar postulación por correo") : t("Enviar postulación por WhatsApp")}</PrimaryButton>
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
        <button onClick={() => setScreen("home")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 18, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> {t("Volver")}</button>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.ink, fontWeight: 800, margin: "0 0 18px", textAlign: "center" }}>{t("Ayuda e información")}</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 24, paddingBottom: 18, borderBottom: `1px solid ${C.line}` }}>
          {FOOTER_SECTIONS.map((s, i) => (
            <button key={s.title} onClick={() => setActive(i)} style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, color: active === i ? C.white : C.ink, background: active === i ? C.ink : C.paperDeep, border: `1px solid ${active === i ? C.ink : C.line}`, borderRadius: 999, padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap" }}>{t(s.title)}</button>
          ))}
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 12, textAlign: "center" }}>{t(section.title)}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.inkSoft, lineHeight: 1.8, textAlign: "justify" }}>{t(section.body)}</div>
        {section.isJobForm && <div style={{ textAlign: "center" }}><button onClick={() => setShowJobForm(true)} style={{ marginTop: 18, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.white, background: C.ink, border: "none", borderRadius: 8, padding: "12px 18px", cursor: "pointer" }}>{t("Enviar mi postulación")}</button></div>}
        <div style={{ marginTop: 40, fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textAlign: "center" }}>{t("Fly — Av. Larco 126, Trujillo, Perú · @flyboutiqueperu")}</div>
      </div>
      {showJobForm && <JobApplicationForm onClose={() => setShowJobForm(false)} />}
    </div>
  );
};

// 15 días hábiles (lunes a viernes) desde el registro. No descuenta feriados: revisa el calendario.
const addBusinessDays = (ts, n) => { const d = new Date(ts); let added = 0; while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; } return d; };
const COMPLAINT_STATUS = { pendiente: "Pendiente", en_proceso: "En proceso", respondido: "Respondido" };

const ComplaintsScreen = ({ settings, setScreen }) => {
  const company = companyOf(settings);
  const empty = { name: "", docType: "DNI", docNumber: "", address: "", phone: "51", email: "", minor: false, guardian: "", itemType: "producto", amount: "", orderRef: "", itemDesc: "", kind: "reclamo", detail: "", request: "", accept: false };
  const [f, setF] = useState(empty);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState({ code: "", doc: "", result: null, error: "" });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const valid = f.name.trim().length >= 3 && f.docNumber.trim().length >= 6 && f.address.trim().length >= 5 && emailOk && phoneIsValid(f.phone) && f.itemDesc.trim() && f.detail.trim().length >= 10 && f.request.trim() && f.accept && (!f.minor || f.guardian.trim());
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const payload = { ...f, name: f.name.trim(), docNumber: f.docNumber.trim(), email: f.email.trim(), companyName: company.legalName, companyRuc: company.ruc, companyAddress: company.address };
    const { data, error } = await supabase.rpc("submit_complaint", { p: payload });
    setBusy(false);
    if (error || !data) { alert(t("No se pudo registrar tu hoja de reclamación. Revisa tu conexión e intenta de nuevo, o escríbenos al {e}.", { e: company.email })); return; }
    setSent({ ...payload, code: data.code, createdAt: data.createdAt });
  };
  const check = async () => {
    setLookup((l) => ({ ...l, error: "", result: null }));
    const { data, error } = await supabase.rpc("complaint_status", { p_code: lookup.code, p_doc: lookup.doc });
    if (error || !data) { setLookup((l) => ({ ...l, error: t("No encontramos una hoja con ese código y documento.") })); return; }
    setLookup((l) => ({ ...l, result: data }));
  };
  const label = (x) => <div style={{ fontFamily: FONT_BODY, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.stone, margin: "16px 0 8px" }}>{t(x)}</div>;
  const legal = (
    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, lineHeight: 1.6, background: C.paperDeep, borderRadius: 10, padding: "10px 12px", marginTop: 14 }}>
      {t("La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI. El proveedor debe dar respuesta al reclamo o queja en un plazo no mayor a quince (15) días hábiles improrrogables.")}
    </div>
  );
  if (sent) {
    const deadline = addBusinessDays(sent.createdAt, 15);
    const rowS = { display: "flex", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, padding: "4px 0" };
    return (
      <div className="page-narrow" style={{ padding: "18px 20px 30px" }}>
        <div className="print-area" style={{ border: `1px solid ${C.ink}`, borderRadius: 12, padding: "16px 18px" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{t("Hoja de reclamación N.°")} {sent.code}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, margin: "4px 0 12px" }}>{company.legalName}{company.ruc ? ` · RUC ${company.ruc}` : ""} · {company.address}</div>
          <div style={rowS}><strong>{t("Fecha:")}</strong> {new Date(sent.createdAt).toLocaleString("es-PE")}</div>
          <div style={rowS}><strong>{t("Consumidor:")}</strong> {sent.name} ({sent.docType} {sent.docNumber})</div>
          <div style={rowS}><strong>{t("Domicilio:")}</strong> {sent.address}</div>
          <div style={rowS}><strong>{t("Contacto:")}</strong> +{sent.phone} · {sent.email}</div>
          {sent.minor && <div style={rowS}><strong>{t("Padre/madre o apoderado:")}</strong> {sent.guardian}</div>}
          <div style={rowS}><strong>{t("Bien contratado:")}</strong> {sent.itemType === "producto" ? t("Producto") : t("Servicio")}{sent.amount ? ` · ${t("Monto")}: S/ ${sent.amount}` : ""}{sent.orderRef ? ` · ${t("Pedido")}: ${sent.orderRef}` : ""}</div>
          <div style={rowS}><strong>{t("Descripción:")}</strong> {sent.itemDesc}</div>
          <div style={rowS}><strong>{t("Tipo:")}</strong> {sent.kind === "reclamo" ? "Reclamo" : "Queja"}</div>
          <div style={rowS}><strong>{t("Detalle:")}</strong> {sent.detail}</div>
          <div style={rowS}><strong>{t("Pedido del consumidor:")}</strong> {sent.request}</div>
          <div style={{ ...rowS, marginTop: 6 }}><strong>{t("Fecha límite de respuesta:")}</strong> {deadline.toLocaleDateString("es-PE")}</div>
          {legal}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, lineHeight: 1.6, margin: "12px 0" }}>{t("Guarda esta hoja: con el código")} <strong>{sent.code}</strong> {t("y tu número de documento puedes consultar el estado aquí mismo. Te responderemos al correo")} {sent.email}.</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => window.print()} style={{ flex: 1, padding: "13px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Imprimir o guardar PDF")}</button>
          <button onClick={() => { setSent(null); setF(empty); setScreen("home"); }} style={{ flex: 1, padding: "13px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Volver a la tienda")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="page-narrow" style={{ padding: "18px 20px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}><BookOpen size={22} color={C.ink} /><h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink, margin: 0 }}>{t("Libro de Reclamaciones")}</h1></div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, lineHeight: 1.6 }}>{t("Conforme al Código de Protección y Defensa del Consumidor, contamos con un Libro de Reclamaciones virtual a tu disposición.")}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 6 }}>{company.legalName}{company.ruc ? ` · RUC ${company.ruc}` : ""} · {company.address} {t("· Fecha:")} {new Date().toLocaleDateString("es-PE")}</div>

      {label(t("1. Identificación del consumidor"))}
      <input style={{ ...inputStyle, marginBottom: 8 }} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("Nombres y apellidos")} />
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select value={f.docType} onChange={(e) => set("docType", e.target.value)} style={{ ...inputStyle, width: 120 }}>{["DNI", "CE", "Pasaporte", "RUC"].map((d) => <option key={d}>{d}</option>)}</select>
        <input style={{ ...inputStyle, flex: 1 }} value={f.docNumber} onChange={(e) => set("docNumber", e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 12))} placeholder={t("Número de documento")} />
      </div>
      <input style={{ ...inputStyle, marginBottom: 8 }} value={f.address} onChange={(e) => set("address", e.target.value)} placeholder={t("Domicilio")} />
      <PhoneInput value={f.phone} onChange={(v) => set("phone", v)} placeholder={t("Teléfono")} style={{ marginBottom: 8 }} />
      <input style={{ ...inputStyle, marginBottom: 8 }} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder={t("Correo electrónico (aquí te responderemos)")} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 8 }}><input type="checkbox" checked={f.minor} onChange={(e) => set("minor", e.target.checked)} /> {t("Soy menor de edad")}</label>
      {f.minor && <input style={{ ...inputStyle, marginBottom: 8 }} value={f.guardian} onChange={(e) => set("guardian", e.target.value)} placeholder={t("Nombre del padre, madre o apoderado")} />}

      {label(t("2. Identificación del bien contratado"))}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <Chip active={f.itemType === "producto"} onClick={() => set("itemType", "producto")}>{t("Producto")}</Chip>
        <Chip active={f.itemType === "servicio"} onClick={() => set("itemType", "servicio")}>{t("Servicio")}</Chip>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^0-9.]/g, "").slice(0, 9))} placeholder={t("Monto reclamado (S/)")} />
        <input style={{ ...inputStyle, flex: 1 }} value={f.orderRef} onChange={(e) => set("orderRef", e.target.value.slice(0, 30))} placeholder={t("N.° de pedido o boleta (opcional)")} />
      </div>
      <input style={{ ...inputStyle, marginBottom: 8 }} value={f.itemDesc} onChange={(e) => set("itemDesc", e.target.value)} placeholder={t("Descripción del producto o servicio")} />

      {label(t("3. Detalle de la reclamación y pedido"))}
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <Chip active={f.kind === "reclamo"} onClick={() => set("kind", "reclamo")}>{t("Reclamo")}</Chip>
        <Chip active={f.kind === "queja"} onClick={() => set("kind", "queja")}>{t("Queja")}</Chip>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, lineHeight: 1.5, marginBottom: 8 }}><strong>{t("Reclamo:")}</strong> {t("disconformidad con los productos o servicios.")} <strong>{t("Queja:")}</strong> {t("malestar con la atención, no relacionado con el producto.")}</div>
      <textarea style={{ ...inputStyle, minHeight: 90, marginBottom: 8, resize: "vertical" }} value={f.detail} onChange={(e) => set("detail", e.target.value.slice(0, 2000))} placeholder={t("Cuéntanos qué pasó")} />
      <textarea style={{ ...inputStyle, minHeight: 60, marginBottom: 8, resize: "vertical" }} value={f.request} onChange={(e) => set("request", e.target.value.slice(0, 1000))} placeholder={t("¿Qué solicitas? (cambio, devolución, otro)")} />
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.5, margin: "6px 0" }}><input type="checkbox" checked={f.accept} onChange={(e) => set("accept", e.target.checked)} style={{ marginTop: 3 }} /> {t("Declaro que los datos son verdaderos y acepto que se usen solo para atender esta hoja, según la Política de privacidad.")}</label>
      {legal}
      <div style={{ marginTop: 14 }}><PrimaryButton disabled={!valid || busy} onClick={submit}>{busy ? t("Registrando…") : t("Enviar hoja de reclamación")}</PrimaryButton></div>
      <Faltan tr={t} items={[f.name.trim().length < 3 && "escribe tu nombre completo", f.docNumber.trim().length < 6 && "escribe tu número de documento", f.address.trim().length < 5 && "escribe tu domicilio", !emailOk && "escribe un correo válido", !phoneIsValid(f.phone) && "escribe un teléfono válido", f.minor && !f.guardian.trim() && "escribe el nombre del padre, madre o apoderado", !f.itemDesc.trim() && "describe el producto o servicio", f.detail.trim().length < 10 && "cuenta qué pasó (al menos 10 letras)", !f.request.trim() && "escribe qué solicitas", !f.accept && "marca la declaración de datos verdaderos"]} />

      {label(t("Consultar una hoja ya registrada"))}
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} value={lookup.code} onChange={(e) => setLookup({ ...lookup, code: e.target.value })} placeholder={t("Código (LR-2026-000001)")} />
        <input style={{ ...inputStyle, flex: 1 }} value={lookup.doc} onChange={(e) => setLookup({ ...lookup, doc: e.target.value })} placeholder={t("N.° de documento")} />
        <button onClick={check} style={{ padding: "0 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("Ver")}</button>
      </div>
      {lookup.error && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginTop: 8 }}>{lookup.error}</div>}
      {lookup.result && (
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginTop: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
          <div><strong>{lookup.result.code}</strong> · {t(COMPLAINT_STATUS[lookup.result.status] || lookup.result.status)}</div>
          {lookup.result.response && <div style={{ marginTop: 6 }}><strong>{t("Respuesta:")}</strong> {lookup.result.response}</div>}
        </div>
      )}
    </div>
  );
};

const TRACK_STEPS = [["pendiente", "Pedido recibido"], ["preparando", "Preparando"], ["listo", "Listo"], ["enviado", "En camino"], ["entregado", "Entregado"]];
const TrackOrderScreen = ({ settings, setScreen, initialCode = "" }) => {
  const [code, setCode] = useState(initialCode);
  const [phone, setPhone] = useState("51");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true); setErr(""); setRes(null);
    const { data, error } = await supabase.rpc("track_order", { p_code: code.trim().toUpperCase(), p_phone: phone });
    setBusy(false);
    if (error || !data) { setErr(t("No encontramos ese pedido. Revisa el número (ej. B001-000123) y el celular con el que compraste.")); return; }
    setRes(data);
  };
  const stepIdx = res ? Math.max(0, TRACK_STEPS.findIndex(([k]) => k === (res.fulfillment || "pendiente"))) : 0;
  const trackUrl = res?.trackingAgency && settings?.trackingUrls?.[res.trackingAgency];
  return (
    <div className="page-narrow" style={{ padding: "18px 20px 30px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 23, fontWeight: 800, color: C.ink, margin: "0 0 6px" }}>{t("Rastrea tu pedido")}</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 14 }}>{t("Escribe el número de tu pedido (te llegó por WhatsApp, ej. B001-000123) y tu celular.")}</div>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t("Número de pedido")} style={{ ...inputStyle, marginBottom: 8, fontSize: 15 }} />
      <PhoneInput value={phone} onChange={setPhone} style={{ marginBottom: 10 }} />
      <PrimaryButton disabled={busy || code.trim().length < 6 || !phoneIsValid(phone)} onClick={search}>{busy ? t("Buscando…") : t("Ver estado")}</PrimaryButton>
      <Faltan tr={t} items={[code.trim().length < 6 && "escribe el número de pedido", !phoneIsValid(phone) && "escribe el celular con el que compraste"]} />
      {err && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.accent, marginTop: 10 }}>{err}</div>}
      {res && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px", marginTop: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, color: C.ink }}>{t("Pedido")} {res.serie}-{String(res.numero).padStart(6, "0")}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 14 }}>{new Date(res.createdAt).toLocaleDateString("es-PE")} · {money(res.total)} · {res.paymentStatus === "confirmado" ? t("Pago confirmado") : t("Pago por confirmar")}</div>
          {TRACK_STEPS.filter(([k]) => res.deliveryMethod === "recojo" ? k !== "enviado" : true).map(([k, label], i) => {
            const idx = TRACK_STEPS.findIndex(([kk]) => kk === k); const done = idx <= stepIdx;
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${done ? C.ink : C.line}`, background: done ? C.ink : "transparent", color: C.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{done ? "✓" : ""}</span>
                <span style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: done ? C.ink : C.stone, fontWeight: idx === stepIdx ? 700 : 400 }}>{k === "listo" && res.deliveryMethod === "recojo" ? t("Listo para recoger en tienda") : t(label)}</span>
              </div>
            );
          })}
          {res.trackingNumber && (
            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginTop: 12, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
              {t("Enviado por")} <strong>{res.trackingAgency}</strong>{t(". N.° de seguimiento:")} <strong>{res.trackingNumber}</strong>
              <button onClick={() => { try { navigator.clipboard.writeText(res.trackingNumber); } catch (e) { /* nada */ } }} style={{ marginLeft: 8, background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12 }}>{t("Copiar")}</button>
              {trackUrl ? <div><a href={trackUrl} target="_blank" rel="noreferrer" style={{ color: C.ink, fontWeight: 600 }}>{t("Rastrear en la web de")} {res.trackingAgency}</a></div> : <div style={{ color: C.stone }}>{t("Ingresa este número en la web o app de")} {res.trackingAgency} {t("para ver dónde está tu paquete.")}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const InfoFooter = ({ onOpenInfo, onCookiePrefs, onComplaints, onTrack, socials }) => (
  <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 20, padding: "18px 0 22px" }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 10, padding: "0 20px" }}>{t("Ayuda e información")}</div>
    <div className="hscroll" style={{ display: "flex", gap: 16, overflowX: "auto", padding: "0 20px", scrollbarWidth: "none" }}>
      {FOOTER_SECTIONS.map((s, i) => (
        <button key={s.title} onClick={() => onOpenInfo(i)} style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, fontWeight: 500, background: "none", border: "none", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", whiteSpace: "nowrap", padding: "4px 2px" }}>{t(s.title)}</button>
      ))}
    </div>
    {onComplaints && (
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        {onTrack && <button onClick={onTrack} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer" }}><Package size={15} /> {t("Rastrea tu pedido")}</button>}
        <button onClick={onComplaints} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer" }}><BookOpen size={15} /> {t("Libro de Reclamaciones")}</button>
      </div>
    )}
    <SocialLinks socials={socials} />
    <div style={{ marginTop: 12, fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textAlign: "center", padding: "0 20px" }}>
      Fly Boutique, Trujillo, Perú
      {onCookiePrefs && <> · <button onClick={onCookiePrefs} style={{ background: "none", border: "none", padding: 0, fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, textDecoration: "underline", cursor: "pointer" }}>{t("Preferencias de cookies")}</button></>}
    </div>
  </div>
);

const PolicyModal = ({ onClose }) => (
  <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
    <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 30px", maxHeight: "80%", overflowY: "auto", animation: "slideUp .25s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, color: C.ink }}>{t("Cambios y devoluciones")}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.ink} /></button>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.8 }}>
        <p>{t("Tienes")} <strong>{t("7 días calendario")}</strong> {t("desde que recibes tu pedido para solicitar un cambio de talla o color, siempre que la prenda esté sin uso, con etiquetas y en su empaque original.")}</p>
        <p>{t("Para iniciar un cambio o devolución, escríbenos por WhatsApp con tu número de pedido y el motivo — coordinamos la recogida o el punto de entrega en Trujillo.")}</p>
        <p>{t("Las prendas en oferta final o los accesorios en aretes no tienen cambio por temas de higiene, salvo defecto de fábrica.")}</p>
        <p>{t("Si la prenda llega con algún defecto, el cambio o la devolución del dinero no tiene costo para ti.")}</p>
      </div>
    </div>
  </div>
);

const DEFAULT_SOCIALS = { instagram: "https://instagram.com/flyboutiqueperu", facebook: "https://facebook.com/flyboutiqueperu", tiktok: "https://tiktok.com/@flyboutiqueperu", youtube: "", whatsapp: "https://wa.me/51978687704" };
const SOCIAL_ICONS = {
  instagram: <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="5" stroke="#000" strokeWidth="1.6" /><circle cx="12" cy="12" r="4" stroke="#000" strokeWidth="1.6" /><circle cx="17.3" cy="6.7" r="1.1" fill="#000" /></svg>,
  facebook: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 4h-2.5C10.6 4 9 5.6 9 7.5V10H6.5v3.5H9V20h3.5v-6.5h2.7l.5-3.5h-3.2V7.8c0-.7.4-1.1 1.1-1.1H15V4z" fill="#000" /></svg>,
  tiktok: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M16 3c.4 2 1.8 3.4 4 3.6v3c-1.5 0-2.9-.4-4-1.2v6.3c0 3.3-2.7 5.9-6 5.5-2.6-.3-4.7-2.4-5-5-.4-3.3 2.2-6.1 5.4-6.1.4 0 .8 0 1.1.1v3.1c-.3-.1-.7-.2-1.1-.2-1.6 0-2.8 1.4-2.5 3 .2 1.1 1.1 2 2.2 2.1 1.5.2 2.8-1 2.8-2.5V3h3.1z" fill="#000" /></svg>,
  youtube: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5.5" width="19" height="13" rx="4" stroke="#000" strokeWidth="1.6" /><path d="M10 9l5 3-5 3V9z" fill="#000" /></svg>,
  whatsapp: <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" stroke="#000" strokeWidth="1.6" /><path d="M9 8.5c.2-.5.5-.5.7-.5h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.2.3 0 .5.5.9 1.3 1.7 2.2 2.2.2.1.4.1.5-.1l.6-.6c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5 0 .6-.3 1.3-.9 1.6-.6.3-1.4.4-2.6-.1-1.5-.6-3.4-2.3-4.1-3.9-.6-1.2-.4-2.6.1-3.5z" fill="#000" /></svg>,
};
const SocialLinks = ({ socials }) => {
  const links = { ...DEFAULT_SOCIALS, ...(socials || {}) };
  const iconStyle = { width: 38, height: 38, borderRadius: "50%", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 18 }}>
      {Object.keys(SOCIAL_ICONS).filter((k) => links[k]).map((k) => <a key={k} href={links[k]} target="_blank" rel="noreferrer" aria-label={k} style={iconStyle}>{SOCIAL_ICONS[k]}</a>)}
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
      sc.onerror = () => { turnstileScript = null; reject(new Error(t("No se pudo cargar el captcha"))); };
      document.head.appendChild(sc);
    });
  }
  return turnstileScript;
};
// Llave PÚBLICA del widget de Cloudflare Turnstile (va en el navegador; no es secreta).
// Se usa si en Panel → Configuración no se puso otra. La clave SECRETA vive solo en Supabase (app_secrets).
const TURNSTILE_SITE_KEY = "0x4AAAAAAFUXHjfYE0JKDuvg";

const TurnstileBox = ({ siteKey, onToken }) => {
  const boxRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let id = null; let alive = true;
    // Con señal débil puede tardar: a los 12 s se ofrece «Reintentar» (sin quitar la verificación: el servidor la exige)
    const slowTimer = setTimeout(() => { if (alive && id === null) setSlow(true); }, 12000);
    loadTurnstile().then((ts) => {
      if (!alive || !boxRef.current) return;
      id = ts.render(boxRef.current, {
        sitekey: siteKey, theme: "light", language: "es",
        callback: (tk) => { setSlow(false); onToken(tk); }, "expired-callback": () => onToken(""), "error-callback": () => { onToken(""); setFailed(true); },
      });
    }).catch(() => setFailed(true));
    return () => { alive = false; clearTimeout(slowTimer); try { if (id !== null && window.turnstile) window.turnstile.remove(id); } catch (e) { /* ya removido */ } };
  }, [siteKey, attempt]);
  const retry = () => { setFailed(false); setSlow(false); onToken(""); setAttempt((n) => n + 1); };
  const retryBtn = <button type="button" className="captcha-retry" onClick={retry} style={{ marginTop: 8, padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.ink}`, background: C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Reintentar")}</button>;
  if (failed) return (
    <div style={{ textAlign: "center", marginTop: 10 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.accent }}>{t("No se pudo cargar la verificación. Revisa tu conexión.")}</div>
      {retryBtn}
    </div>
  );
  return (
    <>
      <div key={attempt} ref={boxRef} style={{ display: "flex", justifyContent: "center", marginTop: 12, minHeight: 66 }} />
      {slow && <div style={{ textAlign: "center" }}><div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>{t("La verificación está tardando (señal débil).")}</div>{retryBtn}</div>}
    </>
  );
};

// Entrar con correo + contraseña (solo sirve si la clienta la creó estando dentro con código o Google)
const CLUB_PASS_LOCK_KEY = "flyboutique:club-intentos:v1";
const PasswordLogin = ({ onForgot }) => {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const login = async () => {
    if (busy) return;
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setMsg(t("Escribe tu correo completo.")); return; }
    if (!pass) { setMsg(t("Falta la contraseña.")); return; }
    if (em.endsWith("@" + STAFF_EMAIL_DOMAIN)) { setMsg(t("Las cuentas del equipo entran por el panel del staff.")); return; }
    let lock = {}; try { lock = JSON.parse(localStorage.getItem(CLUB_PASS_LOCK_KEY) || "{}"); } catch (e) { /* nada */ }
    if (lock.until > Date.now()) { setMsg(t("Demasiados intentos. Espera {n} min o entra con código.", { n: Math.ceil((lock.until - Date.now()) / 60000) })); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pass });
    setBusy(false);
    if (error) {
      const n = (lock.n || 0) + 1;
      try { localStorage.setItem(CLUB_PASS_LOCK_KEY, JSON.stringify(n >= 5 ? { n: 0, until: Date.now() + 15 * 60000 } : { n })); } catch (e) { /* nada */ }
      setMsg(n >= 5 ? t("Demasiados intentos. Espera 15 min o entra con código.") : t("Correo o contraseña incorrectos (te quedan {n} intentos). Si nunca creaste contraseña, entra con código.", { n: 5 - n }));
      return;
    }
    try { localStorage.removeItem(CLUB_PASS_LOCK_KEY); } catch (e) { /* nada */ }
    setPass("");
  };
  const btn = { width: "100%", padding: "12px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" };
  return (
    <div style={{ textAlign: "left" }}>
      <input value={email} onChange={(e) => { setEmail(e.target.value); setMsg(""); }} placeholder={t("Tu correo *")} type="email" autoComplete="email" style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ position: "relative", marginBottom: 8 }}>
        <input value={pass} onChange={(e) => { setPass(e.target.value); setMsg(""); }} onKeyDown={(e) => e.key === "Enter" && login()} placeholder={t("Contraseña *")} type={show ? "text" : "password"} autoComplete="current-password" style={{ ...inputStyle, paddingRight: 44 }} />
        <button type="button" aria-label={show ? t("Ocultar contraseña") : t("Ver contraseña")} onClick={() => setShow((x) => !x)} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex" }}><Eye size={16} color={C.stone} /></button>
      </div>
      <button onClick={login} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy ? t("Entrando…") : t("Entrar")}</button>
      <button onClick={onForgot} style={{ background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, textDecoration: "underline", cursor: "pointer", marginTop: 8, padding: 0 }}>{t("¿Olvidaste tu contraseña? Entra con código y crea una nueva")}</button>
      {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.accent, marginTop: 8 }}>{msg}</div>}
    </div>
  );
};

// Crear o cambiar la contraseña (solo estando dentro con código, Google o con la contraseña ya creada)
const ClubPasswordBox = () => {
  const [open, setOpen] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const save = async () => {
    if (p1.length < 8) { setMsg({ ok: false, t: t("Mínimo 8 caracteres.") }); return; }
    if (p1 !== p2) { setMsg({ ok: false, t: t("Las dos contraseñas no coinciden.") }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) { setBusy(false); setMsg({ ok: false, t: /different|same/i.test(error.message) ? t("Es igual a la anterior: elige otra.") : /weak|short|characters/i.test(error.message) ? t("Muy débil: usa letras y números.") : t("No se pudo guardar. Intenta de nuevo.") }); return; }
    const { error: e2 } = await supabase.rpc("mark_customer_password");
    setBusy(false);
    // Si entró con contraseña, ya estaba registrada: el cambio vale igual
    if (e2 && !/SOLO_VERIFICADA/.test(e2.message || "")) { setMsg({ ok: false, t: t("Se guardó, pero falta activarla. Vuelve a intentar más tarde.") }); return; }
    setP1(""); setP2(""); setOpen(false);
    setMsg({ ok: true, t: t("Listo. La próxima vez puedes entrar con tu correo y esta contraseña.") });
  };
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 18, paddingTop: 14 }}>
      {!open ? (
        <button onClick={() => { setOpen(true); setMsg(null); }} style={{ background: "none", border: "none", padding: 0, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline", cursor: "pointer" }}>{t("Crear o cambiar mi contraseña")}</button>
      ) : (
        <div style={{ maxWidth: 320 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>{t("Para entrar la próxima vez con tu correo y contraseña (también puedes seguir usando el código).")}</div>
          <input value={p1} onChange={(e) => setP1(e.target.value)} type="password" autoComplete="new-password" placeholder={t("Nueva contraseña (mín. 8) *")} style={{ ...inputStyle, marginBottom: 8 }} />
          <input value={p2} onChange={(e) => setP2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} type="password" autoComplete="new-password" placeholder={t("Repite la contraseña *")} style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setOpen(false)} style={{ flex: 1, padding: "11px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer", color: C.ink }}>{t("Cancelar")}</button>
            <button onClick={save} disabled={busy} style={{ flex: 2, padding: "11px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? t("Guardando…") : t("Guardar contraseña")}</button>
          </div>
        </div>
      )}
      {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: msg.ok ? C.ink : C.accent, marginTop: 8 }}>{msg.t}</div>}
    </div>
  );
};

// Entrar con un código de 6 dígitos que llega al correo (sin contraseñas que olvidar).
const EmailCodeLogin = () => {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const send = async () => {
    if (!emailOk || busy) { setMsg(t("Escribe tu correo completo (ej. nombre@gmail.com).")); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) { setMsg(/rate|seconds|security purposes/i.test(error.message) ? t("Ya te enviamos un código hace poco. Espera un minuto y vuelve a intentar.") : t("No pudimos enviar el código. Revisa el correo e intenta de nuevo.")); return; }
    setStep("code"); setMsg("");
  };
  const verify = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    setBusy(false);
    if (error) { setMsg(t("Código incorrecto o vencido. Revisa el último correo o pide uno nuevo.")); setCode(""); }
    // si salió bien, la tienda detecta la sesión sola y carga tu cuenta y tus puntos
  };
  const btn = { width: "100%", padding: "12px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" };
  return (
    <div style={{ textAlign: "left" }}>
      {step === "email" ? (
        <>
          <input value={email} onChange={(e) => { setEmail(e.target.value); setMsg(""); }} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t("Tu correo *")} type="email" autoComplete="email" style={{ ...inputStyle, marginBottom: 8 }} />
          <button onClick={send} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy ? t("Enviando…") : t("Recibir código en mi correo")}</button>
        </>
      ) : (
        <>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, marginBottom: 8, lineHeight: 1.45 }}>{t("Te enviamos un código de 6 dígitos a")} <strong>{email.trim()}</strong>{t(". Revisa también «Spam» o «Promociones».")}</div>
          <input value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setMsg(""); }} onKeyDown={(e) => e.key === "Enter" && verify()} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" style={{ ...inputStyle, textAlign: "center", letterSpacing: "0.35em", fontSize: 20, marginBottom: 8 }} />
          <button onClick={verify} disabled={busy || code.length !== 6} style={{ ...btn, opacity: busy || code.length !== 6 ? 0.5 : 1 }}>{busy ? t("Verificando…") : t("Entrar")}</button>
          <button onClick={() => { setStep("email"); setCode(""); }} style={{ background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, textDecoration: "underline", cursor: "pointer", marginTop: 8 }}>{t("Cambiar correo o pedir otro código")}</button>
        </>
      )}
      {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.accent, marginTop: 8 }}>{msg}</div>}
    </div>
  );
};

// Para una cuenta creada solo con datos: confirmar que es suya (Google o código al correo)
// y así poder usar los puntos en la web y ver sus pedidos.
const VerifyAccountBox = ({ onGoogleSignIn }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.paperDeep, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink, lineHeight: 1.5 }}>
        <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />{t("Confirma que esta cuenta es tuya para")} <strong>{t("usar tus puntos en la web")}</strong> {t("y")} <strong>{t("ver tus pedidos")}</strong>.
        {!open && <button onClick={() => setOpen(true)} style={{ background: "none", border: "none", padding: 0, marginLeft: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "underline", cursor: "pointer", fontWeight: 600 }}>{t("Confirmar")}</button>}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {onGoogleSignIn && <button onClick={onGoogleSignIn} style={{ width: "100%", padding: "11px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.white, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>{t("Con Google")}</button>}
          <EmailCodeLogin />
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginTop: 8 }}>{t("Usa el mismo correo que diste al registrarte.")}</div>
        </div>
      )}
    </div>
  );
};

const ClubFlySignup = ({ onRegister, onGoogleSignIn, googlePrefill, turnstileSiteKey }) => {
  const [tab, setTab] = useState("crear");
  const [loginWay, setLoginWay] = useState("codigo");
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
  const [marketing, setMarketing] = useState(false);

  useEffect(() => { setHumanA(Math.ceil(Math.random() * 6) + 1); setHumanB(Math.ceil(Math.random() * 6) + 1); }, []);
  useEffect(() => { if (googlePrefill) { setName(googlePrefill.name || ""); setEmail(googlePrefill.email || ""); } }, [googlePrefill]);

  const nameValid = name.trim().length >= 3;
  const phoneValid = phoneIsValid(phone);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const humanValid = turnstileSiteKey ? !!captchaToken : Number(humanAnswer) === humanA + humanB;
  const canSubmit = nameValid && phoneValid && emailValid && humanValid;

  const fieldError = (ok, msg) => (touched && !ok ? <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.accent, marginTop: -6, marginBottom: 8, textAlign: "left" }}>{msg}</div> : null);

  return (
    <div style={{ padding: "22px 20px 24px", textAlign: "center" }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink, margin: "0 0 6px" }}>{tab === "entrar" && !googlePrefill ? t("Entra a tu cuenta") : t("Únete al Club Fly")}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 16, maxWidth: 260, marginLeft: "auto", marginRight: "auto" }}>{tab === "entrar" && !googlePrefill ? t("Mira tus puntos y tus pedidos desde cualquier celular o computadora.") : t("Regístrate gratis y empieza a ganar puntos en cada compra.")}</div>
      {!googlePrefill && (
        <div role="tablist" style={{ display: "flex", maxWidth: 280, margin: "0 auto 18px", border: `1px solid ${C.ink}`, borderRadius: 999, padding: 3 }}>
          {[["entrar", t("Ya tengo cuenta")], ["crear", t("Crear cuenta")]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ flex: 1, padding: "9px 6px", borderRadius: 999, border: "none", background: tab === k ? C.ink : "transparent", color: tab === k ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      )}
      {tab === "entrar" && !googlePrefill ? (
        <div style={{ maxWidth: 280, margin: "0 auto" }}>
          {onGoogleSignIn && <button onClick={onGoogleSignIn} style={{ width: "100%", padding: "12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.white, color: C.ink, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("Entrar con Google")}</button>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
            <div style={{ flex: 1, height: 1, background: C.line }} /><span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{t("o con tu correo")}</span><div style={{ flex: 1, height: 1, background: C.line }} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 10 }}>
            {[["codigo", t("Con código")], ["clave", t("Con contraseña")]].map(([k, l]) => (
              <button key={k} onClick={() => setLoginWay(k)} style={{ background: "none", border: "none", borderBottom: `2px solid ${loginWay === k ? C.ink : "transparent"}`, padding: "4px 2px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: loginWay === k ? 700 : 400, color: loginWay === k ? C.ink : C.stone, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          {loginWay === "codigo" ? <EmailCodeLogin /> : <PasswordLogin onForgot={() => setLoginWay("codigo")} />}
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 14, lineHeight: 1.5 }}>{t("Usa el mismo correo con el que te registraste. ¿Aún no tienes cuenta?")} <button onClick={() => setTab("crear")} style={{ background: "none", border: "none", padding: 0, fontFamily: FONT_BODY, fontSize: 11, color: C.ink, textDecoration: "underline", cursor: "pointer" }}>{t("Créala aquí")}</button>.</div>
        </div>
      ) : (<>

      {onGoogleSignIn && !googlePrefill && (
        <div style={{ maxWidth: 280, margin: "0 auto 18px" }}>
          <button onClick={onGoogleSignIn} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.white, color: C.ink, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 5.1 29.6 3 24 3c-7.4 0-13.8 4.1-17.1 10.1z"/><path fill="#4CAF50" d="M24 45c5.5 0 10.4-1.9 14.3-5.2l-6.6-5.6C29.5 35.9 26.9 37 24 37c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 40.6 16.4 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.4l6.6 5.6C40.5 36.9 44 31.3 44 24c0-1.4-.1-2.4-.4-3.5z"/></svg>
            {t("Continuar con Google")}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
            <div style={{ flex: 1, height: 1, background: C.line }} /><span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{t("o con tus datos")}</span><div style={{ flex: 1, height: 1, background: C.line }} />
          </div>
        </div>
      )}
      {googlePrefill && (
        <div style={{ maxWidth: 280, margin: "0 auto 18px", background: C.paperDeep, borderRadius: 10, padding: "12px 14px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink }}>
          ✓ Sesión conectada — solo falta tu celular para terminar.
        </div>
      )}

      <div style={{ textAlign: "left", maxWidth: 280, margin: "0 auto" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nombre completo *")} style={{ ...inputStyle, marginBottom: 6 }} />
        {fieldError(nameValid, t("Escribe tu nombre completo (mínimo 3 letras)."))}

        <PhoneInput value={phone} onChange={setPhone} placeholder={t("Celular (WhatsApp) *")} style={{ marginTop: 8, marginBottom: 6 }} />
        {fieldError(phoneValid, t("Ingresa un número de celular válido."))}

        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("Correo *")} type="email" autoComplete="email" style={{ ...inputStyle, marginTop: 8, marginBottom: 6 }} />
        {fieldError(emailValid, t("Ingresa tu correo (ej. nombre@gmail.com)."))}

        {turnstileSiteKey ? (
          <>
            <TurnstileBox key={captchaKey} siteKey={turnstileSiteKey} onToken={setCaptchaToken} />
            {fieldError(humanValid, t("Espera a que se complete la verificación de arriba."))}
          </>
        ) : (
          <>
            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "12px 14px", marginTop: 10, marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, whiteSpace: "nowrap" }}>{t("Para confirmar que no eres un robot:")} {humanA} + {humanB} =</span>
              <input value={humanAnswer} onChange={(e) => setHumanAnswer(e.target.value)} style={{ ...inputStyle, width: 56, padding: "6px 8px", textAlign: "center" }} />
            </div>
            {fieldError(humanValid, t("La suma no es correcta, intenta de nuevo."))}
          </>
        )}

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.5, marginTop: 12 }}>
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{t("Quiero recibir novedades y ofertas del Club Fly por WhatsApp o correo (opcional). Me puedo dar de baja cuando quiera.")}</span>
        </label>
        <div style={{ marginTop: 16 }}>
          <PrimaryButton disabled={sending} onClick={async () => {
            setTouched(true);
            if (!(nameValid && phoneValid && emailValid && humanValid) || sending) return;
            setSending(true);
            const ok = await onRegister({ name: name.trim(), phone: phone.trim(), email: email.trim(), captcha: captchaToken, marketing });
            setSending(false);
            // El código del captcha sirve una sola vez: si algo falló, se pide uno nuevo
            if (!ok) { setCaptchaToken(""); setCaptchaKey((k) => k + 1); }
          }}>{sending ? t("Registrando…") : t("Registrarme")}</PrimaryButton>
        </div>
      </div>
      </>)}
      <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone, marginTop: 16, maxWidth: 260, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
        {t("Tus datos solo se usan para tu cuenta del Club Fly y tus pedidos. Nunca los compartimos.")}
      </div>
    </div>
  );
};

const ORDER_STATUS_LABELS = { pendiente: "Pendiente", preparando: "Preparando", listo: "Listo", entregado: "Entregado / Enviado" };

const OrdersScreen = ({ catalog, clubMember, setScreen }) => {
  const [fetched, setFetched] = useState(null);
  // Por privacidad, el historial solo se muestra a quien entró con Google (lo revisa también el servidor)
  useEffect(() => {
    if (!clubMember?.google) return;
    supabase.rpc("my_orders", { p_phone: clubMember.phone || "" }).then(({ data }) => setFetched(data || [])).catch(() => setFetched([]));
  }, [clubMember?.phone, clubMember?.google]);
  const backBtn = (
    <button onClick={() => setScreen("profile")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> {t("Volver")}</button>
  );
  if (!clubMember) {
    return (
      <div style={{ padding: "18px 20px 24px" }}>
        {backBtn}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, textAlign: "center" }}>
          <Package size={30} color={C.line} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, maxWidth: 240 }}>{t("Regístrate en el Club Fly para ver tu historial de pedidos aquí.")}</div>
        </div>
      </div>
    );
  }
  if (!clubMember.google) {
    return (
      <div style={{ padding: "18px 20px 24px" }}>
        {backBtn}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, textAlign: "center", gap: 12 }}>
          <Package size={30} color={C.line} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, maxWidth: 270, lineHeight: 1.6 }}>{t("Para proteger tus datos, el historial de pedidos se ve confirmando tu cuenta en Club Fly (con Google o con un código a tu correo). También puedes seguir cualquier pedido con su número.")}</div>
          <button onClick={() => setScreen("track")} style={{ padding: "11px 20px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Seguir mi pedido")}</button>
        </div>
      </div>
    );
  }
  const orders = fetched || [];
  return (
    <div style={{ padding: "18px 20px 24px" }}>
      {backBtn}
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 25, color: C.ink, fontWeight: 800, margin: "0 0 18px" }}>{t("Mis Pedidos")}</h1>
      {fetched === null ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, padding: "30px 0", textAlign: "center" }}>{t("Cargando tus pedidos…")}</div>
      ) : orders.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280, textAlign: "center" }}>
          <Package size={30} color={C.line} style={{ marginBottom: 14 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, maxWidth: 240 }}>{t("Aún no tienes pedidos. Cuando compres algo, lo vas a ver aquí.")}</div>
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
                  {o.items.map((it, i) => <div key={i} style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink, marginBottom: 3 }}>• {it.name} — {it.size}/{t(it.colorName)} × {it.qty}</div>)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, fontWeight: 700, background: validated ? C.paperDeep : "transparent", color: C.ink, border: `1px solid ${validated ? C.paperDeep : C.ink}` }}>
                    {validated ? t("Pago confirmado") : t("Validando pago")}
                  </span>
                  {validated && (
                    <span style={{ fontFamily: FONT_BODY, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, fontWeight: 700, background: C.ink, color: C.paper }}>
                      {t(ORDER_STATUS_LABELS[o.fulfillment] || "Pendiente")}
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

const SubHeader = ({ title, onBack, children }) => (
  <div style={{ padding: "18px 20px 6px" }}>
    <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 12, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, padding: 0 }}><ArrowLeft size={15} /> {t("Mi cuenta")}</button>
    <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 23, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>{tt(title)}</h1>
    {children}
  </div>
);

const FavoritesScreen = ({ catalog, favs, onOpen, onToggleFav, onQuickAdd, cartSessionId, setScreen }) => {
  const list = catalog.products.filter((p) => favs.has(p.id) && webVisible(p));
  return (
    <div className="page-narrow" style={{ paddingBottom: 20 }}>
      <SubHeader title={`${t("Mis favoritos")} (${list.length})`} onBack={() => setScreen("profile")}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 14 }}>{t("Toca el corazón de cualquier prenda para guardarla aquí.")}</div>
      </SubHeader>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <Heart size={30} color={C.line} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, margin: "12px 0 18px" }}>{t("Aún no guardas ninguna prenda.")}</div>
          <button onClick={() => setScreen("category")} style={{ padding: "11px 18px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Ver el catálogo")}</button>
        </div>
      ) : (
        <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "0 20px" }}>
          {list.map((p) => <ProductCard key={p.id} product={p} onOpen={onOpen} fav onToggleFav={onToggleFav} onQuickAdd={onQuickAdd} catalog={catalog} cartSessionId={cartSessionId} />)}
        </div>
      )}
    </div>
  );
};

const loadAddresses = () => { try { return JSON.parse(localStorage.getItem(ADDRESSES_KEY) || "[]"); } catch (e) { return []; } };
const saveAddresses = (list) => { try { localStorage.setItem(ADDRESSES_KEY, JSON.stringify(list)); } catch (e) { /* sin guardado */ } };
const formatAddress = (a) => a.type === "provincia"
  ? [a.address, a.district, a.city, a.department, a.zip && `CP ${a.zip}`].filter(Boolean).join(", ")
  : a.type === "internacional"
    ? [a.address, a.city, a.state, a.zip && `CP ${a.zip}`, a.country].filter(Boolean).join(", ")
    : [a.address, a.district, "Trujillo"].filter(Boolean).join(", ");

// ---- Ubicación para la entrega: mapa (OpenStreetMap, gratis), distritos del Perú (INEI) y enlaces para el repartidor ----
const TRUJILLO_CENTER = { lat: -8.1116, lng: -79.0288 };
const latLngOf = (d) => {
  if (d && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)) && d.lat !== "" && d.lng !== "") return { lat: Number(d.lat), lng: Number(d.lng) };
  const m = String(d?.mapsUrl || "").match(/q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
};
const mapsLink = (p) => `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
const wazeLink = (p) => `https://waze.com/ul?ll=${p.lat.toFixed(6)},${p.lng.toFixed(6)}&navigate=yes`;
let ubigeoCache = null;
const loadUbigeo = () => (ubigeoCache ||= import("./data/ubigeo-peru.json").then((m) => m.default || m));

// Mapa para marcar dónde se entrega: toca el mapa o arrastra el pin
const MapPicker = ({ value, onClose, onPick }) => {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const [pt, setPt] = useState(value || null);
  const [err, setErr] = useState("");
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([mod]) => {
      if (!alive || !boxRef.current) return;
      const L = mod.default || mod;
      const start = value || TRUJILLO_CENTER;
      const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], value ? 17 : 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      const icon = L.divIcon({ className: "fly-pin", html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#111;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });
      let marker = value ? L.marker([value.lat, value.lng], { icon, draggable: true }).addTo(map) : null;
      const put = (lat, lng) => {
        if (!marker) { marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map); marker.on("dragend", () => { const p = marker.getLatLng(); setPt({ lat: p.lat, lng: p.lng }); }); }
        else marker.setLatLng([lat, lng]);
        setPt({ lat, lng });
      };
      if (marker) marker.on("dragend", () => { const p = marker.getLatLng(); setPt({ lat: p.lat, lng: p.lng }); });
      map.on("click", (e) => put(e.latlng.lat, e.latlng.lng));
      mapRef.current = { map, put };
      setTimeout(() => map.invalidateSize(), 200);
    }).catch(() => setErr(t("No se pudo cargar el mapa. Revisa tu conexión.")));
    return () => { alive = false; try { mapRef.current?.map.remove(); } catch (e) { /* nada */ } };
  }, []);
  const locateMe = () => {
    if (!navigator.geolocation) { setErr(t("Tu navegador no permite compartir ubicación.")); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      const { latitude: lat, longitude: lng } = pos.coords;
      mapRef.current?.put(lat, lng); mapRef.current?.map.setView([lat, lng], 17);
    }, () => { setLocating(false); setErr(t("No pudimos obtener tu ubicación. Activa el permiso de ubicación o marca el punto en el mapa.")); }, { enableHighAccuracy: true, timeout: 12000 });
  };
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}88` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paper, borderRadius: "18px 18px 0 0", padding: "16px 16px 20px", maxHeight: "94vh", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.ink }}>{t("¿Dónde entregamos?")}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>{t("Toca el mapa en la puerta de tu casa o arrastra el pin. El repartidor llegará a ese punto.")}</div>
        <div ref={boxRef} style={{ width: "100%", height: "min(56vh, 420px)", borderRadius: 12, overflow: "hidden", background: C.paperDeep }} />
        {err && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={locateMe} disabled={locating} style={{ flex: "1 1 160px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}><Navigation size={14} /> {locating ? t("Buscando…") : t("Estoy aquí (usar mi ubicación)")}</button>
          <PrimaryButton disabled={!pt} style={{ flex: "1 1 160px", width: "auto" }} onClick={() => { onPick(pt); onClose(); }}>{t("Confirmar ubicación")}</PrimaryButton>
        </div>
      </div>
    </div>
  );
};

// Departamento → Provincia → Distrito (lista oficial del INEI)
const PeruPlaceSelects = ({ v, set }) => {
  const [ubigeo, setUbigeo] = useState(null);
  useEffect(() => { loadUbigeo().then(setUbigeo).catch(() => setUbigeo({})); }, []);
  const provs = ubigeo && v.department ? Object.keys(ubigeo[v.department] || {}).sort((a, b) => a.localeCompare(b, "es")) : [];
  const dists = ubigeo && v.department && v.city ? (ubigeo[v.department]?.[v.city] || []) : [];
  const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 };
  const sel = (val, onCh, label, opts, disabled) => (
    <select value={val || ""} onChange={(e) => onCh(e.target.value)} disabled={disabled} style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }} aria-label={t(label)}>
      <option value="">{t(label)}</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  return (
    <>
      <div style={grid}>
        {sel(v.department, (x) => set({ department: x, city: "", district: "" }), t("Departamento *"), PERU_DEPARTMENTS)}
        {ubigeo && Object.keys(ubigeo).length ? sel(v.city, (x) => set({ city: x, district: "" }), t("Provincia *"), provs, !v.department)
          : <input value={v.city || ""} onChange={(e) => set({ city: e.target.value })} placeholder={t("Provincia / ciudad *")} style={inputStyle} />}
      </div>
      <div style={grid}>
        {ubigeo && Object.keys(ubigeo).length ? sel(v.district, (x) => set({ district: x }), t("Distrito *"), dists, !v.city)
          : <input value={v.district || ""} onChange={(e) => set({ district: e.target.value })} placeholder={t("Distrito *")} style={inputStyle} />}
        <input value={v.zip || ""} inputMode="numeric" onChange={(e) => set({ zip: e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder={t("Código postal (opcional)")} style={inputStyle} />
      </div>
    </>
  );
};

// Formulario de dirección (se usa en "Mis direcciones" y en la cesta)
const AddressFields = ({ value, onChange, type }) => {
  const v = value || {};
  const set = (k, x) => onChange({ ...v, type, [k]: x });
  const setMany = (patch) => onChange({ ...v, type, ...patch });
  const [locating, setLocating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const here = latLngOf(v);
  const pick = (p) => setMany({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)), mapsUrl: mapsLink(p) });
  const locate = () => {
    if (!navigator.geolocation) { alert("Tu navegador no permite compartir ubicación."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); pick({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { setLocating(false); alert("No pudimos obtener tu ubicación. Revisa que el permiso de ubicación esté activado."); },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };
  const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 };
  return (
    <div>
      {type === "internacional" ? (
        <>
          <select value={v.country || ""} onChange={(e) => set("country", e.target.value)} style={{ ...inputStyle, marginBottom: 8 }}>
            <option value="">{t("País de destino")}</option>
            {INTL_COUNTRIES.map(([iso, name]) => <option key={iso} value={name}>{t(name)}</option>)}
          </select>
          <div style={grid}>
            <input value={v.city || ""} onChange={(e) => set("city", e.target.value)} placeholder={t("Ciudad *")} style={inputStyle} />
            <input value={v.state || ""} onChange={(e) => set("state", e.target.value)} placeholder={t("Estado / provincia / región (opcional)")} style={inputStyle} />
          </div>
          <input value={v.zip || ""} onChange={(e) => set("zip", e.target.value.replace(/[^0-9A-Za-z -]/g, "").slice(0, 10))} placeholder={t("Código postal *")} style={{ ...inputStyle, marginBottom: 8 }} />
        </>
      ) : type === "provincia" ? (
        <PeruPlaceSelects v={v} set={setMany} />
      ) : (
        <select value={v.district || ""} onChange={(e) => set("district", e.target.value)} style={{ ...inputStyle, marginBottom: 8 }}>
          <option value="">{t("Distrito en Trujillo")}</option>
          {TRUJILLO_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
      <input value={v.address || ""} onChange={(e) => set("address", e.target.value)} placeholder={t("Dirección (calle, número, dpto.) *")} style={{ ...inputStyle, marginBottom: 8 }} />
      <input value={v.reference || ""} onChange={(e) => set("reference", e.target.value)} placeholder={t("Referencia (opcional: ej. frente al parque, portón negro)")} style={{ ...inputStyle, marginBottom: 8 }} />
      {type === "provincia" && (
        <select value={v.agency || ""} onChange={(e) => set("agency", e.target.value)} style={{ ...inputStyle, marginBottom: 8 }}>
          <option value="">{t("Agencia de envío preferida")}</option>
          {SHIPPING_AGENCIES.map((a) => <option key={a} value={a}>{t(a)}</option>)}
        </select>
      )}
      {(type === "local" || type === "provincia") && (
        <button type="button" onClick={() => setMapOpen(true)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center", padding: "11px 12px", borderRadius: 8, border: `1px solid ${here ? C.ink : C.line}`, background: here ? C.paperDeep : C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer", marginBottom: 8 }}>
          <MapPin size={14} /> {here ? t("Punto marcado en el mapa ✓ (tocar para cambiar)") : type === "local" ? t("Marcar en el mapa dónde entregamos") : t("Marcar en el mapa (opcional, para delivery a domicilio)")}
        </button>
      )}
      {mapOpen && <MapPicker value={here} onClose={() => setMapOpen(false)} onPick={pick} />}
      {type === "local" && !here && (
        <button type="button" onClick={locate} disabled={locating} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center", padding: "11px 12px", borderRadius: 8, border: `1px solid ${v.mapsUrl ? C.ink : C.line}`, background: v.mapsUrl ? C.paperDeep : "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
          <Navigation size={14} /> {locating ? t("Buscando tu ubicación…") : v.mapsUrl ? t("Ubicación exacta agregada ✓ (tocar para actualizar)") : t("Usar mi ubicación actual (para el repartidor)")}
        </button>
      )}
      {here && <a href={mapsLink(here)} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginBottom: 8 }}>{t("Ver en Google Maps")}</a>}
    </div>
  );
};
const addressComplete = (a, type) => !!(a && a.address && a.address.trim().length >= 5 && (type === "provincia" ? a.department && a.city && a.district : type === "internacional" ? a.country && a.city && a.zip : a.district));

const AddressesScreen = ({ setScreen }) => {
  const [list, setList] = useState(loadAddresses);
  const [editing, setEditing] = useState(null);
  const persist = (next) => { setList(next); saveAddresses(next); };
  if (editing) {
    const ok = addressComplete(editing, editing.type) && (editing.label || "").trim();
    return (
      <div className="page-narrow" style={{ paddingBottom: 24 }}>
        <SubHeader title={editing.id ? t("Editar dirección") : t("Nueva dirección")} onBack={() => setEditing(null)} />
        <div style={{ padding: "8px 20px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Chip active={editing.type === "local"} onClick={() => setEditing({ ...editing, type: "local" })}>{t("En Trujillo")}</Chip>
            <Chip active={editing.type === "provincia"} onClick={() => setEditing({ ...editing, type: "provincia" })}>{t("Otra provincia")}</Chip>
          </div>
          <input value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder={t("Nombre (ej. Casa, Trabajo)")} style={{ ...inputStyle, marginBottom: 8 }} />
          <AddressFields value={editing} type={editing.type} onChange={(v) => setEditing({ ...editing, ...v })} />
          <PrimaryButton disabled={!ok} onClick={() => { const rec = { ...editing, id: editing.id || genId("dir") }; persist(editing.id ? list.map((x) => (x.id === rec.id ? rec : x)) : [...list, rec]); setEditing(null); }}>{t("Guardar dirección")}</PrimaryButton>
          <Faltan tr={t} items={[!(editing.label || "").trim() && "ponle un nombre (ej. Casa)", ...addressMissing(editing, editing.type)]} />
        </div>
      </div>
    );
  }
  return (
    <div className="page-narrow" style={{ paddingBottom: 24 }}>
      <SubHeader title={t("Mis direcciones")} onBack={() => setScreen("profile")}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 14 }}>{t("Se guardan en este celular o computadora y las eliges al comprar.")}</div>
      </SubHeader>
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((a) => (
          <div key={a.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{a.label}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, margin: "3px 0" }}>{formatAddress(a)}</div>
            {a.reference && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>{t("Ref.:")} {a.reference}</div>}
            <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
              <button onClick={() => setEditing(a)} style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, cursor: "pointer" }}>{t("Editar")}</button>
              <button onClick={() => persist(list.filter((x) => x.id !== a.id))} style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, cursor: "pointer" }}>{t("Eliminar")}</button>
            </div>
          </div>
        ))}
        <button onClick={() => setEditing({ type: "local" })} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", borderRadius: 10, border: `1px dashed ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> {t("Agregar dirección")}</button>
      </div>
    </div>
  );
};

const PaymentMethodsScreen = ({ setScreen }) => (
  <div className="page-narrow" style={{ paddingBottom: 24 }}>
    <SubHeader title={t("Métodos de pago")} onBack={() => setScreen("profile")} />
    <div style={{ padding: "6px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      {[
        [t("Tarjeta de crédito o débito"), t("Visa, Mastercard y más. Se valida al instante con la pasarela de pago segura."), CreditCard],
        ["Yape", t("Paga al número de la tienda y escribe el número de operación al confirmar."), Receipt],
        ["Plin", t("Paga al número de la tienda y escribe el número de operación al confirmar."), Receipt],
        [t("Transferencia bancaria"), t("A la cuenta de la tienda. Escribe el número de operación al confirmar."), Receipt],
      ].map(([ttl, d, Icon]) => (
        <div key={ttl} style={{ display: "flex", gap: 12, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
          <Icon size={18} color={C.ink} style={{ flexShrink: 0, marginTop: 2 }} />
          <div><div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{t(ttl)}</div><div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginTop: 2, lineHeight: 1.5 }}>{t(d)}</div></div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, background: C.paperDeep, borderRadius: 12, padding: "12px 14px", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, lineHeight: 1.6 }}>
        <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {t("Por tu seguridad, Fly nunca guarda los datos de tu tarjeta: los procesa directamente la pasarela de pago certificada.")}
      </div>
    </div>
  </div>
);

const ProfileScreen = ({ points, favCount, onStaffClick, clubMember, onLogoutClub, setScreen, catalog, showInstall, onInstall, onCookiePrefs }) => {
  const [orderCount, setOrderCount] = useState(0);
  useEffect(() => {
    if (!clubMember?.google) { setOrderCount(0); return; }
    supabase.rpc("my_orders", { p_phone: clubMember.phone || "" }).then(({ data }) => setOrderCount((data || []).length)).catch(() => {});
  }, [clubMember?.phone, clubMember?.google]);
  const [showPolicy, setShowPolicy] = useState(false);
  const menu = [
    { label: "Mis pedidos", icon: Package, action: () => setScreen("orders") },
    { label: "Mis favoritos", icon: Heart, action: () => setScreen("favorites") },
    { label: "Visto recientemente", icon: Eye, action: () => setScreen("viewed") },
    { label: "Mis direcciones", icon: MapPin, action: () => setScreen("addresses") },
    { label: "Métodos de pago", icon: CreditCard, action: () => setScreen("payments") },
    { label: "Cambios y devoluciones", icon: Undo2, action: () => setShowPolicy(true) },
    { label: "Preferencias de cookies", icon: Cookie, action: () => onCookiePrefs && onCookiePrefs() },
  ];
  const initials = clubMember ? clubMember.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() : "?";
  return (
    <div className="page-narrow" style={{ padding: "18px 20px 24px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div style={{ width: 62, height: 62, borderRadius: "50%", background: C.paperDeep, border: `1.5px solid ${C.ink}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800 }}>{initials}</div>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800 }}>{clubMember ? clubMember.name : t("Hola")}</div>
          {clubMember ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}><Award size={12} color={C.brass} /><span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.brass }}>{t("Club Fly")}</span></div>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 3 }}>{t("Inicia sesión o únete al Club Fly")}</div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {[["Pedidos", clubMember ? String(orderCount) : "—", "orders"], ["Favoritos", String(favCount), "favorites"], ["Puntos", clubMember ? String(points) : "—", "loyalty"]].map(([label, val, target]) => (
          <div key={label} onClick={() => setScreen(target)} role="button" style={{ cursor: "pointer", flex: 1, textAlign: "center", background: C.paperDeep, borderRadius: 10, padding: "14px 6px" }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.ink, fontWeight: 800 }}>{val}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginTop: 2 }}>{t(label)}</div></div>
        ))}
      </div>
      {showInstall && (
        <button className="install-card" onClick={onInstall} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: C.paper, color: C.ink, border: `1px solid ${C.ink}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12, cursor: "pointer", textAlign: "left" }}>
          <BadgeLogo size={34} />
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600 }}>{t("Instala Fly en tu celular")}</span>
            <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 2 }}>{t("Ábrela como una app, desde tu pantalla de inicio")}</span>
          </span>
          <ChevronRight size={15} color={C.ink} />
        </button>
      )}
      <button onClick={() => setScreen("loyalty")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: C.ink, color: C.paper, border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 20, cursor: "pointer" }}>
        <Star size={16} fill={C.brass} color={C.brass} />
        <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, flex: 1, textAlign: "left" }}>{t("Club Fly")} {clubMember ? `— ${t("{n} puntos", { n: points })}` : t("— únete gratis")}</span>
        <ChevronRight size={15} color={C.paper} />
      </button>
      <div style={{ borderRadius: 12, border: `1px solid ${C.line}`, overflow: "hidden", marginBottom: 20 }}>
        {menu.map(({ label, icon: Icon, action }, i) => (
          <div key={label} onClick={action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderBottom: i < menu.length - 1 ? `1px solid ${C.paperDeep}` : "none", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Icon size={16} color={C.ink} strokeWidth={1.6} /><span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{t(label)}</span></div><ChevronRight size={15} color={C.stone} />
          </div>
        ))}
      </div>
      {clubMember && (
        <button onClick={onLogoutClub} style={{ width: "100%", padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", marginBottom: 22 }}><LogOut size={15} /> {t("Cerrar sesión")}</button>
      )}
      {showPolicy && <PolicyModal onClose={() => setShowPolicy(false)} />}
    </div>
  );
};

// Aviso de cookies (Ley N.° 29733 de Protección de Datos Personales): la clienta elige qué acepta.
const CookieConsent = ({ current, onSave, onOpenPolicy }) => {
  const [config, setConfig] = useState(false);
  const [stats, setStats] = useState(current === "all" || current === "stats");
  const [marketing, setMarketing] = useState(current === "all");
  const choice = stats && marketing ? "all" : stats ? "stats" : "essential";
  const btn = (primary) => ({ flex: 1, minWidth: 0, padding: "12px", borderRadius: 9, border: primary ? "none" : "1px solid rgba(255,255,255,0.3)", background: primary ? C.paper : "transparent", color: primary ? C.ink : C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" });
  const Toggle = ({ on, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled} aria-pressed={on} style={{ width: 40, height: 22, borderRadius: 999, border: "none", background: on ? C.paper : "rgba(255,255,255,0.25)", position: "relative", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: on ? C.ink : C.paper, transition: "left .15s ease" }} />
    </button>
  );
  const row = (title, desc, toggle) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
      <div style={{ flex: 1 }}><div className="cookie-rt" style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.paper }}>{title}</div><div className="cookie-rd" style={{ fontFamily: FONT_BODY, fontSize: 11, color: `${C.paper}AA`, lineHeight: 1.5 }}>{desc}</div></div>
      {toggle}
    </div>
  );
  return (
    <div className="cookie-box" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90, background: C.ink, padding: "18px 20px calc(18px + env(safe-area-inset-bottom))", animation: "slideUp .3s cubic-bezier(.2,.8,.2,1)", maxHeight: "85vh", overflowY: "auto" }}>
      <div className="cookie-main">
      <div className="cookie-title" style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: C.paper, marginBottom: 8 }}><Cookie size={16} /> {t("Tu privacidad en Fly")}</div>
      <div className="cookie-text" style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: `${C.paper}CC`, lineHeight: 1.6, marginBottom: 14 }}>
        {t("Usamos cookies necesarias para que la tienda funcione (tu cesta y tu sesión). Con tu permiso, también usamos cookies de estadísticas para mejorar la tienda. Nunca vendemos tus datos.")}{" "}
        <button onClick={onOpenPolicy} style={{ background: "none", border: "none", padding: 0, color: C.paper, textDecoration: "underline", fontFamily: "inherit", fontSize: "inherit", cursor: "pointer" }}>{t("Política de privacidad")}</button>
      </div>
      </div>
      {config && (
        <div className="cookie-config" style={{ marginBottom: 14 }}>
          {row(t("Necesarias"), t("Cesta, sesión y seguridad. Siempre activas."), <Toggle on disabled />)}
          {row(t("Estadísticas"), t("Cuántas personas visitan la tienda y cómo navegan (Google Analytics, Microsoft Clarity)."), <Toggle on={stats} onClick={() => setStats((x) => !x)} />)}
          {row(t("Marketing"), t("Anuncios relevantes en redes sociales."), <Toggle on={marketing} onClick={() => setMarketing((x) => !x)} />)}
        </div>
      )}
      <div className="cookie-btns" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {config ? (
          <>
            <button onClick={() => onSave("essential")} className="cookie-btn" style={btn(false)}>{t("Solo necesarias")}</button>
            <button onClick={() => onSave(choice)} className="cookie-btn" style={btn(true)}>{t("Guardar mi elección")}</button>
          </>
        ) : (
          <>
            <button onClick={() => setConfig(true)} className="cookie-btn" style={btn(false)}>{t("Configurar")}</button>
            <button onClick={() => onSave("essential")} className="cookie-btn" style={btn(false)}>{t("Solo necesarias")}</button>
            <button onClick={() => onSave("all")} className="cookie-btn" style={btn(true)}>{t("Aceptar todo")}</button>
          </>
        )}
      </div>
    </div>
  );
};

// Aviso para instalar la app que aparece solo al entrar (si el equipo lo permite).
// Android/PC: botón «Instalar» (un toque). iPhone/iPad: Apple no deja instalar con un botón, se muestran los 2 pasos con una flecha.
const InstallSheet = ({ app, tr = (x, v) => (v ? x.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m) : x), canPrompt, ios, iosSafari, ipad, onInstall, onClose }) => {
  const icon = app === "caja" ? "/icons/caja-192.png" : app === "staff" ? "/icons/staff-192.png" : "/icons/icon-192.png";
  const name = app === "caja" ? "Fly Caja" : app === "staff" ? "Fly Staff" : "Fly";
  const step = (n, children) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink, padding: "5px 0" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.ink, color: C.paper, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{children}</span>
    </div>
  );
  return (
    <div className="install-sheet" role="dialog" aria-label={tr("Instalar la app")} style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90, display: "flex", justifyContent: "center", padding: "0 12px calc(12px + env(safe-area-inset-bottom, 0px))", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", width: "100%", maxWidth: 420, background: C.paper, color: C.ink, borderRadius: 16, boxShadow: "0 10px 40px rgba(0,0,0,0.28)", border: `1px solid ${C.line}`, padding: "16px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <img src={icon} alt="" width={48} height={48} style={{ borderRadius: 12, border: `1px solid ${C.line}`, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800 }}>{tr("Instala «{n}»", { n: name })}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>{tr("Ábrela desde tu pantalla de inicio, a pantalla completa.")}</div>
          </div>
          <button onClick={onClose} aria-label={tr("Cerrar")} style={{ background: "none", border: "none", padding: 6, cursor: "pointer", alignSelf: "flex-start" }}><X size={18} color={C.stone} /></button>
        </div>
        {canPrompt ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: 13, borderRadius: 10, border: `1px solid ${C.line}`, background: C.paper, color: C.ink, fontFamily: FONT_BODY, fontSize: 14, cursor: "pointer" }}>{tr("Ahora no")}</button>
            <button className="install-go btn-ready" onClick={onInstall} style={{ flex: 2, padding: 13, borderRadius: 10, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Download size={16} /> {tr("Instalar")}</button>
          </div>
        ) : ios && !iosSafari ? (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.5 }}>{tr("En iPhone se instala desde Safari: abre esta misma página en Safari y aparecerán los pasos.")}</div>
        ) : (
          <>
            {step(1, <>{tr("Toca")} <Share size={17} aria-label={tr("Compartir")} /> <strong>{tr("Compartir")}</strong> {ipad ? tr("(arriba a la derecha)") : tr("(abajo, en la barra de Safari)")}</>)}
            {step(2, <>{tr("Elige")} <SquarePlus size={17} /> <strong>{tr("«Agregar a pantalla de inicio»")}</strong> {tr("y toca «Agregar»")}</>)}
          </>
        )}
      </div>
      {ios && iosSafari && !ipad && !canPrompt && <ChevronDown className="install-arrow" size={30} color={C.ink} style={{ position: "fixed", bottom: "calc(2px + env(safe-area-inset-bottom, 0px))", left: "50%", marginLeft: -15, pointerEvents: "none" }} />}
    </div>
  );
};

// Línea corta que dice qué falta para habilitar un botón (desaparece cuando no falta nada).
const Faltan = ({ items, tr, label = "Para continuar:", center }) => { const l = (items || []).filter(Boolean); if (!l.length) return null; const f = tr || ((x) => x); return <div className="faltan" role="status" style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, margin: "8px 0", lineHeight: 1.5, textAlign: center ? "center" : "left" }}>{f(label)} {l.map((x) => f(x)).join(", ")}.</div>; };

// Qué falta de una dirección de entrega (mismas reglas que addressComplete).
const addressMissing = (a, type) => {
  const m = [];
  if (!a || !a.address || a.address.trim().length < 5) m.push("escribe la dirección (calle y número)");
  if (type === "provincia") { if (!a?.department || !a?.city || !a?.district) m.push("elige departamento, provincia y distrito"); }
  else if (type === "internacional") { if (!a?.country || !a?.city || !a?.zip) m.push("escribe país, ciudad y código postal"); }
  else if (!a?.district) m.push("elige el distrito");
  return m;
};

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
// En el mostrador (cajero y vendedoras de tienda) el panel aguanta más sin uso. La caja sigue abierta aunque se cierre la sesión.
const idleMinutesFor = (role) => (role === "cajero" || role === "vendedora_tienda" ? 180 : STAFF_IDLE_MINUTES);

const LOGIN_LOCK_KEY = "flyboutique:loginlock:v1";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

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

// Campo de contraseña con "ojito" para ver lo que se escribió
const PasswordInput = ({ value, onChange, style, dark = false, ...rest }) => {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input {...rest} value={value} onChange={onChange} type={show ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ ...style, paddingRight: 44 }} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: dark ? C.paper : C.ink }}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
};

const StaffAccess = ({ onDone, onCancel, installName, onInstall, installHint }) => {
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
  const [remember, setRemember] = useState(false);

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
    if (isLocked || busy) return;
    if (!username.trim() && !password) { setErr("Escribe tu usuario y tu contraseña."); return; }
    if (!username.trim()) { setErr("Falta el usuario."); return; }
    if (!password) { setErr("Falta la contraseña."); return; }
    setBusy(true); setErr("");
    setStaffSessionMode(remember); // sin marcar: la sesión se cierra al cerrar la página
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
          <PasswordInput dark value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }} placeholder="Contraseña" autoComplete="current-password"
            onKeyDown={(e) => e.key === "Enter" && login()} style={darkInput(!!err)} />
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontFamily: FONT_BODY, fontSize: 11.5, color: `${C.paper}CC`, cursor: "pointer", lineHeight: 1.45 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Mantener la sesión iniciada en este equipo<br /><span style={{ opacity: 0.7 }}>Solo en un equipo de confianza. Si no lo marcas, la sesión se cierra al cerrar la página.</span></span>
          </label>
          {err && <div style={errText}>{err}</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 18, width: "100%", maxWidth: 270 }}>
        <button onClick={cancel} style={darkBtn}>Volver a la tienda</button>
        {!isLocked && <button onClick={login} disabled={busy} style={{ ...lightBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Entrando…" : "Entrar"}</button>}
      </div>
      {installName && onInstall && (
        <button className="staff-install" onClick={onInstall} style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 8, background: "none", border: `1px dashed ${C.paper}66`, borderRadius: 10, padding: "10px 14px", color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer", maxWidth: 270, width: "100%", justifyContent: "center" }}>
          <Download size={15} color={C.paper} /> Instalar «{installName}» en este equipo
        </button>
      )}
      {installName && onInstall && installHint && <div style={{ marginTop: 8, fontFamily: FONT_BODY, fontSize: 12, color: C.paper, maxWidth: 270, textAlign: "center" }}>Listo. Toca otra vez «Instalar» para terminar.</div>}
    </>
  );
};

const AdminTopBar = ({ title, onBack, onExit, onHome }) => (
  <div className="admin-topbar" style={{ position: "sticky", top: 0, zIndex: 15, background: C.ink, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {onBack && <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><ArrowLeft size={18} color={C.paper} /></button>}
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, color: C.paper, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
    </div>
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
    {onHome && <button onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11, color: C.paper, background: "none", border: `1px solid rgba(255,255,255,0.25)`, borderRadius: 999, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }} aria-label="Inicio del panel"><Home size={12} /><span className="tb-label">Inicio</span></button>}
    <button onClick={onExit} title="Cierra tu sesión. La caja sigue abierta para el siguiente turno." style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11, color: C.paper, background: "none", border: `1px solid rgba(255,255,255,0.35)`, borderRadius: 999, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }} aria-label="Cerrar sesión"><LogOut size={12} /><span className="tb-label">Cerrar sesión</span><span className="tb-short">Salir</span></button>
    </div>
  </div>
);

// Lo que hace cada sección (aparece al dejar el mouse encima)
const NAV_HINTS = { purchases: "Mercadería que llega de los proveedores", transfers: "Guías para enviar y recibir prendas entre Larco y el Almacén", caja: "Abrir, mover y cerrar la caja del turno", pos: "Registrar una venta en tienda", mysales: "Ver tus ventas", onlineorders: "Pedidos de la web por preparar o enviar", stock: "Ver y corregir el stock", dashboard: "Resumen del negocio", products: "Crear y editar productos", more: "Caja, vendedores, comprobantes, reportes y configuración", onlinesales: "Registrar una venta hecha por WhatsApp o redes" };
const AdminNav = ({ screen, setScreen, role }) => {
  const items = (role === "administrador" || role === "superadmin")
    ? [["dashboard", "Panel", LayoutDashboard], ["pos", "Ventas", ShoppingCart], ["stock", "Stock", Package], ["products", "Productos", LayoutGrid], ["more", "Más", Menu]]
    : role === "cajero"
    ? [["caja", "Caja", Banknote], ["pos", "Vender", ShoppingCart], ["transfers", "Traslados", Navigation], ["mysales", "Mis ventas", BarChart3], ["onlineorders", "Pedidos", Ticket]]
    : role === "vendedora_tienda"
    ? [["pos", "Vender", ShoppingCart], ["transfers", "Traslados", Navigation], ["mysales", "Mis ventas", BarChart3], ["onlineorders", "Pedidos", Ticket]]
    : role === "almacen"
    ? [["stock", "Stock", Package], ["transfers", "Traslados", Navigation], ["onlineorders", "Pedidos", Ticket]]
    : [["onlinesales", "Venta Online", ShoppingCart], ["onlineorders", "Pedidos Web", Ticket], ["mysales", "Mis ventas", BarChart3]];
  const moreScreens = ["transfers", "purchases", "activity", "diagnostico", "docapi", "fotoscopia", "facturacion", "banners", "bannerEditor", "collections", "collectionEditor", "invoices", "reports", "more", "users", "promocodes", "onlineorders", "caja", "sellers", "manual"];
  return (
    <div className="staff-nav" style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.paperDeep, borderTop: `1px solid ${C.line}`, padding: "10px 6px calc(10px + env(safe-area-inset-bottom))", display: "flex", justifyContent: "space-around", zIndex: 30 }}>
      {items.map(([key, label, Icon]) => {
        const active = screen === key || (key === "products" && screen === "productEditor") || (key === "more" && moreScreens.includes(screen));
        return (
          <button key={key} className={`nav-item${active ? " is-active" : ""}`} onClick={() => setScreen(key)} title={NAV_HINTS[key] || label} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
            <Icon size={19} strokeWidth={active ? 2.1 : 1.5} color={active ? C.ink : C.stone} />
            <span className="nav-label" style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: active ? C.ink : C.stone, fontWeight: active ? 600 : 400 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
};

const quickLinkStyle = { display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, color: C.ink };

// ---- Resumen del negocio (inicio del panel): todo sale de los registros reales ----
const ACTION_LABELS = { compra_registrada: "Compra registrada", compra_anulada: "Compra anulada", venta_anulada: "Venta anulada", pago_validado: "Pago validado", costo_cambiado: "Costo cambiado", gasto_anulado: "Gasto anulado", guia_emitida: "Guía emitida", guia_recibida: "Guía recibida", guia_anulada: "Guía anulada", traslado_stock: "Traspaso", usuario_renombrado: "Usuario renombrado", caja_abierta: "Caja abierta", caja_cerrada: "Caja cerrada" };
// Tarjeta desplegable: título siempre visible; el contenido se abre al tocar. Recuerda si la dejaste abierta.
const FoldCard = ({ id, title, summary, defaultOpen = false, children, style }) => {
  const key = `flyboutique:plegado:${id || title}`;
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === "1"; } catch (e) { return defaultOpen; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch (e) { /* sin guardado */ } return !o; });
  return (
    <div className={`fold-card${open ? " is-open" : ""}`} style={{ background: C.paperDeep, border: `1px solid ${open ? C.ink : C.line}`, borderRadius: 12, marginBottom: 10, ...style }}>
      <button type="button" className="fold-btn" aria-expanded={open} onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", minHeight: 52 }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, color: C.ink }}>{title}</span>
          {!open && summary && <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>}
        </span>
        <ChevronDown className="fold-chev" size={18} color={C.ink} />
      </button>
      {open && <div className="fold-body" style={{ padding: "0 16px 16px" }}>{children}</div>}
    </div>
  );
};

const BusinessSummary = ({ catalog, go }) => {
  const [extra, setExtra] = useState({ transfers: null, cash: null, activity: null });
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("stock_transfers").select("id").eq("status", "en_camino").limit(500),
      supabase.from("cash_sessions").select("store_id,closed_at,closed_by_name,difference,notes").eq("status", "cerrada").order("closed_at", { ascending: false }).limit(10),
      supabase.from("audit_log").select("at,user_name,action,details").order("at", { ascending: false }).limit(8),
    ]).then(([t, c, a]) => { if (alive) setExtra({ transfers: t.error ? null : (t.data || []).length, cash: c.error ? null : c.data || [], activity: a.error ? null : a.data || [] }); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const valid = (catalog.sales || []).filter((x) => x.status !== "anulado").map(netSale);
  const day = 86400000;
  const start = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const today = start(Date.now());
  const weekStart = today - ((new Date(today).getDay() + 6) % 7) * day; // lunes
  const n = new Date(); const monthStart = new Date(n.getFullYear(), n.getMonth(), 1).getTime(); const prevMonthStart = new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime();
  const sumIn = (a, b) => valid.filter((x) => x.createdAt >= a && x.createdAt < b);
  const tot = (l) => l.reduce((t, x) => t + (x.total || 0), 0);
  const elapsed = Date.now() - monthStart;
  const periods = [
    ["Hoy", sumIn(today, Date.now() + 1), sumIn(today - day, Date.now() - day), "vs. ayer a esta hora"],
    ["Esta semana", sumIn(weekStart, Date.now() + 1), sumIn(weekStart - 7 * day, Date.now() - 7 * day), "vs. semana pasada"],
    ["Este mes", sumIn(monthStart, Date.now() + 1), sumIn(prevMonthStart, prevMonthStart + elapsed), "vs. mismos días del mes pasado"],
  ];
  const month = periods[2][1];
  const web = month.filter((x) => x.channel === "online"), shop = month.filter((x) => x.channel !== "online");
  const orders = (catalog.sales || []).filter((x) => x.channel === "online" && x.source === "web" && x.status !== "anulado");
  const toValidate = orders.filter((x) => x.paymentStatus !== "confirmado").length;
  const toShip = orders.filter((x) => x.paymentStatus === "confirmado" && x.fulfillment !== "entregado").length;
  const low = catalog.products.reduce((a, p) => a + p.variants.filter((v) => v.stock > 0 && v.stock <= (p.minStock ?? 3)).length, 0);
  const out = catalog.products.filter(productSoldOut).length;
  const diffs = (extra.cash || []).filter((c) => Math.abs(Number(c.difference) || 0) >= 0.5);
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const TILE_ICONS = { "Pagos por validar": Banknote, "Por preparar o enviar": Truck, "Guías en camino": ArrowLeftRight, "Stock bajo": Package, Hoy: BarChart3, "Esta semana": BarChart3, "Este mes": BarChart3, "Mes: tienda / web": Store };
  const tile = (label, value, sub, onClick, alert, small) => {
    const Icon = TILE_ICONS[label];
    return (
    <button key={label} className="dash-tile" onClick={onClick} style={{ textAlign: "left", background: C.paperDeep, border: `1px solid ${alert ? C.accent : C.line}`, borderRadius: 12, padding: "14px 16px", cursor: onClick ? "pointer" : "default", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: alert ? C.accent : C.stone }}>{Icon && <Icon size={14} />}{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: small ? 17 : 22, fontWeight: 800, color: alert ? C.accent : C.ink, marginTop: 2, fontVariantNumeric: "tabular-nums", lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 1 }}>{sub}</div>}
    </button>
    );
  };
  const quick = [["pos", "Vender", ShoppingCart], ["caja", "Caja", Banknote], ["onlineorders", "Pedidos web", Truck], ["stock", "Stock", Package], ["products", "Productos", LayoutGrid], ["reports", "Reportes", BarChart3]];
  return (
    <>
      <span style={labelStyle}>Accesos rápidos</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {quick.map(([k, l, Icon]) => <button key={k} className="more-chip" onClick={() => go(k)}><Icon size={14} /> {l}</button>)}
      </div>
      <span style={labelStyle}>Necesita atención</span>
      <div className="report-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        {tile("Pagos por validar", toValidate, "Pedidos web", () => go("onlineorders"), toValidate > 0)}
        {tile("Por preparar o enviar", toShip, "Pedidos web pagados", () => go("onlineorders"))}
        {tile("Guías en camino", extra.transfers ?? "—", "Traslados por recibir", () => go("transfers"), (extra.transfers || 0) > 0)}
        {tile("Stock bajo", low, `${out} productos agotados`, () => go("stock"), out > 0)}
      </div>
      <span style={labelStyle}>Ventas</span>
      <div className="report-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
        {periods.map(([label, cur, prev, vsText]) => { const p = pct(tot(cur), tot(prev)); return tile(label, money(tot(cur)), `${cur.length} ventas${p !== null ? ` · ${p >= 0 ? "+" : ""}${p}% ${vsText}` : ""}`, () => go("reports")); })}
        {tile("Mes: tienda / web", <>{money(tot(shop))}<br />{money(tot(web))}</>, `${shop.length} en tienda · ${web.length} por la web`, () => go("reports"), false, true)}
      </div>
      {extra.cash && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Diferencias de caja (últimos cierres)</span>
          {diffs.length === 0 ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>{extra.cash.length ? "Los últimos cierres cuadraron." : "Aún no hay cierres de caja."}</div> : diffs.slice(0, 5).map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
              <span style={{ minWidth: 0 }}>{fmtDT(c.closed_at)} · {c.closed_by_name || "—"}<span style={{ display: "block", fontSize: 11, color: C.stone }}>{c.notes || "Sin motivo"}</span></span>
              <strong style={{ color: Number(c.difference) < 0 ? C.accent : C.ink, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{Number(c.difference) > 0 ? "+" : "−"}{money2(Math.abs(Number(c.difference)))}</strong>
            </div>
          ))}
        </AdminCard>
      )}
      {extra.activity && extra.activity.length > 0 && (
        <AdminCard style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={labelStyle}>Actividad reciente</span><button onClick={() => go("activity")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.ink, textDecoration: "underline" }}>Ver todo</button></div>
          {extra.activity.map((a, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12, color: C.ink }}>
              <span style={{ minWidth: 0 }}>{activityLabel(a.action)}{a.details?.guia ? ` · ${a.details.guia}` : a.details?.motivo ? ` · ${a.details.motivo}` : ""}</span>
              <span style={{ color: C.stone, whiteSpace: "nowrap" }}>{a.user_name || ""} · {fmtDT(a.at)}</span>
            </div>
          ))}
        </AdminCard>
      )}
      <span style={labelStyle}>Configuración de la tienda</span>
    </>
  );
};

const AdminDashboard = ({ catalog, updateCatalog, setAdminScreen, role }) => {
  const { products, banners, collections } = catalog;
  const agotados = products.filter(productSoldOut).length;
  const [culqiKey, setCulqiKey] = useState(catalog.settings?.culqiPublicKey || "");
  const [turnstileKey, setTurnstileKey] = useState(catalog.settings?.turnstileSiteKey || "");
  const [gaId, setGaId] = useState(catalog.settings?.gaId || "");
  const [clarityId, setClarityId] = useState(catalog.settings?.clarityId || "");
  const isData = (u) => typeof u === "string" && u.startsWith("data:");
  const pendingMedia = products.reduce((a, p) => a + (p.images || []).filter((m) => isData(m.url)).length, 0)
    + banners.filter((b) => isData(b.image)).length + collections.filter((c) => isData(c.cover)).length;
  const [moving, setMoving] = useState(null);
  const moveMediaToStorage = async () => {
    if (!confirm(`Se van a mover ${pendingMedia} fotos al almacenamiento rápido. Puede tardar unos minutos: no cierres esta pestaña. ¿Continuar?`)) return;
    let done = 0, failed = 0;
    setMoving({ done, total: pendingMedia });
    const cache = new Map();
    const move = async (url, folder) => {
      if (!isData(url)) return url;
      if (cache.has(url)) return cache.get(url);
      try { const nu = await uploadDataUrl(url, folder); cache.set(url, nu); done++; setMoving({ done, total: pendingMedia }); return nu; }
      catch (err) { console.error(err); failed++; return url; }
    };
    const newProducts = [];
    for (const p of products) newProducts.push({ ...p, images: await Promise.all((p.images || []).map(async (m) => ({ ...m, url: await move(m.url, "productos") }))) });
    const newBanners = []; for (const b of banners) newBanners.push({ ...b, image: await move(b.image, "banners") });
    const newCollections = []; for (const c of collections) newCollections.push({ ...c, cover: await move(c.cover, "colecciones") });
    const byId = (list) => new Map(list.map((x) => [x.id, x]));
    const np = byId(newProducts), nb = byId(newBanners), nc = byId(newCollections);
    updateCatalog((c) => ({
      ...c,
      products: c.products.map((p) => (np.has(p.id) ? { ...p, images: np.get(p.id).images } : p)),
      banners: c.banners.map((b) => (nb.has(b.id) ? { ...b, image: nb.get(b.id).image } : b)),
      collections: c.collections.map((x) => (nc.has(x.id) ? { ...x, cover: nc.get(x.id).cover } : x)),
    }));
    setMoving(null);
    alert(failed ? `Listo: ${done} fotos movidas. ${failed} no se pudieron mover (se quedaron como estaban); puedes intentar de nuevo.` : `Listo: ${done} fotos movidas. La tienda ya carga más rápido.`);
  };
  const [company, setCompany] = useState(companyOf(catalog.settings));
  const [stores, setStores] = useState(storesOf(catalog.settings));
  const [intlRates, setIntlRates] = useState(catalog.settings?.intlRates || {});
  const saveCompany = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, company: { ...company, ruc: company.ruc.replace(/\D/g, "").slice(0, 11) } } })); alert("Datos de la empresa guardados."); };
  const saveStores = () => { const clean = stores.filter((x) => x.name.trim()).map((x) => ({ ...x, id: x.id || genId("sede") })); if (!clean.length) return; updateCatalog((c) => ({ ...c, settings: { ...c.settings, stores: clean } })); setStores(clean); alert("Sedes guardadas."); };
  const [loyaltyCfg, setLoyaltyCfg] = useState(loyaltyOf(catalog.settings));
  const [discountCapInput, setDiscountCapInput] = useState(String(posDiscountCap(catalog.settings)));
  const saveDiscountCap = () => {
    const v = Math.min(100, Math.max(0, Number(discountCapInput) || 0));
    updateCatalog((c) => ({ ...c, settings: { ...c.settings, posMaxDiscountPct: v } }));
    setDiscountCapInput(String(v));
    alert(`Listo: las vendedoras podrán dar hasta ${v}% de descuento manual. Administración no tiene tope.`);
  };
  const saveLoyalty = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, loyalty: { solesPerStep: Math.max(0.01, Number(loyaltyCfg.solesPerStep) || 1), pointsPerStep: Number(loyaltyCfg.pointsPerStep) || 0, blockPoints: Math.max(1, Number(loyaltyCfg.blockPoints) || 100), blockValue: Number(loyaltyCfg.blockValue) || 0 } } })); alert("Programa de puntos actualizado. Se aplica desde las próximas compras."); };
  const [socials, setSocials] = useState({ ...DEFAULT_SOCIALS, ...(catalog.settings?.socials || {}) });
  const [trackingUrls, setTrackingUrls] = useState(catalog.settings?.trackingUrls || {});
  const saveSocials = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, socials, trackingUrls } })); alert("Redes y enlaces guardados."); };
  const [intlCountryRates, setIntlCountryRates] = useState(catalog.settings?.intlCountryRates || {});
  const saveIntl = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, intlRates, intlCountryRates } })); alert("Tarifas internacionales guardadas."); };
  const [localShip, setLocalShip] = useState(() => { const l = localShippingOf(catalog.settings); return { price: String(l.price), freeFrom: String(l.freeFrom) }; });
  const [provRates, setProvRates] = useState(catalog.settings?.provinceRates || {});
  const savePeruShipping = () => {
    const clean = Object.fromEntries(Object.entries(provRates).filter(([, v]) => v !== "" && !isNaN(Number(v))).map(([k, v]) => [k, Number(v)]));
    updateCatalog((c) => ({ ...c, settings: { ...c.settings, localShipping: { price: numOr(localShip.price, 12), freeFrom: numOr(localShip.freeFrom, 200) }, provinceRates: clean } }));
    alert("Tarifas de envío en Perú guardadas. Se aplican desde ahora en la cesta.");
  };
  const saveStatsIds = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, gaId: gaId.trim(), clarityId: clarityId.trim() } })); alert("Códigos de estadísticas guardados. Empiezan a contar desde las próximas visitas."); };
  const saveTurnstileKey = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, turnstileSiteKey: turnstileKey.trim() } })); alert(turnstileKey.trim() ? "Llave del captcha guardada. El registro del Club Fly ya usa la verificación de Cloudflare." : "Llave borrada. El registro vuelve a usar la suma."); };
  const [payAccounts, setPayAccounts] = useState({
    yapeNumber: catalog.settings?.yapeNumber || "", plinNumber: catalog.settings?.plinNumber || "",
    bankName: catalog.settings?.bankName || "", bankAccount: catalog.settings?.bankAccount || "", bankCCI: catalog.settings?.bankCCI || "",
  });
  const saveCulqiKey = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, culqiPublicKey: culqiKey.trim() } })); alert("Llave pública de Culqi guardada."); };
  const savePayAccounts = () => { updateCatalog((c) => ({ ...c, settings: { ...c.settings, ...payAccounts } })); alert("Datos de pago guardados."); };
  return (
    <div style={{ padding: "20px 18px 90px" }}>
      <Eyebrow>Fly</Eyebrow>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.ink, fontWeight: 800, margin: "0 0 20px" }}>Panel de control</h1>
      <BusinessSummary catalog={catalog} go={setAdminScreen} />
      <FoldCard title="Yape, Plin y transferencia bancaria">
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
      </FoldCard>
      <FoldCard title="Configuración de pagos — Culqi (tarjeta)">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          Pega aquí solo tu <strong>llave pública</strong> (empieza con <code>pk_</code>). Nunca pegues la llave secreta (<code>sk_</code>) en la app — esa va únicamente en tu servidor.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={culqiKey} onChange={(e) => setCulqiKey(e.target.value)} placeholder="pk_test_xxxxxxxxxxxx" style={inputStyle} />
          <button onClick={saveCulqiKey} style={{ padding: "0 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </FoldCard>
      <FoldCard title="Verificación anti-robots — Cloudflare Turnstile">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          Pega aquí la <strong>Site Key</strong> (empieza con <code>0x</code>). La <strong>Secret Key</strong> nunca va aquí: se guarda en Supabase.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={turnstileKey} onChange={(e) => setTurnstileKey(e.target.value)} placeholder="0x4AAAAAAA…" style={inputStyle} />
          <button onClick={saveTurnstileKey} style={{ padding: "0 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </FoldCard>
      <FoldCard title="Estadísticas de visitas">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
          <strong>Google Analytics</strong> (empieza con <code>G-</code>): visitas, de dónde llegan y en qué paso abandonan la compra. <strong>Microsoft Clarity</strong> (código corto de letras y números): mapas de calor y grabaciones anónimas de cómo navegan. Solo se activan con clientas que aceptan las cookies.
        </div>
        <Field label="Google Analytics — ID de medición"><input value={gaId} onChange={(e) => setGaId(e.target.value)} placeholder="G-XXXXXXXXXX" style={inputStyle} /></Field>
        <Field label="Microsoft Clarity — ID del proyecto"><input value={clarityId} onChange={(e) => setClarityId(e.target.value)} placeholder="abcd1234ef" style={inputStyle} /></Field>
        <button onClick={saveStatsIds} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </FoldCard>
      <FoldCard title="Outlet (liquidación)">
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <Switch on={outletOn(catalog.settings)} label={outletOn(catalog.settings) ? "Outlet abierto en la web" : "Outlet cerrado (pausado)"} onClick={() => {
            const turnOff = outletOn(catalog.settings);
            if (!confirm(turnOff ? "¿Cerrar el Outlet? Sus prendas dejan de verse y venderse en la web (en la tienda física se pueden seguir vendiendo). Nada se borra." : "¿Abrir el Outlet? Las prendas marcadas como Outlet vuelven a verse en su sección.")) return;
            updateCatalog((c) => ({ ...c, settings: { ...c.settings, outletEnabled: !turnOff } }));
          }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 4 }}>{catalog.products.filter(isOutlet).length} prendas marcadas como Outlet. Se marcan una por una en Productos → editar → «Outlet».</div>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6 }}>Ideal para liquidar a precio de costo sin mezclarlo con la colección: precio final, sin cupones ni puntos, envío a cargo de la clienta y sin cambios (salvo falla de fábrica).</div>
      </FoldCard>
      <FoldCard title="Programa de puntos (Club Fly)">
        <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
          <Switch on={clubOn(catalog.settings)} label={clubOn(catalog.settings) ? "Club Fly activo" : "Club Fly en pausa"} onClick={() => {
            const turnOff = clubOn(catalog.settings);
            if (!confirm(turnOff ? "¿Pausar el Club Fly? Nadie ganará ni usará puntos (web y tienda) hasta que lo vuelvas a activar. Los puntos de cada clienta se conservan." : "¿Activar el Club Fly? Se vuelven a ganar y usar puntos.")) return;
            updateCatalog((c) => ({ ...c, settings: { ...c.settings, clubEnabled: !turnOff } }));
          }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 4 }}>Puedes pausarlo para probar si el programa es rentable. Los puntos ganados no se borran.</div>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>Cambia los valores y mira abajo cuánto devuelves. Lo recomendable para una boutique es entre 2% y 5%.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, marginBottom: 10 }}>
          Por cada S/
          <input inputMode="decimal" value={loyaltyCfg.solesPerStep} onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, solesPerStep: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: 70, textAlign: "center" }} />
          gastados, la clienta gana
          <input inputMode="decimal" value={loyaltyCfg.pointsPerStep} onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, pointsPerStep: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: 70, textAlign: "center" }} />
          puntos.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, marginBottom: 12 }}>
          Cada
          <input inputMode="numeric" value={loyaltyCfg.blockPoints} onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, blockPoints: e.target.value.replace(/\D/g, "") })} style={{ ...inputStyle, width: 80, textAlign: "center" }} />
          puntos valen S/
          <input inputMode="decimal" value={loyaltyCfg.blockValue} onChange={(e) => setLoyaltyCfg({ ...loyaltyCfg, blockValue: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: 70, textAlign: "center" }} />
          de descuento.
        </div>
        {(() => {
          const sps = Math.max(0.01, Number(loyaltyCfg.solesPerStep) || 1), pst = Number(loyaltyCfg.pointsPerStep) || 0;
          const pps = pst / sps, bp = Math.max(1, Number(loyaltyCfg.blockPoints) || 1), bv = Number(loyaltyCfg.blockValue) || 0;
          const pts = Math.floor(200 / sps) * pst; const val = Math.floor(pts / bp) * bv; const pct = (pps * bv / bp) * 100;
          return (
            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, lineHeight: 1.6, marginBottom: 10 }}>
              Ejemplo: una compra de <strong>S/ 200</strong> da <strong>{pts} puntos</strong>, que valen <strong>{money(val)}</strong>.<br />
              Devuelves el <strong style={{ color: pct > 6 ? C.accent : C.ink }}>{pct.toFixed(1)}%</strong> de lo que vendes{pct > 6 ? " (alto: revisa tu margen)" : ""}.
            </div>
          );
        })()}
        <button onClick={saveLoyalty} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </FoldCard>
      <FoldCard title="Descuento manual en caja">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>Máximo que una vendedora puede descontar a mano en una venta (los códigos promocionales y los puntos no cuentan). Administración no tiene tope. El servidor también lo revisa.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>
          Hasta
          <input inputMode="numeric" value={discountCapInput} onChange={(e) => setDiscountCapInput(e.target.value.replace(/\D/g, "").slice(0, 3))} style={{ ...inputStyle, width: 70, textAlign: "center" }} />
          % del subtotal
          <button onClick={saveDiscountCap} style={{ marginLeft: "auto", padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </FoldCard>
      <FoldCard title="Redes sociales (pie de la tienda)">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 10 }}>Pega el enlace completo. Si dejas uno vacío, ese ícono no aparece.</div>
        {[["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["whatsapp", "WhatsApp (https://wa.me/51…)"]].map(([k, l]) => (
          <Field key={k} label={l}><input style={inputStyle} value={socials[k] || ""} onChange={(e) => setSocials({ ...socials, [k]: e.target.value.trim() })} placeholder="https://…" /></Field>
        ))}
        <span style={{ ...labelStyle, marginTop: 6 }}>Página de rastreo de cada agencia (opcional)</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 10 }}>Si la pones, la clienta verá un botón "Rastrear en la web de…" junto a su número de seguimiento.</div>
        {["Shalom", "Olva Courier", "Marvisur", "Serpost", "DHL Express"].map((ag) => (
          <Field key={ag} label={ag}><input style={inputStyle} value={trackingUrls[ag] || ""} onChange={(e) => setTrackingUrls({ ...trackingUrls, [ag]: e.target.value.trim() })} placeholder="https://…" /></Field>
        ))}
        <button onClick={saveSocials} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </FoldCard>
      <FoldCard title="Datos de la empresa">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>Aparecen en el Libro de Reclamaciones y en los comprobantes.</div>
        <Field label="Razón social"><input style={inputStyle} value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} /></Field>
        <Field label="RUC"><input style={inputStyle} inputMode="numeric" value={company.ruc} onChange={(e) => setCompany({ ...company, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="20xxxxxxxxx" /></Field>
        <Field label="Dirección fiscal"><input style={inputStyle} value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></Field>
        <Field label="Correo de atención"><input style={inputStyle} value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></Field>
        <Field label="Régimen tributario (para el comprobante)">
          <select style={inputStyle} value={company.taxRegime || "general"} onChange={(e) => setCompany({ ...company, taxRegime: e.target.value })}>
            <option value="general">Afecto a IGV 18% (Régimen General, MYPE o Especial): el comprobante desglosa el IGV</option>
            <option value="nrus">Nuevo RUS: el comprobante no desglosa IGV</option>
          </select>
        </Field>
        <button onClick={saveCompany} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </FoldCard>
      <FoldCard title="Sedes">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>Cada venta de la caja queda registrada con su sede. Si agregas una segunda sede, la caja te pedirá elegir en cuál estás vendiendo.</div>
        {stores.map((st, i) => (
          <div key={st.id || i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} value={st.name} onChange={(e) => setStores(stores.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Nombre de la sede" />
            <input style={{ ...inputStyle, flex: 1.4 }} value={st.address || ""} onChange={(e) => setStores(stores.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} placeholder="Dirección" />
            {stores.length > 1 && <button onClick={() => setStores(stores.filter((_, j) => j !== i))} aria-label="Quitar sede" style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} /></button>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setStores([...stores, { id: "", name: "", address: "" }])} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>+ Agregar sede</button>
          <button onClick={saveStores} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </div>
      </FoldCard>
      <FoldCard title="Tarifas de envío en Perú (S/ por pedido)">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>Delivery en Trujillo y envío a cada departamento. Si dejas un departamento vacío se usa la tarifa por defecto (la que aparece en gris).</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: FONT_BODY, fontSize: 13, color: C.ink, marginBottom: 12 }}>
          Delivery en Trujillo S/
          <input inputMode="decimal" value={localShip.price} onChange={(e) => setLocalShip({ ...localShip, price: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: 70, textAlign: "center" }} />
          · gratis desde S/
          <input inputMode="decimal" value={localShip.freeFrom} onChange={(e) => setLocalShip({ ...localShip, freeFrom: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: 80, textAlign: "center" }} />
        </div>
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>Envío a provincia por departamento</summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 6, alignItems: "center", fontFamily: FONT_BODY, fontSize: 12 }}>
            {PERU_DEPARTMENTS.map((dep) => (
              <React.Fragment key={dep}>
                <div>{dep}</div>
                <input inputMode="decimal" style={{ ...inputStyle, padding: "7px 8px" }} value={provRates?.[dep] ?? ""} onChange={(e) => setProvRates({ ...provRates, [dep]: e.target.value.replace(/[^0-9.]/g, "") })} placeholder={String(defaultProvinceRate(dep))} />
              </React.Fragment>
            ))}
          </div>
        </details>
        <button onClick={savePeruShipping} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </FoldCard>
      <FoldCard title="Tarifas de envío internacional (S/ por pedido)">
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 10 }}>Pon el precio que cobras por zona después de cotizar con cada agencia. Si lo dejas vacío, la cesta dirá "Por cotizar" y coordinas el costo por WhatsApp.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, alignItems: "center", fontFamily: FONT_BODY, fontSize: 12 }}>
          <div /><strong>Serpost</strong><strong>DHL Express</strong>
          {Object.entries(INTL_ZONES).map(([z, name]) => (
            <React.Fragment key={z}>
              <div>{name}</div>
              {["serpost", "dhl"].map((k) => <input key={k} inputMode="decimal" style={inputStyle} value={intlRates?.[z]?.[k] || ""} onChange={(e) => setIntlRates({ ...intlRates, [z]: { ...(intlRates?.[z] || {}), [k]: e.target.value.replace(/[^0-9.]/g, "") } })} placeholder="Por cotizar" />)}
            </React.Fragment>
          ))}
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 8 }}>Precio por país (opcional: reemplaza al de su zona)</summary>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 6, alignItems: "center", fontFamily: FONT_BODY, fontSize: 12 }}>
            <div /><strong>Serpost</strong><strong>DHL</strong>
            {INTL_COUNTRIES.map(([, name, zone]) => (
              <React.Fragment key={name}>
                <div>{name}</div>
                {["serpost", "dhl"].map((k) => <input key={k} inputMode="decimal" style={{ ...inputStyle, padding: "7px 8px" }} value={intlCountryRates?.[name]?.[k] || ""} onChange={(e) => setIntlCountryRates({ ...intlCountryRates, [name]: { ...(intlCountryRates?.[name] || {}), [k]: e.target.value.replace(/[^0-9.]/g, "") } })} placeholder={intlRates?.[zone]?.[k] ? String(intlRates[zone][k]) : "zona"} />)}
              </React.Fragment>
            ))}
          </div>
        </details>
        <button onClick={saveIntl} style={{ marginTop: 10, padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
      </FoldCard>
      {pendingMedia > 0 && (
        <FoldCard title="Fotos guardadas a la antigua">
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12 }}>
            Hay <strong>{pendingMedia}</strong> fotos guardadas dentro de la base de datos del catálogo. Muévelas al almacenamiento rápido para que la tienda cargue más ligero. Se hace una sola vez.
          </div>
          <button onClick={moveMediaToStorage} disabled={!!moving} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: moving ? "wait" : "pointer", opacity: moving ? 0.7 : 1 }}>
            {moving ? `Moviendo… ${moving.done} de ${moving.total}` : "Mover fotos al almacenamiento"}
          </button>
        </FoldCard>
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
// Pasar una prenda al Outlet con su precio final (o cambiarlo, o sacarla). El precio de antes queda tachado.
const OutletControl = ({ product, onPatch }) => {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(product.price));
  const out = isOutlet(product);
  const n = Number(price);
  const original = Number(product.compareAtPrice) > Number(product.price) ? Number(product.compareAtPrice) : Number(product.price);
  const save = () => {
    if (!(n > 0)) { alert("Escribe el precio final del Outlet."); return; }
    onPatch(product.id, { outlet: true, price: n, compareAtPrice: original > n ? original : null });
    setOpen(false);
  };
  const btn = { padding: "5px 10px", borderRadius: 7, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 11, cursor: "pointer" };
  if (!open) return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
      {!out && <button type="button" onClick={() => { setPrice(String(product.price)); setOpen(true); }} style={btn}>Pasar al Outlet</button>}
      {out && <button type="button" onClick={() => { setPrice(String(product.price)); setOpen(true); }} style={btn}>Outlet · cambiar precio</button>}
      {out && <button type="button" onClick={() => { if (confirm(`¿Sacar «${product.name}» del Outlet? Vuelve a la colección${Number(product.compareAtPrice) > Number(product.price) ? ` con su precio de antes (S/ ${product.compareAtPrice})` : ""}.`)) onPatch(product.id, { outlet: false, ...(Number(product.compareAtPrice) > Number(product.price) ? { price: Number(product.compareAtPrice), compareAtPrice: null } : {}) }); }} style={{ ...btn, borderColor: C.line }}>Sacar del Outlet</button>}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6, fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft }}>
      Precio final S/
      <input inputMode="decimal" autoFocus value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Precio final del Outlet" style={{ ...inputStyle, width: 80, padding: "6px 8px" }} />
      {n > 0 && original > n && <span>({Math.round((1 - n / original) * 100)}% menos que S/ {original})</span>}
      <button type="button" onClick={save} style={{ ...btn, background: C.ink, color: C.paper }}>{out ? "Guardar" : "Pasar al Outlet"}</button>
      <button type="button" onClick={() => setOpen(false)} style={{ ...btn, borderColor: C.line }}>Cancelar</button>
    </div>
  );
};

// Crea las miniaturas de las fotos que se subieron antes de existir esta mejora (la tienda carga más rápido en celular).
// No borra ni cambia la foto original: solo agrega una copia pequeña.
const ThumbsTool = ({ products, onDone }) => {
  const [run, setRun] = useState(null);
  const pending = products.flatMap((p) => (p.images || []).filter((m) => m.type !== "video" && !m.thumb && /^https?:\/\//.test(m.url || "")).map((m) => ({ pid: p.id, url: m.url })));
  if (!pending.length && !run) return null;
  const start = async () => {
    const made = {}; let ok = 0, fail = 0;
    setRun({ done: 0, total: pending.length });
    const queue = [...pending];
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        try {
          const res = await fetch(it.url); if (!res.ok) throw new Error(res.status);
          const t = await makeThumb(await res.blob(), "productos");
          if (t) { made[it.url] = t; ok++; } else fail++;
        } catch (e) { fail++; }
        setRun({ done: ok + fail, total: pending.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (ok) onDone(made);
    setRun({ done: ok + fail, total: pending.length, ok, fail, finished: true });
  };
  return (
    <div style={{ background: C.paperDeep, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", marginBottom: 10, fontFamily: FONT_BODY, fontSize: 12, color: C.ink }}>
      {!run && <><strong>{pending.length} foto(s)</strong> sin versión liviana para celular. <button onClick={start} style={{ marginLeft: 6, padding: "6px 10px", borderRadius: 7, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Optimizar fotos</button><div style={{ color: C.stone, fontSize: 11, marginTop: 4 }}>Hace que el catálogo cargue más rápido. No cambia ni borra las fotos originales.</div></>}
      {run && !run.finished && <>Optimizando fotos… {run.done} de {run.total}. No cierres esta pantalla.</>}
      {run?.finished && <>Listo: {run.ok} foto(s) optimizadas{run.fail ? ` · ${run.fail} no se pudieron (puedes reintentar más tarde)` : ""}.</>}
    </div>
  );
};

const AdminProductList = ({ catalog, openEditor, deleteProduct, onImport, onBulkPhotos, onAddThumbs, onToggleActive, onToggleFeatured, onToggleOnline, onDuplicate, onPatchProduct }) => {
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
      try { const m = await uploadMedia(file, "productos"); matches.push({ productId: match.product.id, url: m.url, type: m.type, thumb: m.thumb || null, colorName: match.colorName }); }
      catch (err) { console.error(err); unmatched.push(file.name); }
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
      {onAddThumbs && <ThumbsTool products={catalog.products} onDone={onAddThumbs} />}

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
                {onPatchProduct && <OutletControl product={p} onPatch={onPatchProduct} />}
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
  id: null, name: "", nameEn: "", category: CATEGORY_OPTIONS[0], description: "", descriptionEn: "", price: "", compareAtPrice: "",
  status: "active", tag: "", minStock: 3, showOnline: true, images: [], collectionIds: [], sizes: [], colors: [], stock: {}, skus: {},
});

const QUICK_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "Única"];
const sortSizes = (list) => [...list].sort((a, b) => {
  const ia = QUICK_SIZES.indexOf(a), ib = QUICK_SIZES.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1;
  return (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(String(b));
});
const AdminProductEditor = ({ product, collections, allProducts, onSave, onCancel }) => {
  const [form, setForm] = useState(emptyProductForm());
  // Costo de compra y proveedor: privados (tabla product_costs), nunca en el catálogo público
  const [cost, setCost] = useState({ value: "", supplier: "", loaded: false, original: null, unavailable: false });
  const [pct, setPct] = useState("");
  useEffect(() => {
    if (!product?.id) { setCost({ value: "", supplier: "", loaded: true, original: null, unavailable: false }); return; }
    supabase.from("product_costs").select("cost,supplier").eq("product_id", product.id).maybeSingle().then(({ data, error }) => {
      setCost({ value: data ? String(data.cost) : "", supplier: data?.supplier || "", loaded: true, original: data || null, unavailable: !!error });
    });
  }, [product?.id]);
  const saveCost = async (productId) => {
    if (cost.unavailable || !cost.loaded) return;
    const v = cost.value.trim();
    if (v === "" && !cost.original) return;
    const num = Number(v);
    if (v === "" || !(num >= 0)) return;
    if (cost.original && Number(cost.original.cost) === num && (cost.original.supplier || "") === cost.supplier.trim()) return;
    const { error } = await supabase.from("product_costs").upsert({ product_id: productId, cost: num, supplier: cost.supplier.trim() || null });
    if (error) alert("El producto se guardó, pero no el costo: " + error.message);
  };
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
      setForm({ id: product.id, name: product.name, nameEn: product.nameEn || "", category: product.category, description: product.description || "", descriptionEn: product.descriptionEn || "",
        price: String(product.price), compareAtPrice: product.compareAtPrice ? String(product.compareAtPrice) : "",
        status: product.status, tag: product.tag || "", minStock: product.minStock ?? 3, showOnline: product.showOnline !== false, outlet: product.outlet === true, images: product.images, collectionIds: product.collectionIds || [],
        sizes, colors, stock, skus });
    } else setForm(emptyProductForm());
  }, [product]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addSize = () => { const s = newSize.trim(); if (!s || form.sizes.includes(s)) return; set("sizes", sortSizes([...form.sizes, s])); setNewSize(""); };
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
    const files = [...(e.target.files || [])]; if (!files.length) return;
    setUploading(true);
    const added = [];
    for (const file of files) {
      try { const m = await uploadMedia(file, "productos"); added.push({ id: genId("img"), url: m.url, type: m.type, ...(m.thumb ? { thumb: m.thumb } : {}) }); }
      catch (err) { console.error(err); alert(`${file.name}: ${mediaErrorText(err)}`); }
    }
    if (added.length) setForm((f) => ({ ...f, images: [...f.images, ...added] }));
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const toggleCollection = (id) => set("collectionIds", form.collectionIds.includes(id) ? form.collectionIds.filter((c) => c !== id) : [...form.collectionIds, id]);

  const canSave = form.name.trim() && form.price !== "" && form.sizes.length > 0 && form.colors.length > 0;

  // Cada talla+color conserva su identificador interno al editar: así el stock, las cestas abiertas
  // y el historial siguen apuntando a la misma prenda.
  const existingVar = new Map((product?.variants || []).map((v) => [`${v.size}|${v.colorName}`, v]));
  const skuList = form.sizes.flatMap((s) => form.colors.map((c) => (form.skus[`${s}|${c.n}`] || "").trim().toUpperCase())).filter(Boolean);
  const dupInside = skuList.find((x, i) => skuList.indexOf(x) !== i);
  const dupOther = skuList.find((x) => (allProducts || []).some((p) => p.id !== form.id && p.variants.some((v) => String(v.sku || "").toUpperCase() === x)));
  const handleSave = () => {
    if (dupInside) { alert(`El código ${dupInside} está repetido en dos tallas/colores. Cada talla y color debe tener su propio código.`); return; }
    if (dupOther) { alert(`El código ${dupOther} ya lo usa otro producto. Al escanearlo no sabríamos cuál es: cámbialo.`); return; }
    const newPrice = Number(form.price);
    if (!(newPrice > 0)) { alert("Escribe un precio mayor que 0."); return; }
    if (form.compareAtPrice && Number(form.compareAtPrice) <= newPrice) { alert("El «precio anterior» (tachado) debe ser MAYOR que el precio de venta. Si no está en oferta, déjalo vacío."); return; }
    // Si el precio cambia mucho, se pide confirmar (evita un cero de más o de menos)
    if (product && product.price > 0 && (newPrice > product.price * 1.8 || newPrice < product.price * 0.5)
        && !confirm(`El precio cambia de S/ ${product.price} a S/ ${newPrice}. ¿Es correcto?`)) return;
    const variants = [];
    form.sizes.forEach((s) => form.colors.forEach((c) => {
      const key = `${s}|${c.n}`;
      const customSku = (form.skus[key] || "").trim();
      variants.push({ ...(existingVar.get(key) || {}), id: existingVar.get(key)?.id || genId("var"), size: s, colorName: c.n, colorHex: c.h, stock: form.stock[key] || 0,
        sku: customSku || `${slugify(form.name)}-${s}-${slugify(c.n)}`.toUpperCase() });
    }));
    const record = {
      id: form.id || genId("prod"), name: form.name.trim(), slug: slugify(form.name), category: form.category,
      nameEn: (form.nameEn || "").trim() || undefined, descriptionEn: (form.descriptionEn || "").trim() || undefined,
      description: form.description, price: Number(form.price) || 0, compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
      status: form.status, tag: form.tag || null, minStock: form.minStock ?? 3, showOnline: form.showOnline !== false, outlet: form.outlet === true, images: form.images, collectionIds: form.collectionIds, variants,
      createdAt: product?.createdAt || Date.now(), updatedAt: Date.now(),
    };
    saveCost(record.id);
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
        <Field label="Nombre en inglés (opcional)"><input style={inputStyle} value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} placeholder="Ej. Coralina Midi Dress" /></Field>
        <Field label="Descripción en inglés (opcional)"><textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} placeholder="Se muestra cuando la tienda está en inglés. Si lo dejas vacío, se ve en español." /></Field>
      </AdminCard>

      <AdminCard style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Precio (S/)"><input type="number" style={inputStyle} value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="189" /></Field></div>
          <div style={{ flex: 1 }}><Field label="Precio anterior (opcional)"><input type="number" style={inputStyle} value={form.compareAtPrice} onChange={(e) => set("compareAtPrice", e.target.value)} placeholder="—" /></Field></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>
          Poner en oferta:
          <input inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="%" aria-label="Porcentaje de descuento" style={{ ...inputStyle, width: 64, padding: "7px 8px", textAlign: "center" }} />
          <button type="button" disabled={!(Number(pct) > 0)} onClick={() => {
            const base = Number(form.compareAtPrice) > Number(form.price) ? Number(form.compareAtPrice) : Number(form.price);
            if (!(base > 0)) return;
            setForm((x) => ({ ...x, compareAtPrice: String(base), price: String(Math.round(base * (1 - Number(pct) / 100))) })); setPct("");
          }} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", opacity: Number(pct) > 0 ? 1 : 0.4 }}>Aplicar % de descuento</button>
          {Number(form.compareAtPrice) > Number(form.price) && <button type="button" onClick={() => setForm((x) => ({ ...x, price: String(x.compareAtPrice), compareAtPrice: "" }))} style={{ background: "none", border: "none", textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", color: C.ink }}>Quitar oferta</button>}
        </div>
        {!cost.unavailable && (
          <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 12px", marginTop: 4 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 120px" }}><Field label="Costo de compra (privado)"><input inputMode="decimal" style={inputStyle} value={cost.value} onChange={(e) => setCost((c) => ({ ...c, value: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="Ej. 45" /></Field></div>
              <div style={{ flex: "2 1 160px" }}><Field label="Proveedor (opcional)"><input style={inputStyle} maxLength={120} value={cost.supplier} onChange={(e) => setCost((c) => ({ ...c, supplier: e.target.value }))} placeholder="Ej. Gamarra · Taller Rosa" /></Field></div>
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: -4 }}>
              Solo lo ven Super Admin y Administración. {Number(cost.value) > 0 && Number(form.price) > 0 ? `Margen por prenda: S/ ${(Number(form.price) - Number(cost.value)).toFixed(2)} (${Math.round((1 - Number(cost.value) / Number(form.price)) * 100)}%).` : "Sirve para calcular tu ganancia real en Reportes."}
            </div>
          </div>
        )}
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
          <div style={{ height: 10 }} />
          <Switch on={form.outlet === true} onClick={() => set("outlet", !(form.outlet === true))} label={form.outlet ? "Outlet (liquidación): solo en la sección Outlet" : "Colección normal"} />
          {form.outlet && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginTop: 6, lineHeight: 1.5 }}>Sale del inicio y del catálogo y aparece solo en «Outlet». Precio final: sin cupones ni puntos, el envío lo paga la clienta y sin cambios. Pon el precio de liquidación en «Precio» y, si quieres mostrar el tachado, el precio original en «Precio anterior».</div>}
        </div>
      </AdminCard>

      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Imágenes y videos</span>
        <div style={{ background: C.paperDeep, borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, lineHeight: 1.6 }}>
          <strong>Medida recomendada:</strong> fotos verticales 1000×1300px (proporción 3:4), formato JPG, menos de 500 KB. Para video: misma proporción vertical (ej. 1080×1440), 5-15 segundos, en bucle, menos de 15 MB para que cargue rápido.
        </div>
        {form.colors.length > 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 10 }}>Asigna cada foto o video a un color para que cambie solo cuando la clienta elija ese color. Puedes subir varias fotos y videos a la vez (videos de hasta 50 MB).</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {form.images.map((img) => (
            <div key={img.id} style={{ width: 64 }}>
              <div style={{ position: "relative", width: 64, height: 80 }}>
                {img.type === "video" ? (
                  <video src={img.url} muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }} />
                ) : (
                  <ProductImg src={imgThumb(img)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6 }} />
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
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {uploading ? "Subiendo…" : "Subir fotos o videos"}
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={handleFile} style={{ display: "none" }} />
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {QUICK_SIZES.filter((q) => !form.sizes.includes(q)).map((q) => (
            <button key={q} onClick={() => set("sizes", sortSizes([...form.sizes, q]))} style={{ padding: "6px 11px", borderRadius: 999, border: `1px dashed ${C.stone}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>+ {q}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="Otra talla: 38, 40…" onKeyDown={(e) => e.key === "Enter" && addSize()} />
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
      <Faltan center items={[!form.name.trim() && "escribe el nombre", form.price === "" && "pon el precio", !form.sizes.length && "elige al menos una talla", !form.colors.length && "agrega al menos un color"]} />
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
  const videoRef = useRef(null);
  useEffect(() => { setForm(banner ? { ...banner } : emptyBannerForm()); }, [banner]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { const m = await uploadMedia(file, "banners"); set(m.type === "video" ? "videoUrl" : "image", m.url); } catch (err) { console.error(err); alert(mediaErrorText(err)); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (videoRef.current) videoRef.current.value = "";
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
        <button onClick={() => videoRef.current?.click()} disabled={uploading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {uploading ? "Subiendo…" : "Subir video desde tu equipo"}
        </button>
        <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={handleFile} style={{ display: "none" }} />
        <input style={inputStyle} value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="o pega una URL de video (.mp4)" />
        {form.videoUrl && <button onClick={() => set("videoUrl", "")} style={{ marginTop: 8, background: "none", border: "none", color: C.ink, textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer", padding: 0 }}>Quitar video</button>}
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <Field label="Eyebrow (texto pequeño superior)"><input style={inputStyle} value={form.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} placeholder="Colección primavera" /></Field>
        <Field label="Título"><input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Piezas con carácter, hechas para volar" /></Field>
        <Field label="Título en inglés (opcional)"><input style={inputStyle} value={form.titleEn || ""} onChange={(e) => set("titleEn", e.target.value)} placeholder="Pieces with character, made to fly" /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Texto del botón"><input style={inputStyle} value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Botón en inglés (opcional)"><input style={inputStyle} value={form.ctaLabelEn || ""} onChange={(e) => set("ctaLabelEn", e.target.value)} placeholder="Shop the collection" /></Field></div>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, margin: "-4px 0 10px", lineHeight: 1.5 }}>Si dejas vacío el inglés, la tienda en inglés usa una traducción conocida o, si no la hay, el texto en español.</div>
        <div style={{ display: "flex", gap: 10 }}>
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
      <Faltan center items={[!form.title.trim() && "escribe el título", !form.image && "sube la imagen"]} />
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
            <Switch on={editing.clubOnly} onClick={() => set("clubOnly", !editing.clubOnly)} label="Solo para el Club Fly" />
            <Switch on={editing.active} onClick={() => set("active", !editing.active)} label="Código activo" />
          </div>
        </AdminCard>
        <PrimaryButton disabled={!canSave} onClick={() => { onSave({ ...editing, id: editing.id || genId("promo"), createdAt: editing.createdAt || Date.now() }); setEditing(null); }}>Guardar código</PrimaryButton>
        <Faltan center items={[!editing.code.trim() && "escribe el código", !(editing.value > 0) && "pon un valor mayor que 0"]} />
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
const FULFILLMENT_LABELS = { pendiente: "Pendiente", preparando: "Preparando", listo: "Listo para recoger / enviar", enviado: "Enviado (en tránsito)", entregado: "Entregado" };
// Qué le falta a un pedido para poder imprimir su etiqueta
const labelMissing = (o) => {
  const d = o.deliveryDetails || {};
  const miss = [];
  if (!o.customerName) miss.push("nombre");
  if (!o.customerPhone) miss.push("teléfono");
  if (o.deliveryMethod !== "recojo") {
    if (!(d.address || o.deliveryAddress)) miss.push("dirección");
    if (o.deliveryMethod === "local" && !d.district) miss.push("distrito");
    if (o.deliveryMethod === "provincia") { if (!d.department) miss.push("departamento"); if (!d.city) miss.push("provincia"); if (!d.district) miss.push("distrito"); }
    if (o.deliveryMethod === "internacional") { if (!d.country) miss.push("país"); if (!d.city) miss.push("ciudad"); if (!d.zip) miss.push("código postal"); }
  }
  return miss;
};

// Texto para el repartidor / mensajero (WhatsApp) con todos los datos y la ubicación
const riderMessage = (o) => {
  const d = o.deliveryDetails || {};
  const pt = latLngOf(d);
  const place = [d.district, d.city, d.department || d.state, d.country].filter(Boolean).join(", ");
  return [
    `*Entrega FLY ${o.serie}-${String(o.numero).padStart(6, "0")}*`,
    o.customerName && `Recibe: ${o.customerName}`,
    o.customerPhone && `Celular: +${o.customerPhone}`,
    (d.address || o.deliveryAddress) && `Dirección: ${d.address || o.deliveryAddress}`,
    place && `Lugar: ${place}`,
    d.reference && `Referencia: ${d.reference}`,
    pt && `Ubicación: ${mapsLink(pt)}`,
    pt && `Waze: ${wazeLink(pt)}`,
    `Paquete: ${o.items.reduce((a, i) => a + i.qty, 0)} prenda(s)`,
    `Pago: ${o.paymentStatus === "confirmado" ? "ya pagado, no cobrar" : `consultar con la tienda antes de entregar (${money(o.total)})`}`,
  ].filter(Boolean).join("\n");
};

const RiderShare = ({ o }) => {
  const pt = latLngOf(o.deliveryDetails);
  if (o.deliveryMethod === "recojo") return null;
  const btn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, textDecoration: "none" };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 8px" }}>
      {pt && <a href={mapsLink(pt)} target="_blank" rel="noreferrer" style={btn}><MapPin size={13} /> Google Maps</a>}
      {pt && <a href={wazeLink(pt)} target="_blank" rel="noreferrer" style={btn}><Navigation size={13} /> Waze</a>}
      <a href={`https://wa.me/?text=${encodeURIComponent(riderMessage(o))}`} target="_blank" rel="noreferrer" style={{ ...btn, background: C.ink, color: C.paper, borderColor: C.ink }}>Enviar al repartidor por WhatsApp</a>
    </div>
  );
};

// QR en la etiqueta: el repartidor lo escanea y se abre el mapa
const LocationQR = ({ url }) => {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    import("qrcode").then((m) => (m.default || m).toDataURL(url, { margin: 0, width: 220, errorCorrectionLevel: "M" })).then((d) => { if (alive) setSrc(d); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  if (!src) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px dashed #000", marginTop: 8, paddingTop: 8 }}>
      <img src={src} alt="QR de la ubicación" style={{ width: 92, height: 92 }} />
      <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>Escanea para ver la ubicación en el mapa</div>
    </div>
  );
};

const ShippingLabel = ({ order, orders, settings, onClose }) => {
  const list = orders || [order];
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}88` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "18px 18px 22px", maxHeight: "92vh", overflowY: "auto" }}>
        <div className="print-area" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {list.map((o) => <LabelCard key={o.id} o={o} settings={settings} />)}
        </div>
        <div style={{ display: "flex", gap: 10, maxWidth: 420, margin: "14px auto 0" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Cerrar</button>
          <button onClick={() => window.print()} style={{ flex: 2, padding: "13px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Imprimir {list.length > 1 ? `${list.length} etiquetas` : "etiqueta"}</button>
        </div>
      </div>
    </div>
  );
};

const LabelCard = ({ o, settings }) => {
  const company = companyOf(settings);
  const d = o.deliveryDetails || {};
  const method = { recojo: "RECOJO EN TIENDA", local: "DELIVERY TRUJILLO", provincia: "ENVÍO A PROVINCIA", internacional: "ENVÍO INTERNACIONAL" }[o.deliveryMethod] || o.deliveryMethod;
  const place = o.deliveryMethod === "provincia" ? [d.district, d.city, d.department].filter(Boolean).join(" / ")
    : o.deliveryMethod === "internacional" ? [d.city, d.state, d.country].filter(Boolean).join(" / ")
    : o.deliveryMethod === "local" ? [d.district, "Trujillo"].filter(Boolean).join(" / ") : company.address;
  const line = (k, v, big) => v ? <div style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: big ? 16 : 13 }}><span style={{ minWidth: 92, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", paddingTop: big ? 4 : 1 }}>{k}</span><span style={{ fontWeight: big ? 800 : 500 }}>{v}</span></div> : null;
  return (
        <div className="label-print" style={{ background: C.white, color: "#000", border: "2px solid #000", borderRadius: 8, padding: "14px 16px", fontFamily: FONT_BODY, maxWidth: 420, width: "100%", margin: "0 auto", breakInside: "avoid", pageBreakInside: "avoid" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 900, letterSpacing: "0.04em" }}>FLY</div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{method}</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{o.serie}-{String(o.numero).padStart(6, "0")}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", marginBottom: 2 }}>DESTINATARIO</div>
          {line("Nombre", o.customerName, true)}
          {line("Teléfono", o.customerPhone ? `+${o.customerPhone}` : "")}
          {line("Dirección", d.address || (o.deliveryMethod === "recojo" ? "Recoge en tienda" : o.deliveryAddress))}
          {line("Lugar", place)}
          {line("Cód. postal", d.zip)}
          {line("Referencia", d.reference)}
          {line("Agencia", d.agency || d.carrier)}
          {latLngOf(d) && <LocationQR url={mapsLink(latLngOf(d))} />}
          <div style={{ borderTop: "1px dashed #000", margin: "8px 0", paddingTop: 6, fontSize: 12 }}>
            <strong>Contenido ({o.items.reduce((a, i) => a + i.qty, 0)}):</strong> {o.items.map((i) => `${i.name} ${i.size}/${i.colorName} x${i.qty}`).join(" · ")}
          </div>
          <div style={{ borderTop: "2px solid #000", paddingTop: 6, fontSize: 11.5, lineHeight: 1.5 }}>
            <strong>REMITENTE:</strong> {company.legalName}{company.ruc ? ` · RUC ${company.ruc}` : ""}<br />{company.address} · Tel. +{company.phone}
          </div>
        </div>
  );
};

const TrackingEditor = ({ order, onSave }) => {
  const [num, setNum] = useState(order.trackingNumber || "");
  const [agency, setAgency] = useState(order.trackingAgency || order.deliveryDetails?.agency || "Shalom");
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <select value={agency} onChange={(e) => setAgency(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "8px 10px" }}>
        {["Shalom", "Olva Courier", "Marvisur", "Serpost", "DHL Express", "Repartidor propio"].map((a) => <option key={a}>{a}</option>)}
      </select>
      <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="N.° de seguimiento / guía / clave" style={{ ...inputStyle, flex: 1, minWidth: 150, padding: "8px 10px" }} />
      <button onClick={() => num.trim() && onSave(num.trim(), agency)} disabled={!num.trim()} style={{ padding: "9px 12px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: num.trim() ? 1 : 0.5 }}>{order.trackingNumber ? "Actualizar" : "Marcar enviado"}</button>
    </div>
  );
};

const unpaidHoursOf = (settings) => numOr(settings?.unpaidOrderHours, 24);
const OnlineOrdersScreen = ({ sales, onUpdateFulfillment, onValidatePayment, canValidate, settings, onCancelUnpaid, onSaveUnpaidHours, onSaveCartHold }) => {
  const [labelOrder, setLabelOrder] = useState(null);
  const unpaidHours = unpaidHoursOf(settings);
  const [hoursInput, setHoursInput] = useState(String(unpaidHours));
  const holdMin = cartHoldMinutes(settings);
  const [holdInput, setHoldInput] = useState(String(holdMin));
  const [batch, setBatch] = useState(null);
  const orders = sales.filter((s) => s.channel === "online" && s.source === "web" && s.status !== "anulado").sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      {(() => {
        const ready = sales.filter((s) => s.channel === "online" && s.source === "web" && s.status !== "anulado" && s.paymentStatus === "confirmado" && s.fulfillment !== "entregado" && s.deliveryMethod !== "recojo" && labelMissing(s).length === 0);
        return (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: 0 }}>Pedidos Online</h1>
            {canValidate && onSaveUnpaidHours && (
              <div title="Los pedidos web sin pago se anulan solos pasado este tiempo y la prenda vuelve a estar disponible. 0 = nunca." style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, flexBasis: "100%", order: 3 }}>
                Cancelar solos los pedidos sin pago después de
                <input inputMode="numeric" value={hoursInput} onChange={(e) => setHoursInput(e.target.value.replace(/\D/g, "").slice(0, 3))} style={{ ...inputStyle, width: 58, padding: "6px 8px", textAlign: "center" }} />
                horas
                {hoursInput !== String(unpaidHours) && <button onClick={() => onSaveUnpaidHours(Number(hoursInput) || 0)} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer" }}>Guardar</button>}
              </div>
            )}
            {canValidate && onSaveCartHold && (
              <div title="Mientras una clienta tiene la prenda en su cesta, nadie más puede llevarse esa unidad. Pasado este tiempo queda libre. Entre 5 y 60 minutos." style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, flexBasis: "100%", order: 4, flexWrap: "wrap" }}>
                Apartar las prendas en la cesta durante
                <input inputMode="numeric" value={holdInput} onChange={(e) => setHoldInput(e.target.value.replace(/\D/g, "").slice(0, 2))} style={{ ...inputStyle, width: 58, padding: "6px 8px", textAlign: "center" }} />
                minutos
                {holdInput !== String(holdMin) && <button onClick={() => { const m = cartHoldMinutes({ cartHoldMinutes: Number(holdInput) }); setHoldInput(String(m)); onSaveCartHold(m); }} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer" }}>Guardar</button>}
              </div>
            )}
            {ready.length > 0 && <button onClick={() => setBatch(ready)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Package size={14} /> Imprimir etiquetas por enviar ({ready.length})</button>}
          </div>
        );
      })()}
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}><PayBadge method={o.paymentMethod} size={18} />{o.paymentMethod}</span>
              </div>
              {o.customerName && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginBottom: 4 }}>Cliente: {o.customerName}{o.customerPhone ? ` · ${o.customerPhone}` : ""}</div>}
              {o.deliveryAddress && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 4 }}>Dirección: {o.deliveryAddress}</div>}
              {o.deliveryDetails?.reference && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 4 }}>Referencia: {o.deliveryDetails.reference}</div>}
              {o.deliveryDetails?.carrier && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 4 }}>Envío internacional: {o.deliveryDetails.carrier}{o.deliveryDetails.toQuote ? " (costo por cotizar)" : ""}</div>}
              {o.deliveryDetails?.agency && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 4 }}>Agencia: {o.deliveryDetails.agency}</div>}
              <RiderShare o={o} />
              {o.paymentRef && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink, fontWeight: 600, margin: "4px 0 8px" }}>N.° de operación: {o.paymentRef}</div>}
              {o.pointsUsed > 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 6 }}>Usó {o.pointsUsed} puntos ({money(o.pointsDiscount)} de descuento)</div>}
              <div style={{ borderTop: `1px solid ${C.paperDeep}`, paddingTop: 8, marginBottom: 10 }}>
                {o.items.map((it, i) => <div key={i} style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, marginBottom: 2 }}>• {it.name} — {it.size}/{it.colorName} × {it.qty}</div>)}
              </div>
              {(() => {
                const miss = labelMissing(o);
                if (miss.length) {
                  const msg = `Hola ${o.customerName || ""}, para enviar tu pedido ${o.serie}-${String(o.numero).padStart(6, "0")} nos falta: ${miss.join(", ")}. ¿Nos lo compartes? ¡Gracias!`;
                  return (
                    <div style={{ border: `1px dashed ${C.ink}`, borderRadius: 9, padding: "9px 12px", marginBottom: 10, fontFamily: FONT_BODY, fontSize: 11.5, color: C.ink, lineHeight: 1.5 }}>
                      Para la etiqueta falta: <strong>{miss.join(", ")}</strong>.{" "}
                      {o.customerPhone && <a href={`https://wa.me/${o.customerPhone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" style={{ color: C.ink, fontWeight: 600 }}>Pedírselo por WhatsApp</a>}
                    </div>
                  );
                }
                return (
                  <button onClick={() => setLabelOrder(o)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginBottom: 10, padding: "12px", borderRadius: 9, border: validated ? "none" : `1px solid ${C.ink}`, background: validated ? C.ink : "transparent", color: validated ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    <Package size={15} /> {o.deliveryMethod === "recojo" ? "Imprimir etiqueta de recojo" : "Imprimir etiqueta de envío"}
                  </button>
                );
              })()}
              {!validated && canValidate && (
                <button onClick={() => { if (confirm("¿Confirmas que el pago (Yape/Plin/transferencia/tarjeta) sí llegó? El pedido queda como pagado y la clienta suma sus puntos.")) onValidatePayment(o.id); }} style={{ width: "100%", marginBottom: 10, padding: "10px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ✓ Validar pago recibido
                </button>
              )}
              {!validated && (() => {
                const hrs = (Date.now() - (o.createdAt || Date.now())) / 3600000;
                const left = unpaidHours > 0 ? Math.max(0, unpaidHours - hrs) : null;
                return (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: C.paperDeep, borderRadius: 9, padding: "8px 10px", marginBottom: 10 }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft }}>Hace {hrs < 1 ? `${Math.max(1, Math.round(hrs * 60))} min` : `${Math.floor(hrs)} h`}{left !== null ? ` · si no paga, se cancela sola en ${left < 1 ? `${Math.max(1, Math.round(left * 60))} min` : `${Math.ceil(left)} h`}` : ""}</span>
                    {onCancelUnpaid && <button title="La clienta no pagó: anula el pedido y la prenda vuelve al stock" onClick={() => { const why = prompt("¿Por qué se cancela? (ej. no pagó, desistió)", "No pagó"); if (why !== null) onCancelUnpaid(o.id, why); }} style={{ padding: "7px 11px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.paper, color: C.accent, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Cancelar: no pagó</button>}
                  </div>
                );
              })()}
              {!validated && !canValidate && <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginBottom: 10, fontStyle: "italic" }}>Esperando que un Administrador valide el pago antes de preparar el pedido.</div>}
              {validated && o.deliveryMethod !== "recojo" && (
                <TrackingEditor order={o} onSave={(num, agency) => onUpdateFulfillment(o.id, o.fulfillment === "entregado" ? "entregado" : "enviado", num, agency)} />
              )}
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
      {labelOrder && <ShippingLabel order={labelOrder} settings={settings} onClose={() => setLabelOrder(null)} />}
      {batch && <ShippingLabel orders={batch} settings={settings} onClose={() => setBatch(null)} />}
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
    try { const m = await uploadMedia(file, "colecciones"); if (m.type === "image") set("cover", m.url); } catch (err) { console.error(err); alert(mediaErrorText(err)); }
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
      <Faltan center items={[!form.name.trim() && "escribe el nombre", !form.cover && "sube la foto de portada"]} />
    </div>
  );
};

/* ---- Admin root ---- */
/* ---- Stock: movement sheet ---- */
const MOVEMENT_TYPES = [
  { key: "entrada", label: "Entrada", sign: 1, hint: "Llegó mercadería o reposición del mismo modelo." },
  { key: "devolucion", label: "Devolución", sign: 1, hint: "Una clienta devolvió la prenda y vuelve a la venta (si la venta tiene comprobante, mejor anúlala en Comprobantes)." },
  { key: "salida", label: "Salida", sign: -1, needsNote: true, hint: "Sale sin venderse: traslado, préstamo, sesión de fotos…" },
  { key: "merma", label: "Dañada / no vendible", sign: -1, needsNote: true, hint: "Prenda malograda, manchada, perdida o que ya no se puede vender." },
  { key: "regalo", label: "Regalo", sign: -1, needsNote: true, hint: "Se regaló (influencer, cortesía, sorteo). Escribe a quién." },
  { key: "ajuste", label: "Conteo", sign: 0, hint: "Contaste las prendas: escribe cuántas hay en total. Si alguien vende mientras cuentas, te avisa." },
];

const StockMovementSheet = ({ product, variant, settings, onClose, onSubmit }) => {
  const locs = stockLocations(settings);
  const sb = variantStockBy(variant);
  const [loc, setLoc] = useState("principal");
  const [type, setType] = useState("entrada");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const t = MOVEMENT_TYPES.find((x) => x.key === type);
  const n = Math.max(0, parseInt(qty || "0", 10) || 0);
  const here = Number(sb[loc]) || 0;
  const newStock = t.sign > 0 ? variant.stock + n : t.sign < 0 ? variant.stock - n : variant.stock - here + n;
  const tooMany = t.sign < 0 && n > here;
  const canSubmit = qty !== "" && (type === "ajuste" || n > 0) && !tooMany && (!t.needsNote || note.trim().length >= 3) && !busy;

  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 55, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paperDeep, borderRadius: "18px 18px 0 0", padding: "20px 22px 28px", animation: "slideUp .25s ease", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 2 }}>{product.name}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 18 }}>Talla {variant.size} · {variant.colorName}{variant.sku ? ` · ${variant.sku}` : ""} · Stock actual: {variant.stock}</div>

        <span style={labelStyle}>¿Qué pasó?</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {MOVEMENT_TYPES.map((x) => (
            <button key={x.key} onClick={() => setType(x.key)} style={{ padding: "9px 13px", borderRadius: 8, border: `1px solid ${type === x.key ? C.ink : C.line}`, background: type === x.key ? C.ink : "transparent", color: type === x.key ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>{x.label}</button>
          ))}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 16, marginTop: -8, lineHeight: 1.45 }}>{t.hint}</div>

        {locs.length > 1 && (
          <Field label="¿Dónde?">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {locs.map((l) => <button key={l.id} type="button" onClick={() => setLoc(l.id)} style={{ padding: "9px 13px", borderRadius: 8, border: `1px solid ${loc === l.id ? C.ink : C.line}`, background: loc === l.id ? C.ink : "transparent", color: loc === l.id ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>{l.name} ({Number(sb[l.id]) || 0})</button>)}
            </div>
          </Field>
        )}
        <Field label={type === "ajuste" ? `Cuántas hay en ${locationName(settings, loc)} (contadas) *` : "Cantidad *"}>
          <input inputMode="numeric" style={inputStyle} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0" />
        </Field>
        <Field label={t.needsNote ? "Motivo *" : "Nota (opcional)"}><input style={inputStyle} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder={type === "regalo" ? "Ej. regalo a @influencer" : type === "merma" ? "Ej. mancha que no sale" : "Ej. reposición proveedor"} /></Field>

        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: tooMany ? C.accent : C.inkSoft, marginBottom: 18 }}>
          {tooMany ? `En ${locationName(settings, loc)} solo hay ${here}.` : <>Quedará en total: <strong>{newStock}</strong></>}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <PrimaryButton disabled={!canSubmit} style={{ flex: 2, width: "auto" }} onClick={async () => {
            setBusy(true);
            const ok = await onSubmit({ type, qty: n, note: note.trim(), expected: locs.length > 1 ? here : variant.stock, newStock, location: locs.length > 1 ? loc : null });
            setBusy(false);
            if (ok) onClose();
          }}>{busy ? "Guardando…" : "Registrar"}</PrimaryButton>
        </div>
        <Faltan center items={[(qty === "" || (type !== "ajuste" && n <= 0)) && (type === "ajuste" ? "escribe cuántas contaste" : "escribe la cantidad (mayor que 0)"), t.needsNote && note.trim().length < 3 && "escribe el motivo"]} />
      </div>
    </div>
  );
};

// ---- Sedes donde se guarda el stock (Larco = tienda, Almacén). La web vende de todas; la caja de Larco, de Larco ----
const DEFAULT_LOCATIONS = [{ id: "principal", name: "Larco" }, { id: "almacen", name: "Almacén" }];
const stockLocations = (settings) => (Array.isArray(settings?.locations) && settings.locations.length ? settings.locations : DEFAULT_LOCATIONS);
const locationName = (settings, id) => stockLocations(settings).find((l) => l.id === id)?.name || id;
const variantStockBy = (v) => (v?.stockBy && typeof v.stockBy === "object" ? v.stockBy : { principal: Number(v?.stock) || 0 });

// ---- Guías de traslado entre sedes: quien envía emite la guía (prendas EN CAMINO); la otra sede confirma al recibir ----
const fmtDT = (d) => (d ? new Date(d).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const TRANSFER_STATUS = { en_camino: "En camino", recibido: "Recibida", anulado: "Anulada" };
const TransferDoc = ({ t, settings }) => {
  const sent = t.items.reduce((a, i) => a + i.qty, 0);
  const got = t.items.reduce((a, i) => a + (i.received ?? 0), 0);
  const cell = { padding: "6px 4px", borderBottom: "1px solid #ddd", textAlign: "left", fontSize: 12 };
  return (
    <div className="print-area" style={{ background: "#fff", color: "#000", border: "1px solid #000", borderRadius: 10, padding: "16px 16px", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div><div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 22 }}>FLY</div><div style={{ fontSize: 11 }}>{settings?.company?.legalName || "Fly Boutique"}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 13, letterSpacing: "0.06em" }}>GUÍA DE TRASLADO INTERNO</div><div style={{ fontSize: 15, fontWeight: 700 }}>{t.code}</div><div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>{TRANSFER_STATUS[t.status]}</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px", fontSize: 12, margin: "14px 0" }}>
        <div><strong>Desde:</strong> {locationName(settings, t.from_loc)}</div><div><strong>Hacia:</strong> {locationName(settings, t.to_loc)}</div>
        <div><strong>Enviado:</strong> {fmtDT(t.created_at)}</div><div><strong>Por:</strong> {t.created_by || "—"}</div>
        {t.status === "recibido" && <><div><strong>Recibido:</strong> {fmtDT(t.received_at)}</div><div><strong>Por:</strong> {t.received_by || "—"}</div></>}
        {t.status === "anulado" && <><div><strong>Anulado:</strong> {fmtDT(t.voided_at)}</div><div><strong>Por:</strong> {t.voided_by || "—"} · {t.void_reason}</div></>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
          <thead><tr><th style={cell}>Código</th><th style={cell}>Prenda</th><th style={cell}>Talla / color</th><th style={{ ...cell, textAlign: "right" }}>Enviado</th><th style={{ ...cell, textAlign: "right" }}>Recibido</th></tr></thead>
          <tbody>{t.items.map((i) => <tr key={i.variantId}><td style={cell}>{i.sku || "—"}</td><td style={cell}>{i.name}</td><td style={cell}>{i.size} · {i.color}</td><td style={{ ...cell, textAlign: "right" }}>{i.qty}</td><td style={{ ...cell, textAlign: "right", fontWeight: i.received != null && i.received < i.qty ? 700 : 400 }}>{i.received ?? "—"}</td></tr>)}</tbody>
          <tfoot><tr><td style={cell} colSpan={3}><strong>Total</strong></td><td style={{ ...cell, textAlign: "right" }}><strong>{sent}</strong></td><td style={{ ...cell, textAlign: "right" }}><strong>{t.status === "recibido" ? got : "—"}</strong></td></tr></tfoot>
        </table>
      </div>
      {t.note && <div style={{ fontSize: 12, marginTop: 10 }}><strong>Nota:</strong> {t.note}</div>}
      {t.receive_note && <div style={{ fontSize: 12, marginTop: 4 }}><strong>Al recibir:</strong> {t.receive_note}</div>}
      {t.status === "recibido" && got < sent && <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700 }}>{sent - got === 1 ? "Faltó 1 prenda." : `Faltaron ${sent - got} prendas.`}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 30, fontSize: 11, textAlign: "center" }}>
        <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>Entrega</div><div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>Recibe</div>
      </div>
    </div>
  );
};

const TransfersScreen = ({ catalog, role, refreshData }) => {
  const settings = catalog.settings;
  const locs = stockLocations(settings);
  const canSend = ["superadmin", "administrador", "almacen", "cajero"].includes(role);
  const [list, setList] = useState(null);
  const [view, setView] = useState(null); // guía abierta
  const [mode, setMode] = useState("list"); // list | new | receive
  const [from, setFrom] = useState(role === "almacen" ? "almacen" : locs[0].id);
  const [to, setTo] = useState(role === "almacen" ? "principal" : (locs.find((l) => l.id !== locs[0].id) || locs[0]).id);
  const [q, setQ] = useState("");
  const [lines, setLines] = useState([]); // {variant, product, qty}
  const [note, setNote] = useState("");
  const [recv, setRecv] = useState({});
  const [recvNote, setRecvNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data, error } = await supabase.from("stock_transfers").select("*").order("id", { ascending: false }).limit(200);
    setList(error ? (error.code === "42P01" || error.code === "PGRST205" ? "no" : []) : data || []);
  };
  useEffect(() => { load(); }, []);
  const errText = (m) => m.includes("STOCK_INSUFICIENTE") ? `No alcanza: ${m.split("STOCK_INSUFICIENTE:")[1]?.replace(/:(\d+)$/, " (hay $1 en esa sede)") || ""}.` : m.includes("MOTIVO_FALTANTE") ? "Si falta algo, escribe qué pasó." : m.includes("GUIA_YA_CERRADA") ? "Esta guía ya fue recibida o anulada." : m.includes("SIN_PERMISO") ? "Tu usuario no puede hacer esto." : m;
  if (list === "no") return <div style={{ padding: "18px 18px 90px", fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Falta correr el SQL 19 en Supabase para usar las guías de traslado.</div>;

  // --- ver una guía
  if (view) {
    const t = view;
    const startReceive = () => { setRecv(Object.fromEntries(t.items.map((i) => [i.variantId, String(i.qty)]))); setRecvNote(""); setMode("receive"); };
    const missing = t.items.reduce((a, i) => a + Math.max(0, i.qty - (parseInt(recv[i.variantId] || "0", 10) || 0)), 0);
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        <button onClick={() => { setView(null); setMode("list"); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver a Traslados</button>
        <TransferDoc t={t} settings={settings} />
        {mode === "receive" ? (
          <AdminCard style={{ marginTop: 14 }}>
            <span style={labelStyle}>Confirmar lo que llegó</span>
            {t.items.map((i) => (
              <div key={i.variantId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
                <span style={{ minWidth: 0 }}>{i.name} · {i.size} {i.color} <span style={{ color: C.stone }}>(enviadas {i.qty})</span></span>
                <input inputMode="numeric" value={recv[i.variantId] ?? ""} onChange={(e) => setRecv({ ...recv, [i.variantId]: e.target.value.replace(/\D/g, "").slice(0, 4) })} aria-label={`Recibidas de ${i.name}`} style={{ ...inputStyle, width: 64, padding: "6px 8px", textAlign: "center" }} />
              </div>
            ))}
            {missing > 0 && <Field label={`Faltan ${missing}: ¿qué pasó? *`}><input style={inputStyle} maxLength={200} value={recvNote} onChange={(e) => setRecvNote(e.target.value)} placeholder="Ej. llegó una con mancha y se quedó en almacén" /></Field>}
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => setMode("list")} style={{ flex: 1, padding: "13px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer", color: C.ink }}>Cancelar</button>
              <PrimaryButton disabled={busy || (missing > 0 && recvNote.trim().length < 3)} style={{ flex: 2, width: "auto" }} onClick={async () => {
                setBusy(true);
                const { data, error } = await supabase.rpc("receive_transfer", { p_id: t.id, p_received: Object.fromEntries(Object.entries(recv).map(([k, v]) => [k, parseInt(v || "0", 10) || 0])), p_note: recvNote.trim() || null });
                setBusy(false);
                if (error) { alert("No se pudo recibir: " + errText(error.message || "")); return; }
                setView(data); setMode("list"); load(); refreshData && refreshData();
              }}>{busy ? "Guardando…" : "Confirmar recepción"}</PrimaryButton>
            </div>
            <Faltan center items={[missing > 0 && recvNote.trim().length < 3 && "escribe qué pasó con lo que falta"]} />
          </AdminCard>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button onClick={() => window.print()} style={{ ...quickLinkStyle, flex: 1, justifyContent: "center" }}><Receipt size={15} /> Imprimir guía</button>
            {t.status === "en_camino" && <PrimaryButton style={{ flex: 2, width: "auto" }} onClick={startReceive}>Recibir en {locationName(settings, t.to_loc)}</PrimaryButton>}
            {t.status === "en_camino" && canSend && <button onClick={async () => {
              const why = prompt("¿Por qué anulas la guía? Las prendas vuelven a " + locationName(settings, t.from_loc) + ".", "Error al emitirla");
              if (!why || !why.trim()) return;
              const { data, error } = await supabase.rpc("cancel_transfer", { p_id: t.id, p_reason: why.trim() });
              if (error) { alert("No se pudo anular: " + errText(error.message || "")); return; }
              setView(data); load(); refreshData && refreshData();
            }} style={{ padding: "11px 14px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Anular guía</button>}
          </div>
        )}
      </div>
    );
  }

  // --- nueva guía
  if (mode === "new") {
    const nq = q.trim().toLowerCase();
    const options = nq.length < 2 ? [] : catalog.products.flatMap((p) => p.variants.map((v) => ({ p, v }))).filter(({ p, v }) => `${p.name} ${v.sku || ""} ${v.size} ${v.colorName}`.toLowerCase().includes(nq)).slice(0, 12);
    const availAt = (v) => Number(variantStockBy(v)[from]) || 0;
    const add = (p, v) => { setLines((ls) => ls.some((l) => l.v.id === v.id) ? ls : [...ls, { p, v, qty: "1" }]); setQ(""); };
    const onScan = (e) => { if (e.key !== "Enter") return; const code = q.trim().toLowerCase(); for (const p of catalog.products) { const v = p.variants.find((x) => (x.sku || "").toLowerCase() === code); if (v) { add(p, v); return; } } };
    const bad = lines.find((l) => !(parseInt(l.qty, 10) > 0) || parseInt(l.qty, 10) > availAt(l.v));
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        <button onClick={() => setMode("list")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 14px" }}>Nueva guía de traslado</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 140px" }}><Field label="Desde"><select style={inputStyle} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value === to) setTo(locs.find((l) => l.id !== e.target.value)?.id || to); setLines([]); }}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field></div>
          <div style={{ flex: "1 1 140px" }}><Field label="Hacia"><select style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)}>{locs.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field></div>
        </div>
        <Field label="Agregar prendas"><input style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScan} placeholder="Escanea el código + Enter, o busca por nombre" /></Field>
        {options.length > 0 && (
          <AdminCard style={{ marginBottom: 12, padding: 8 }}>
            {options.map(({ p, v }) => <button key={v.id} onClick={() => add(p, v)} disabled={availAt(v) <= 0} style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 8, padding: "8px 6px", background: "none", border: "none", borderBottom: `1px solid ${C.paperDeep}`, cursor: availAt(v) > 0 ? "pointer" : "default", fontFamily: FONT_BODY, fontSize: 12.5, color: availAt(v) > 0 ? C.ink : C.stone, textAlign: "left" }}><span>{p.name} · {v.size} {v.colorName}{v.sku ? ` · ${v.sku}` : ""}</span><span>hay {availAt(v)}</span></button>)}
          </AdminCard>
        )}
        {lines.map((l) => (
          <div key={l.v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
            <span style={{ flex: 1, minWidth: 0 }}>{l.p.name} · {l.v.size} {l.v.colorName}<span style={{ display: "block", fontSize: 11, color: parseInt(l.qty, 10) > availAt(l.v) ? C.accent : C.stone }}>En {locationName(settings, from)}: {availAt(l.v)}</span></span>
            <input inputMode="numeric" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => x.v.id === l.v.id ? { ...x, qty: e.target.value.replace(/\D/g, "").slice(0, 4) } : x))} aria-label={`Cantidad de ${l.p.name}`} style={{ ...inputStyle, width: 64, padding: "6px 8px", textAlign: "center" }} />
            <button onClick={() => setLines((ls) => ls.filter((x) => x.v.id !== l.v.id))} aria-label="Quitar" style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={15} color={C.stone} /></button>
          </div>
        ))}
        <Field label="Nota (opcional)"><input style={inputStyle} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. reposición para el fin de semana" /></Field>
        <PrimaryButton disabled={busy || !lines.length || !!bad} onClick={async () => {
          setBusy(true);
          const { data, error } = await supabase.rpc("create_transfer", { p_from: from, p_to: to, p_items: lines.map((l) => ({ variantId: l.v.id, qty: parseInt(l.qty, 10) })), p_note: note.trim() || null });
          setBusy(false);
          if (error) { alert("No se pudo emitir la guía: " + errText(error.message || "")); return; }
          setLines([]); setNote(""); setMode("list"); setView(data); load(); refreshData && refreshData();
        }}>{busy ? "Emitiendo…" : `Emitir guía (${lines.reduce((a, l) => a + (parseInt(l.qty, 10) || 0), 0)} prendas)`}</PrimaryButton>
        <Faltan center items={[!lines.length && "agrega al menos una prenda", bad && (!(parseInt(bad.qty, 10) > 0) ? `pon una cantidad mayor que 0 en «${bad.p.name}»` : `baja la cantidad de «${bad.p.name}» (en ${locationName(settings, from)} hay ${availAt(bad.v)})`)]} />
      </div>
    );
  }

  // --- lista
  const pending = (list || []).filter((t) => t.status === "en_camino");
  const done = (list || []).filter((t) => t.status !== "en_camino");
  const row = (t) => (
    <button key={t.id} onClick={() => setView(t)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", marginBottom: 8, borderRadius: 10, border: `1px solid ${t.status === "en_camino" ? C.ink : C.line}`, background: C.paper, cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{t.code} · {locationName(settings, t.from_loc)} → {locationName(settings, t.to_loc)}</span>
        <span style={{ display: "block", fontSize: 11.5, color: C.stone }}>{t.items.reduce((a, i) => a + i.qty, 0)} prendas · enviada {fmtDT(t.created_at)} por {t.created_by}{t.status === "recibido" ? ` · recibida por ${t.received_by}` : ""}</span>
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: t.status === "anulado" ? C.stone : C.ink, whiteSpace: "nowrap" }}>{TRANSFER_STATUS[t.status]}</span>
    </button>
  );
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: 0 }}>Traslados</h1>
        {canSend && <button onClick={() => { setLines([]); setMode("new"); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nueva guía</button>}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 16 }}>Las prendas de una guía quedan en camino (no se venden) hasta que la otra sede confirma que llegaron.</div>
      {list === null ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Cargando…</div> : (
        <>
          <span style={labelStyle}>En camino ({pending.length})</span>
          {pending.length ? pending.map(row) : <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 16 }}>No hay guías por recibir.</div>}
          <span style={labelStyle}>Historial</span>
          {done.length ? done.map(row) : <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Aún no hay guías.</div>}
        </>
      )}
    </div>
  );
};

// ---- Facturación electrónica (SQL 25): configuración de Nubefact y estado de cada comprobante ----
const EInvoiceScreen = ({ catalog, role }) => {
  const isSuper = role === "superadmin";
  const [st, setSt] = useState(null); // null cargando | "no" falta SQL 25 | estado
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState(null); // null = falta el SQL 26
  const [ncForm, setNcForm] = useState({ b: "", f: "" });
  const [form, setForm] = useState({ ruta: "", token: "", sb: "", sf: "", nb: "", nf: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data, error } = await supabase.rpc("einvoice_status");
    if (error) { setSt("no"); return; }
    einvConfigCache = data;
    setSt(data); setForm((f) => ({ ...f, ruta: data.ruta || "", sb: data.serieBoleta, sf: data.serieFactura, nb: "", nf: "" }));
    const r = await supabase.from("einvoices").select("*").order("updated_at", { ascending: false }).limit(200);
    setRows(r.data || []);
    const nr = await supabase.from("einvoice_notes").select("*").order("updated_at", { ascending: false }).limit(100);
    setNotes(nr.error ? null : nr.data || []);
  };
  const saveNcSeries = async () => {
    setBusy("nc"); setMsg("");
    const { data, error } = await supabase.rpc("set_credit_note_series", { p_boleta: ncForm.b.trim() || null, p_factura: ncForm.f.trim() || null });
    setBusy("");
    if (error) { setMsg(error.message.includes("SERIE_INVALIDA") ? "Series de notas: 4 caracteres; para boletas empieza con B (ej. BC01) y para facturas con F (ej. FC01)." : error.message); return; }
    setNcForm({ b: "", f: "" }); setMsg(`✓ Series de notas: ${data.boleta} y ${data.factura}`);
  };
  useEffect(() => { load(); }, []);
  if (st === "no") return <div style={{ padding: "18px 18px 90px", fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Falta correr el SQL 25 (facturación electrónica) en Supabase.</div>;
  if (!st) return <div style={{ padding: "18px 18px 90px", fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Cargando…</div>;
  const hint = { fontFamily: FONT_BODY, fontSize: 12, color: C.stone, lineHeight: 1.55 };
  const saveCfg = async (tokenValue) => {
    setBusy("cfg"); setMsg("");
    const { data, error } = await supabase.rpc("set_einvoice_config", { p_ruta: form.ruta.trim() || null, p_token: tokenValue, p_serie_boleta: form.sb.trim() || null, p_serie_factura: form.sf.trim() || null,
      p_auto: null, p_next_boleta: form.nb ? Number(form.nb) : null, p_next_factura: form.nf ? Number(form.nf) : null });
    setBusy("");
    if (error) { setMsg(({ RUTA_INVALIDA: "La RUTA debe empezar con https://", SERIE_INVALIDA: "Serie: 4 caracteres; boletas empiezan con B y facturas con F (ej. B001, F001).", NUMERO_INVALIDO: "El siguiente número no puede ser menor a uno ya usado.", SIN_PERMISO: "Solo Super Admin." })[Object.keys({ RUTA_INVALIDA: 1, SERIE_INVALIDA: 1, NUMERO_INVALIDO: 1, SIN_PERMISO: 1 }).find((k) => error.message.includes(k))] || error.message); return; }
    einvConfigCache = data; setSt(data); setForm((f) => ({ ...f, token: "", nb: "", nf: "" })); setMsg("✓ Guardado");
  };
  const toggleAuto = async () => { const { data, error } = await supabase.rpc("set_einvoice_config", { p_ruta: null, p_token: null, p_auto: !st.auto }); if (!error) { einvConfigCache = data; setSt(data); } };
  const act = async (fn, args, key) => {
    setBusy(key); setMsg("");
    const { data, error } = await supabase.rpc(fn, args);
    setBusy("");
    if (error) { setMsg(einvErr(error.message)); return null; }
    if (data?.reason) { setMsg(einvErr(data.reason)); return null; }
    await load(); return data;
  };
  const sentIds = new Set(rows.map((r) => r.sale_id));
  const weekAgo = Date.now() - 7 * 86400000;
  const pending = (catalog.sales || []).filter((x) => x.status !== "anulado" && (x.createdAt || 0) >= weekAgo && !sentIds.has(x.id) && !x.einvoice && (x.source !== "web" || x.paymentStatus === "confirmado")).slice(0, 50);
  const sendAll = async () => { for (const x of pending) { if (!(await act("emit_einvoice", { p_sale_id: x.id }, "all"))) break; } };
  const counts = st.counts || {};
  const chip = (status) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", color: ["rechazado", "error"].includes(status) ? C.accent : C.ink }}>{EINV_LABEL[status] || status}</span>;
  const smallBtn = { padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer", color: C.ink };
  return (
    <div style={{ padding: "18px 18px 90px", maxWidth: 760 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Facturación electrónica</h1>
      <div style={{ ...hint, marginBottom: 14 }}>Boletas y facturas oficiales con Nubefact. Cada venta se envía sola al terminar el cobro. Nada se marca «aceptado» sin la respuesta de SUNAT, y si se corta la conexión al reintentar no se duplica.</div>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Estado</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: st.configured ? C.ink : C.accent }}>{st.configured ? `✓ Conectado a Nubefact · series ${st.serieBoleta} y ${st.serieFactura}` : "Apagado: falta la RUTA y el TOKEN de Nubefact"}</div>
        {st.configured && <div style={{ ...hint, marginTop: 4 }}>Siguiente boleta: {st.serieBoleta}-{st.nextBoleta} · siguiente factura: {st.serieFactura}-{st.nextFactura}</div>}
        {Object.keys(counts).length > 0 && <div style={{ ...hint, marginTop: 4 }}>{Object.entries(counts).map(([k, n]) => `${EINV_LABEL[k] || k}: ${n}`).join(" · ")}</div>}
        {st.configured && isSuper && <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginTop: 10 }}><input type="checkbox" checked={st.auto} onChange={toggleAuto} /> Enviar solo al terminar cada venta en caja</label>}
      </AdminCard>
      {isSuper && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Datos de Nubefact</span>
          <div style={{ ...hint, marginBottom: 10 }}>En Nubefact: menú <strong>API (Integración)</strong>. Copia la <strong>RUTA</strong> y el <strong>TOKEN</strong> y pégalos aquí. El token se guarda solo en el servidor y no se vuelve a mostrar. Usa las mismas series que tienes creadas en Nubefact.</div>
          <Field label="RUTA"><input style={inputStyle} value={form.ruta} onChange={(e) => setForm({ ...form, ruta: e.target.value })} placeholder="https://api.nubefact.com/api/v1/…" /></Field>
          <Field label={st.configured ? "TOKEN (déjalo vacío para no cambiarlo)" : "TOKEN"}><input type="password" autoComplete="off" style={inputStyle} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="Pega aquí el token" /></Field>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 120px" }}><Field label="Serie boletas"><input style={inputStyle} value={form.sb} maxLength={4} onChange={(e) => setForm({ ...form, sb: e.target.value.toUpperCase() })} /></Field></div>
            <div style={{ flex: "1 1 120px" }}><Field label="Serie facturas"><input style={inputStyle} value={form.sf} maxLength={4} onChange={(e) => setForm({ ...form, sf: e.target.value.toUpperCase() })} /></Field></div>
          </div>
          <details style={{ marginBottom: 10 }}>
            <summary style={{ ...hint, cursor: "pointer" }}>¿Ya emitiste comprobantes desde la web de Nubefact? Cambia el siguiente número</summary>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <div style={{ flex: "1 1 120px" }}><Field label={`Siguiente boleta (hoy ${st.nextBoleta})`}><input inputMode="numeric" style={inputStyle} value={form.nb} onChange={(e) => setForm({ ...form, nb: e.target.value.replace(/\D/g, "") })} /></Field></div>
              <div style={{ flex: "1 1 120px" }}><Field label={`Siguiente factura (hoy ${st.nextFactura})`}><input inputMode="numeric" style={inputStyle} value={form.nf} onChange={(e) => setForm({ ...form, nf: e.target.value.replace(/\D/g, "") })} /></Field></div>
            </div>
          </details>
          <PrimaryButton disabled={busy === "cfg" || (!st.configured && (!form.ruta.trim() || !form.token.trim()))} onClick={() => saveCfg(form.token.trim() || null)}>{busy === "cfg" ? "Guardando…" : "Guardar"}</PrimaryButton>
          {!st.configured && <Faltan center items={[!form.ruta.trim() && "pega la RUTA", !form.token.trim() && "pega el TOKEN"]} />}
          {st.configured && <button onClick={() => { if (confirm("¿Apagar la facturación electrónica? Se borra el token guardado. Los comprobantes ya emitidos no cambian.")) saveCfg("-"); }} style={{ marginTop: 10, width: "100%", padding: "11px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Apagar (borrar token)</button>}
        </AdminCard>
      )}
      {msg && <div role="status" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: msg.startsWith("✓") ? C.ink : C.accent, marginBottom: 12 }}>{msg}</div>}
      {st.configured && pending.length > 0 && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Ventas de los últimos 7 días sin enviar ({pending.length})</span>
          {pending.slice(0, 8).map((x) => <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5 }}><span>{x.serie}-{String(x.numero).padStart(6, "0")} · {x.customerName || "Cliente varios"}</span><strong>{money2(x.total)}</strong></div>)}
          <PrimaryButton style={{ marginTop: 10 }} disabled={!!busy} onClick={sendAll}>{busy === "all" ? "Enviando…" : `Enviar ${pending.length} a SUNAT`}</PrimaryButton>
        </AdminCard>
      )}
      {notes && (notes.length > 0 || isSuper) && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>Notas de crédito (devoluciones)</span>
          <div style={{ ...hint, marginBottom: 8 }}>Al registrar una devolución de una venta que ya está en SUNAT, la nota de crédito se envía sola.</div>
          {notes.map((n) => (
            <div key={n.sale_id + n.return_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, flexWrap: "wrap" }}>
              <span>Nota {n.serie}-{n.numero} → {n.ref_serie}-{n.ref_numero} · {money2(n.total)}{n.last_error ? <span style={{ display: "block", fontSize: 11.5, color: C.accent }}>{n.last_error}</span> : null}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{chip(n.status)}
                {["preparado", "rechazado", "error"].includes(n.status) && <button disabled={!!busy} onClick={() => act("emit_credit_note", { p_sale_id: n.sale_id, p_return_id: n.return_id }, n.sale_id + n.return_id)} style={smallBtn}>Reintentar</button>}
                {n.pdf_url && <a href={n.pdf_url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: "none" }}>PDF</a>}
              </span>
            </div>
          ))}
          {isSuper && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ ...hint, cursor: "pointer" }}>Series de las notas (por defecto BC01 y FC01; usa las que tengas creadas en Nubefact)</summary>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                <input style={{ ...inputStyle, flex: "1 1 110px" }} maxLength={4} placeholder="Para boletas (BC01)" value={ncForm.b} onChange={(e) => setNcForm({ ...ncForm, b: e.target.value.toUpperCase() })} />
                <input style={{ ...inputStyle, flex: "1 1 110px" }} maxLength={4} placeholder="Para facturas (FC01)" value={ncForm.f} onChange={(e) => setNcForm({ ...ncForm, f: e.target.value.toUpperCase() })} />
                <button disabled={busy === "nc" || (!ncForm.b && !ncForm.f)} onClick={saveNcSeries} style={{ ...smallBtn, padding: "0 14px" }}>Guardar</button>
              </div>
            </details>
          )}
        </AdminCard>
      )}
      <span style={labelStyle}>Comprobantes</span>
      {rows.length === 0 ? <div style={hint}>Aún no hay comprobantes electrónicos.</div> : rows.map((r) => (
        <div key={r.sale_id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <strong>{r.tipo === 1 ? "Factura" : "Boleta"} {r.serie}-{r.numero}</strong>{chip(r.status)}
          </div>
          <div style={{ ...hint, fontSize: 11.5 }}>{fmtDT(r.updated_at)} · {r.created_by || ""}{r.attempts > 1 ? ` · ${r.attempts} intentos` : ""}{r.void_reason ? ` · anulada: ${r.void_reason}` : ""}</div>
          {r.last_error && <div style={{ fontSize: 11.5, color: C.accent, marginTop: 2 }}>{r.last_error}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {["preparado", "rechazado", "error"].includes(r.status) && <button disabled={!!busy} onClick={() => act("emit_einvoice", { p_sale_id: r.sale_id }, r.sale_id)} style={smallBtn}>{busy === r.sale_id ? "…" : "Reintentar"}</button>}
            {["enviado", "anulacion_pendiente", "aceptado"].includes(r.status) && <button disabled={!!busy} onClick={() => act("refresh_einvoice", { p_sale_id: r.sale_id }, r.sale_id)} style={smallBtn}>{busy === r.sale_id ? "…" : "Actualizar estado"}</button>}
            {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: "none" }}>PDF</a>}
            {["aceptado", "enviado"].includes(r.status) && <button disabled={!!busy} onClick={() => { const why = prompt(`¿Por qué anulas ${r.serie}-${r.numero} en SUNAT? (máx. 100 letras)`, "Error en los datos del comprobante"); if (why && why.trim()) act("void_einvoice", { p_sale_id: r.sale_id, p_reason: why.trim() }, r.sale_id); }} style={{ ...smallBtn, borderColor: C.accent, color: C.accent }}>Anular en SUNAT</button>}
          </div>
        </div>
      ))}
    </div>
  );
};

// ---- Copia de las fotos y videos (Storage no entra en la copia de datos) ----
// Registro de actividad: quién hizo qué y cuándo (tabla audit_log; solo la ven Super Admin y Administrador).
// Solo lectura: nada se puede editar ni borrar desde aquí.
const ACTIVITY_GROUPS = [
  ["caja", "Caja", (a) => a.startsWith("caja_")],
  ["ventas", "Ventas y devoluciones", (a) => /^(venta_|pago_validado|devolucion|cambio_prendas|vale_|puntos_)/.test(a)],
  ["comprobantes", "Comprobantes SUNAT", (a) => /^(comprobante_|nota_credito_|facturacion_config)/.test(a)],
  ["inventario", "Inventario y compras", (a) => /^(guia_|traslado_|compra_|costo_|gasto_)/.test(a)],
  ["equipo", "Equipo y configuración", (a) => /^(usuario_|vendedor_|consulta_doc_config|permiso_publicidad)/.test(a)],
];
const ACTIVITY_EXTRA = { caja_entrada: "Entrada de dinero", caja_salida: "Salida de dinero", devolucion: "Devolución", cambio_prendas: "Cambio de prendas", vale_creado: "Vale creado", vale_anulado: "Vale anulado", puntos_canjeados: "Puntos canjeados", comprobante_aceptado: "Comprobante aceptado por SUNAT", comprobante_enviado: "Comprobante enviado", comprobante_rechazado: "Comprobante rechazado", comprobante_error: "Comprobante con error", comprobante_anulado: "Comprobante anulado", nota_credito_aceptado: "Nota de crédito aceptada", nota_credito_enviado: "Nota de crédito enviada", nota_credito_rechazado: "Nota de crédito rechazada", nota_credito_error: "Nota de crédito con error", facturacion_config: "Configuración de facturación", consulta_doc_config: "Configuración DNI/RUC", permiso_publicidad: "Permiso de publicidad", vendedor_guardado: "Vendedor guardado" };
const activityLabel = (a) => ACTION_LABELS[a] || ACTIVITY_EXTRA[a] || String(a || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const ACTIVITY_KEYS = { venta: "Venta", comprobante: "Comprobante", nota: "Nota", modifica: "Modifica", guia: "Guía", motivo: "Motivo", total: "Total", monto: "Monto", amount: "Monto", detalle: "Detalle", codigo: "Código", code: "Código", reason: "Motivo", token: "Token", sede: "Sede", diferencia: "Diferencia", difference: "Diferencia", serie: "Serie", numero: "Número" };
const activityDetail = (d) => {
  if (!d || typeof d !== "object") return "";
  return Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object").slice(0, 6)
    .map(([k, v]) => `${ACTIVITY_KEYS[k] || k}: ${typeof v === "number" && /total|monto|amount|diferencia|difference/i.test(k) ? money(v) : v}`).join(" · ");
};
const ActivityScreen = () => {
  const PAGE = 200;
  const [period, setPeriod] = useState("7");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [who, setWho] = useState("");
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const since = (p) => { if (p === "todo") return null; const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (Number(p) - 1)); return d.toISOString(); };
  const load = async (append) => {
    setLoading(true); setErr("");
    const from = append ? (rows || []).length : 0;
    let query = supabase.from("audit_log").select("id,at,user_name,action,details").order("at", { ascending: false }).range(from, from + PAGE - 1);
    const s0 = since(period); if (s0) query = query.gte("at", s0);
    const { data, error } = await query;
    setLoading(false);
    if (error) { setErr("No se pudo leer el registro: " + error.message); if (!append) setRows([]); return; }
    setRows(append ? [...(rows || []), ...(data || [])] : data || []);
    setMore((data || []).length === PAGE);
  };
  useEffect(() => { load(false); }, [period]);
  const people = useMemo(() => [...new Set((rows || []).map((r) => r.user_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [rows]);
  const nq = normTxt(q.trim());
  const shown = (rows || []).filter((r) => (!who || r.user_name === who)
    && (!group || (ACTIVITY_GROUPS.find(([k]) => k === group)?.[2](r.action || "")))
    && (!nq || normTxt(`${activityLabel(r.action)} ${r.user_name || ""} ${activityDetail(r.details)}`).includes(nq)));
  const days = [];
  shown.forEach((r) => { const k = new Date(r.at).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" }); if (!days.length || days[days.length - 1][0] !== k) days.push([k, []]); days[days.length - 1][1].push(r); });
  const exportCsv = () => {
    const out = [["Fecha", "Persona", "Acción", "Detalle"], ...shown.map((r) => [new Date(r.at).toLocaleString("es-PE"), r.user_name || "", activityLabel(r.action), activityDetail(r.details)])];
    const csv = "﻿" + out.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `actividad-fly-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  const sel = { ...inputStyle, padding: "9px 10px" };
  return (
    <div style={{ padding: "18px 18px 40px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Registro de actividad</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft, marginBottom: 14, lineHeight: 1.5 }}>Quién hizo cada cambio importante: cajas, anulaciones, devoluciones, comprobantes, guías, compras y configuración. Solo lectura.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[["1", "Hoy"], ["7", "7 días"], ["30", "30 días"], ["todo", "Todo"]].map(([k, l]) => <Chip key={k} active={period === k} onClick={() => setPeriod(k)}>{l}</Chip>)}
      </div>
      <div className="activity-filters" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <select aria-label="Persona" value={who} onChange={(e) => setWho(e.target.value)} style={sel}><option value="">Todas las personas</option>{people.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select aria-label="Tipo" value={group} onChange={(e) => setGroup(e.target.value)} style={sel}><option value="">Todo tipo</option>{ACTIVITY_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar (ej. B001-25, anulada, María)" style={{ ...inputStyle, marginBottom: 12 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>
        <span>{rows === null ? "Cargando…" : `${shown.length} ${shown.length === 1 ? "registro" : "registros"}`}</span>
        {shown.length > 0 && <button onClick={exportCsv} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink }}><Download size={13} /> Excel (CSV)</button>}
      </div>
      {err && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.accent, marginBottom: 10 }}>{err}</div>}
      {rows !== null && !shown.length && !err && <AdminCard><div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>No hay actividad con estos filtros.</div></AdminCard>}
      {days.map(([d, list]) => (
        <div key={d} style={{ marginBottom: 14 }}>
          <span style={labelStyle}>{d}</span>
          <AdminCard style={{ padding: "4px 14px" }}>
            {list.map((r) => (
              <div key={r.id} className="activity-row" style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>
                  <strong style={{ fontWeight: 600, color: /anulad|rechazad|error|salida/.test(r.action || "") ? C.accent : C.ink }}>{activityLabel(r.action)}</strong>
                  <span style={{ color: C.stone, whiteSpace: "nowrap", fontSize: 12 }}>{new Date(r.at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginTop: 2, wordBreak: "break-word" }}>{r.user_name || "Sistema"}{activityDetail(r.details) ? ` · ${activityDetail(r.details)}` : ""}</div>
              </div>
            ))}
          </AdminCard>
        </div>
      ))}
      {more && <button onClick={() => load(true)} disabled={loading} style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${C.ink}`, background: C.paper, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600 }}>{loading ? "Cargando…" : "Cargar más"}</button>}
    </div>
  );
};

// Diagnóstico del equipo: lo que anotó este celular/computadora (errores, ratos trabada, recargas forzadas). Solo en este equipo.
const DiagnosticScreen = () => {
  const read = () => { try { return JSON.parse(localStorage.getItem("fly:diagnostico") || "[]"); } catch (e) { return []; } };
  const [list, setList] = useState(read);
  const info = (() => {
    const n = navigator; const sw = window.screen || {};
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || n.standalone === true;
    return [["Equipo", n.userAgent], ["Pantalla", `${sw.width}×${sw.height} · ventana ${window.innerWidth}×${window.innerHeight}`], ["Modo", standalone ? "App instalada" : "Navegador"],
      ["Memoria del equipo", n.deviceMemory ? `${n.deviceMemory} GB` : "No informa"], ["Conexión", n.connection?.effectiveType || "No informa"], ["Versión de Fly", (document.querySelector('script[src*="/assets/index-"]')?.getAttribute("src") || "desarrollo").split("/").pop()]];
  })();
  const TIPOS = { error: "Error", trabada: "Se trabó", recarga: "Recarga forzada", pantalla: "Pantalla con error" };
  const text = () => [...info.map(([k, v]) => `${k}: ${v}`), "", ...list.map((x) => `${new Date(x.at).toLocaleString("es-PE")} · ${TIPOS[x.tipo] || x.tipo} · ${x.ruta} · ${x.detalle}`)].join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text()); alert("Copiado. Pégalo en el chat con Claude o por WhatsApp."); } catch (e) { prompt("Copia este texto:", text()); } };
  return (
    <div style={{ padding: "18px 18px 40px", maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Diagnóstico del equipo</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.inkSoft, lineHeight: 1.5, marginBottom: 14 }}>Si la página se traba o queda en blanco en este celular o computadora, aquí queda anotado. Toca «Copiar informe» y envíalo para revisarlo. No se envía nada solo.</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={copy} style={{ padding: "11px 16px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Copiar informe</button>
        <button onClick={() => setList(read())} style={{ padding: "11px 16px", borderRadius: 9, border: `1px solid ${C.ink}`, background: C.paper, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}>Actualizar</button>
        <button onClick={() => { if (confirm("¿Borrar lo anotado en este equipo?")) { try { localStorage.removeItem("fly:diagnostico"); } catch (e) { /* nada */ } setList([]); } }} style={{ padding: "11px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.paper, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}>Borrar</button>
      </div>
      <AdminCard style={{ marginBottom: 14 }}>
        {info.map(([k, v]) => <div key={k} style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink, padding: "4px 0", wordBreak: "break-word" }}><strong>{k}:</strong> {v}</div>)}
      </AdminCard>
      <span style={labelStyle}>Últimos problemas ({list.length})</span>
      {!list.length ? <AdminCard><div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Nada anotado. ✓</div></AdminCard> : (
        <AdminCard style={{ padding: "4px 14px" }}>
          {list.map((x, i) => (
            <div key={i} style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong style={{ color: x.tipo === "info" ? C.ink : C.accent }}>{TIPOS[x.tipo] || x.tipo}</strong><span style={{ color: C.stone, whiteSpace: "nowrap" }}>{new Date(x.at).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>
              <div style={{ color: C.inkSoft, marginTop: 2, wordBreak: "break-word" }}>{x.detalle}</div>
              <div style={{ color: C.stone, fontSize: 11 }}>{x.ruta}</div>
            </div>
          ))}
        </AdminCard>
      )}
    </div>
  );
};

const PhotoBackupScreen = ({ catalog }) => {
  const [items, setItems] = useState(null);
  const [prog, setProg] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef(null);
  useEffect(() => { import("./fotos-copia.js").then((m) => setItems(m.collectMedia(catalog))).catch(() => setItems([])); }, [catalog]);
  const mb = (b) => `${(b / 1048576).toFixed(b > 104857600 ? 0 : 1)} MB`;
  const start = async () => {
    setBusy(true); setResult(null); setProg({ done: 0, total: items.length, bytes: 0, part: 1, failed: 0 });
    ctrl.current = new AbortController();
    try {
      const m = await import("./fotos-copia.js");
      const r = await m.downloadMediaBackup(catalog, { onProgress: setProg, signal: ctrl.current.signal });
      setResult(r);
    } catch (e) { setResult({ error: e.name === "AbortError" ? "Cancelaste la copia. No se descargó ningún archivo de la parte en curso." : (e.message || String(e)) }); }
    setBusy(false);
  };
  const counts = (items || []).reduce((a, it) => { a[it.kind] = (a[it.kind] || 0) + 1; return a; }, {});
  const hint = { fontFamily: FONT_BODY, fontSize: 12, color: C.stone, lineHeight: 1.55 };
  return (
    <div style={{ padding: "18px 18px 90px", maxWidth: 640 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Copia de las fotos</h1>
      <div style={{ ...hint, marginBottom: 14 }}>La copia de datos (Más → Descargar copia de seguridad) no incluye las fotos ni los videos. Aquí se descargan todos en uno o varios archivos ZIP, con un índice que dice a qué producto y color va cada foto. Hazlo una vez al mes y cuando subas muchas fotos nuevas.</div>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Qué se va a guardar</span>
        {items === null ? <div style={hint}>Contando…</div> : (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, lineHeight: 1.7 }}>
            <strong>{items.length}</strong> archivos{Object.keys(counts).length ? ": " : ""}{Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(" · ")}
          </div>
        )}
        <div style={{ ...hint, marginTop: 6 }}>Las miniaturas no se guardan (se vuelven a crear con «Optimizar fotos»). Recomendado: en una computadora con wifi. Si son muchas, se descargan en partes de 300 MB: el navegador puede preguntar si permites varias descargas, toca «Permitir».</div>
      </AdminCard>
      {prog && (
        <AdminCard style={{ marginBottom: 14 }}>
          <span style={labelStyle}>{busy ? "Descargando…" : "Listo"}</span>
          <div style={{ height: 8, borderRadius: 999, background: C.paperDeep, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 100}%`, background: C.ink, transition: "width .3s ease" }} />
          </div>
          <div role="status" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{prog.done} de {prog.total} archivos · {mb(prog.bytes)} · parte {prog.part}{prog.failed ? <span style={{ color: C.accent }}> · {prog.failed} no se pudieron bajar</span> : null}</div>
        </AdminCard>
      )}
      {result && (
        <AdminCard style={{ marginBottom: 14 }}>
          {result.error ? <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.accent }}>{result.error}</div> : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, lineHeight: 1.6 }}>
              ✓ Copia lista: {result.done - result.failed} archivos ({mb(result.bytes)}) en {result.parts} {result.parts === 1 ? "archivo ZIP" : "archivos ZIP"}. Revisa tu carpeta de Descargas y guárdalos juntos en Google Drive.
              {result.failed > 0 && <div style={{ color: C.accent, marginTop: 6 }}>{result.failed} no se pudieron descargar (están en indice.csv con su dirección). Si son fotos de internet que ya no existen, conviene volver a subirlas al producto.</div>}
            </div>
          )}
        </AdminCard>
      )}
      {busy
        ? <button onClick={() => ctrl.current?.abort()} style={{ width: "100%", padding: "13px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
        : <PrimaryButton disabled={!items || !items.length} onClick={start}><Download size={16} /> Descargar copia de las fotos</PrimaryButton>}
    </div>
  );
};

// ---- Consulta DNI/RUC (SQL 24): Super Admin guarda el token del proveedor. El token nunca vuelve a mostrarse. ----
const DocApiScreen = () => {
  const [st, setSt] = useState(null); // null cargando | "no" falta SQL 24 | {configured, dniUrl, rucUrl, cached}
  const [token, setToken] = useState("");
  const [dniUrl, setDniUrl] = useState("");
  const [rucUrl, setRucUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [testNum, setTestNum] = useState("");
  const [testRes, setTestRes] = useState("");
  const load = async () => {
    const { data, error } = await supabase.rpc("doc_lookup_status");
    if (error) { setSt("no"); return; }
    setSt(data); setDniUrl(data.dniUrl || ""); setRucUrl(data.rucUrl || "");
  };
  useEffect(() => { load(); }, []);
  const msg = (m = "") => (m.includes("URL_INVALIDA") ? "La dirección debe empezar con https:// y tener {n} donde va el número." : m.includes("SIN_PERMISO") ? "Solo Super Admin puede cambiar esto." : m);
  const save = async (tok) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_doc_lookup_config", { p_token: tok, p_dni_url: dniUrl.trim(), p_ruc_url: rucUrl.trim() });
    setBusy(false);
    if (error) { alert("No se pudo guardar: " + msg(error.message)); return; }
    setToken(""); setSt(data);
  };
  const test = async () => {
    const n = testNum.replace(/\D/g, "");
    const type = n.length === 11 ? "RUC" : "DNI";
    setTestRes("Consultando…");
    const { data, error } = await supabase.rpc("lookup_document", { p_type: type, p_number: n });
    if (error) { setTestRes("Error: " + msg(error.message)); return; }
    setTestRes(data.ok ? `✓ ${data.name}${data.address ? ` · ${data.address}` : ""}${data.estado ? ` · ${data.estado}` : ""}${data.condicion ? ` · ${data.condicion}` : ""}` : ({ NO_CONFIGURADO: "Falta guardar el token.", TOKEN_RECHAZADO: "El proveedor rechazó el token: revisa que esté bien copiado y vigente.", NO_ENCONTRADO: "No se encontró ese número (o el proveedor ya no da ese tipo de consulta).", SIN_SALDO: "Se acabaron las consultas de tu plan.", SIN_CONEXION: "No se pudo conectar con el proveedor.", LIMITE: "Límite de consultas de esta hora.", RUC_INVALIDO: "Ese RUC no es válido.", NUMERO_INVALIDO: "Escribe un DNI de 8 dígitos o un RUC de 11." }[data.reason] || data.reason));
  };
  if (st === "no") return <div style={{ padding: "18px 18px 90px", fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Falta correr el SQL 24 (consulta DNI/RUC) en Supabase.</div>;
  if (!st) return <div style={{ padding: "18px 18px 90px", fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Cargando…</div>;
  const hint = { fontFamily: FONT_BODY, fontSize: 12, color: C.stone, lineHeight: 1.55 };
  return (
    <div style={{ padding: "18px 18px 90px", maxWidth: 640 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Consulta DNI / RUC</h1>
      <div style={{ ...hint, marginBottom: 14 }}>En la caja, al escribir un DNI o RUC se completan solos el nombre o la razón social (y la dirección fiscal para factura). Cada número se consulta una sola vez: después sale de la memoria sin costo.</div>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Estado</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: st.configured ? C.ink : C.accent, marginBottom: 4 }}>{st.configured ? "✓ Activa" : "Apagada: falta el token del proveedor"}</div>
        <div style={hint}>Este mes: <strong>{st.monthCalls ?? 0}</strong> consultas al proveedor ({st.monthFound ?? 0} encontradas). Las repetidas salen de la memoria y no cuentan. {st.cached} números guardados.</div>
        <div style={{ ...hint, marginTop: 4 }}>El saldo exacto que te queda lo ves en el panel de tu proveedor. Si se acaba, la caja sigue funcionando: solo hay que escribir el nombre a mano.</div>
        {st.lastProblem && <div style={{ ...hint, marginTop: 6, color: C.accent }}>Último problema: {({ "sin-saldo": "se acabaron las consultas del plan", "token-401": "el proveedor rechazó el token", "token-403": "el proveedor rechazó el token", "sin-conexion": "no hubo conexión con el proveedor" })[st.lastProblem.result] || st.lastProblem.result} · {fmtDT(st.lastProblem.at)}</div>}
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>{st.configured ? "Cambiar token" : "Guardar token"}</span>
        <div style={{ ...hint, marginBottom: 10 }}>1) Crea una cuenta en un proveedor de consultas RENIEC/SUNAT (por ejemplo Decolecta, antes apis.net.pe) y revisa su precio. 2) Copia tu token y pégalo aquí. Se guarda solo en el servidor y no se vuelve a mostrar.</div>
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pega aquí el token" style={{ ...inputStyle, marginBottom: 10 }} />
        <details style={{ marginBottom: 10 }}>
          <summary style={{ ...hint, cursor: "pointer" }}>Direcciones del proveedor (solo si usas otro proveedor)</summary>
          <div style={{ ...hint, marginBottom: 8 }}>{"{n}"} es donde va el número. Si tu proveedor pide el token en la dirección, escribe {"{token}"} en ese lugar.</div>
          <Field label="Consulta DNI ({n} = número)"><input style={inputStyle} value={dniUrl} onChange={(e) => setDniUrl(e.target.value)} placeholder="https://api.decolecta.com/v1/reniec/dni?numero={n}" /></Field>
          <Field label="Consulta RUC ({n} = número)"><input style={inputStyle} value={rucUrl} onChange={(e) => setRucUrl(e.target.value)} placeholder="https://api.decolecta.com/v1/sunat/ruc?numero={n}" /></Field>
        </details>
        <PrimaryButton disabled={busy || (!token.trim() && dniUrl === (st.dniUrl || "") && rucUrl === (st.rucUrl || ""))} onClick={() => save(token.trim())}>{busy ? "Guardando…" : "Guardar"}</PrimaryButton>
        <Faltan center items={[!token.trim() && dniUrl === (st.dniUrl || "") && rucUrl === (st.rucUrl || "") && "pega el token o cambia una dirección"]} />
        {st.configured && <button onClick={() => { if (confirm("¿Apagar la consulta de DNI/RUC? Se borra el token guardado.")) save("-"); }} style={{ marginTop: 10, width: "100%", padding: "11px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Apagar consulta (borrar token)</button>}
      </AdminCard>
      <AdminCard>
        <span style={labelStyle}>Probar</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input inputMode="numeric" value={testNum} onChange={(e) => setTestNum(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="DNI (8) o RUC (11)" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={test} disabled={!(testNum.length === 8 || testNum.length === 11)} style={{ padding: "0 16px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: testNum.length === 8 || testNum.length === 11 ? 1 : 0.5 }}>Consultar</button>
        </div>
        <Faltan items={[!(testNum.length === 8 || testNum.length === 11) && "escribe un DNI de 8 dígitos o un RUC de 11"]} />
        {testRes && <div role="status" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginTop: 10 }}>{testRes}</div>}
      </AdminCard>
    </div>
  );
};

// ---- Compras a proveedores (SQL 23): la mercadería que llega suma stock en la sede y actualiza el costo promedio ----
const PURCHASE_ERRORS = { SIN_PERMISO: "Tu usuario no puede hacer esto.", PROVEEDOR_REPETIDO: "Ya existe un proveedor con ese nombre.", NOMBRE_REQUERIDO: "Escribe el nombre del proveedor.",
  PROVEEDOR_NO_EXISTE: "Elige un proveedor.", COMPRA_VACIA: "Agrega al menos una prenda.", CANTIDAD_INVALIDA: "Revisa las cantidades.", COSTO_INVALIDO: "Revisa los costos.",
  UBICACION_INVALIDA: "Elige dónde entra la mercadería.", PRODUCTO_NO_EXISTE: "Una prenda ya no existe en el catálogo. Quítala y vuelve a agregarla.", MOTIVO_REQUERIDO: "Escribe el motivo.", COMPRA_NO_EXISTE: "La compra no existe." };
const purchaseErr = (m = "") => {
  if (m.includes("STOCK_INSUFICIENTE")) return `Ya no están todas en esa sede (se vendieron o trasladaron): ${(m.split("STOCK_INSUFICIENTE:")[1] || "").replace(/:(\d+)$/, " · quedan $1")}. Corrige con un ajuste de stock.`;
  if (m.includes("suppliers_ruc_check")) return "El RUC o DNI debe tener solo números (8 a 11).";
  const k = Object.keys(PURCHASE_ERRORS).find((x) => m.includes(x));
  return k ? PURCHASE_ERRORS[k] : m;
};
const emptySupplier = () => ({ id: null, name: "", ruc: "", phone: "", contact: "", note: "", active: true });
const PurchasesScreen = ({ catalog, refreshData }) => {
  const settings = catalog.settings;
  const locs = stockLocations(settings);
  const [tab, setTab] = useState("compras"); // compras | proveedores
  const [list, setList] = useState(null); // null cargando | "no" falta SQL 23 | []
  const [suppliers, setSuppliers] = useState([]);
  const [costs, setCosts] = useState({});
  const [mode, setMode] = useState("list"); // list | new
  const [view, setView] = useState(null);
  const [sup, setSup] = useState(null); // proveedor en edición
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ supplierId: "", docRef: "", location: locs[0].id, note: "", updateCost: true });
  const [lines, setLines] = useState([]); // {p, v, qty, cost}
  const [q, setQ] = useState("");
  const reqId = useRef(null);
  const load = async () => {
    const [pu, su, co] = await Promise.all([
      supabase.from("purchases").select("*").order("id", { ascending: false }).limit(200),
      supabase.from("suppliers").select("*").order("name"),
      supabase.from("product_costs").select("product_id,cost"),
    ]);
    if (pu.error) { setList(pu.error.code === "42P01" || pu.error.code === "PGRST205" ? "no" : []); return; }
    setList(pu.data || []); setSuppliers(su.data || []);
    setCosts(Object.fromEntries((co.data || []).map((r) => [r.product_id, Number(r.cost)])));
  };
  useEffect(() => { load(); }, []);
  const back = (label, fn) => <button onClick={fn} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> {label}</button>;
  const hint = (t) => <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 14, lineHeight: 1.5 }}>{t}</div>;
  if (list === "no") return <div style={{ padding: "18px 18px 90px", fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Falta correr el SQL 23 (compras y proveedores) en Supabase.</div>;

  // --- proveedor: crear / editar
  if (sup) {
    const set = (k, v) => setSup((s) => ({ ...s, [k]: v }));
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        {back("Volver", () => setSup(null))}
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 14px" }}>{sup.id ? "Editar proveedor" : "Nuevo proveedor"}</h1>
        <AdminCard>
          <Field label="Nombre o razón social *"><input style={inputStyle} maxLength={120} value={sup.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Textiles Gamarra SAC" /></Field>
          <Field label="RUC o DNI (opcional)"><input style={inputStyle} inputMode="numeric" value={sup.ruc || ""} onChange={(e) => set("ruc", e.target.value.replace(/\D/g, "").slice(0, 11))} /></Field>
          <Field label="Celular (opcional)"><input style={inputStyle} inputMode="tel" maxLength={20} value={sup.phone || ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Persona de contacto (opcional)"><input style={inputStyle} maxLength={80} value={sup.contact || ""} onChange={(e) => set("contact", e.target.value)} /></Field>
          <Field label="Nota (opcional)"><input style={inputStyle} maxLength={200} value={sup.note || ""} onChange={(e) => set("note", e.target.value)} placeholder="Ej. entrega los martes, pago a 30 días" /></Field>
          {sup.id && <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, margin: "4px 0 12px" }}><input type="checkbox" checked={sup.active !== false} onChange={(e) => set("active", e.target.checked)} /> Activo (si lo desactivas ya no aparece al registrar compras)</label>}
          <PrimaryButton disabled={busy || sup.name.trim().length < 2} onClick={async () => {
            setBusy(true);
            const { data, error } = await supabase.rpc("upsert_supplier", { p_id: sup.id, p_name: sup.name, p_ruc: sup.ruc || null, p_phone: sup.phone || null, p_contact: sup.contact || null, p_note: sup.note || null, p_active: sup.active !== false });
            setBusy(false);
            if (error) { alert("No se pudo guardar: " + purchaseErr(error.message)); return; }
            if (mode === "new" && data?.id) setForm((f) => ({ ...f, supplierId: String(data.id) }));
            setSup(null); load();
          }}>{busy ? "Guardando…" : "Guardar proveedor"}</PrimaryButton>
          <Faltan center items={[sup.name.trim().length < 2 && "escribe el nombre o razón social"]} />
        </AdminCard>
      </div>
    );
  }

  // --- ver una compra
  if (view) {
    const pu = view;
    const units = pu.items.reduce((a, i) => a + i.qty, 0);
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        {back("Volver a Compras", () => setView(null))}
        <AdminCard>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: 0 }}>Compra {pu.code}</h1>
            <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: pu.status === "anulada" ? C.accent : C.ink }}>{pu.status === "anulada" ? "Anulada" : "Recibida"}</span>
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.7, margin: "8px 0 10px" }}>
            Proveedor: <strong>{pu.supplier_name}</strong>{pu.doc_ref ? ` · Factura/guía: ${pu.doc_ref}` : ""}<br />
            Entró en: {locationName(settings, pu.location)} · {fmtDT(pu.created_at)} · {pu.created_by}<br />
            {pu.update_cost ? "Actualizó el costo promedio de las prendas" : "No cambió los costos"}{pu.note ? ` · ${pu.note}` : ""}
            {pu.status === "anulada" && <><br /><span style={{ color: C.accent }}>Anulada por {pu.voided_by} ({fmtDT(pu.voided_at)}): {pu.void_reason}</span></>}
          </div>
          {pu.items.map((i) => (
            <div key={i.variantId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
              <span style={{ minWidth: 0 }}>{i.name} · {i.size} {i.color}{i.sku ? <span style={{ color: C.stone }}> · {i.sku}</span> : null}</span>
              <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{i.qty} × {money2(i.unitCost)} = <strong>{money2(i.qty * i.unitCost)}</strong></span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 14, fontWeight: 800, color: C.ink, paddingTop: 10 }}><span>{units} prendas</span><span>{money2(pu.total)}</span></div>
        </AdminCard>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          {pu.status !== "anulada" && <button onClick={async () => {
            const why = prompt(`¿Por qué anulas la compra ${pu.code}? Se restan ${units} prendas del stock de ${locationName(settings, pu.location)}.`, "Registrada por error");
            if (!why || !why.trim()) return;
            const { data, error } = await supabase.rpc("void_purchase", { p_id: pu.id, p_reason: why.trim() });
            if (error) { alert("No se pudo anular: " + purchaseErr(error.message)); return; }
            setView(data); load(); refreshData && refreshData();
          }} style={{ padding: "11px 14px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Anular compra</button>}
        </div>
      </div>
    );
  }

  // --- nueva compra
  if (mode === "new") {
    const active = suppliers.filter((s) => s.active !== false);
    const nq = q.trim().toLowerCase();
    const options = nq.length < 2 ? [] : catalog.products.flatMap((p) => p.variants.map((v) => ({ p, v }))).filter(({ p, v }) => `${p.name} ${v.sku || ""} ${v.size} ${v.colorName}`.toLowerCase().includes(nq)).slice(0, 12);
    const add = (p, v) => { setLines((ls) => ls.some((l) => l.v.id === v.id) ? ls : [...ls, { p, v, qty: "1", cost: costs[p.id] != null ? String(costs[p.id]) : (ls.find((l) => l.p.id === p.id)?.cost || "") }]); setQ(""); };
    const onScan = (e) => { if (e.key !== "Enter") return; const code = q.trim().toLowerCase(); for (const p of catalog.products) { const v = p.variants.find((x) => (x.sku || "").toLowerCase() === code); if (v) { add(p, v); return; } } };
    const setLine = (id, k, val) => setLines((ls) => ls.map((x) => x.v.id === id ? { ...x, [k]: val } : x));
    const bad = lines.find((l) => !(parseInt(l.qty, 10) > 0) || l.cost === "" || !(Number(l.cost) >= 0));
    const units = lines.reduce((a, l) => a + (parseInt(l.qty, 10) || 0), 0);
    const total = lines.reduce((a, l) => a + (parseInt(l.qty, 10) || 0) * (Number(l.cost) || 0), 0);
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        {back("Volver", () => setMode("list"))}
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Registrar compra</h1>
        {hint("Lo que llegó del proveedor. Suma el stock en la sede que elijas y queda en el historial. Si una prenda es nueva, primero créala en Productos con stock 0.")}
        <Field label="Proveedor *">
          <div style={{ display: "flex", gap: 8 }}>
            <select style={{ ...inputStyle, flex: 1 }} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">Elige…</option>{active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => setSup(emptySupplier())} style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", color: C.ink, whiteSpace: "nowrap" }}><Plus size={13} /> Nuevo</button>
          </div>
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 150px" }}><Field label="N.° de factura o guía (opcional)"><input style={inputStyle} maxLength={60} value={form.docRef} onChange={(e) => setForm({ ...form, docRef: e.target.value })} placeholder="Ej. F001-2345" /></Field></div>
          <div style={{ flex: "1 1 150px" }}><Field label="Entra en"><select style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field></div>
        </div>
        <Field label="Agregar prendas"><input style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScan} placeholder="Escanea el código + Enter, o busca por nombre" /></Field>
        {options.length > 0 && (
          <AdminCard style={{ marginBottom: 12, padding: 8 }}>
            {options.map(({ p, v }) => <button key={v.id} onClick={() => add(p, v)} style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 8, padding: "8px 6px", background: "none", border: "none", borderBottom: `1px solid ${C.paperDeep}`, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, textAlign: "left" }}><span>{p.name} · {v.size} {v.colorName}{v.sku ? ` · ${v.sku}` : ""}</span><span style={{ color: C.stone }}>stock {v.stock}</span></button>)}
          </AdminCard>
        )}
        {lines.map((l) => (
          <div key={l.v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 160px", minWidth: 0 }}>{l.p.name} · {l.v.size} {l.v.colorName}<span style={{ display: "block", fontSize: 11, color: C.stone }}>Stock actual: {l.v.stock}{costs[l.p.id] != null ? ` · costo actual ${money2(costs[l.p.id])}` : " · sin costo aún"}</span></span>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 10, color: C.stone }}>Cant.<input inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.v.id, "qty", e.target.value.replace(/\D/g, "").slice(0, 5))} style={{ ...inputStyle, width: 60, padding: "6px 8px", textAlign: "center" }} /></label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 10, color: C.stone }}>Costo c/u S/<input inputMode="decimal" value={l.cost} onChange={(e) => setLine(l.v.id, "cost", e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))} style={{ ...inputStyle, width: 82, padding: "6px 8px", textAlign: "center", borderColor: l.cost === "" ? C.accent : undefined }} /></label>
            <button onClick={() => setLines((ls) => ls.filter((x) => x.v.id !== l.v.id))} aria-label="Quitar" style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={15} color={C.stone} /></button>
          </div>
        ))}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, margin: "14px 0 6px", lineHeight: 1.5 }}><input type="checkbox" checked={form.updateCost} onChange={(e) => setForm({ ...form, updateCost: e.target.checked })} style={{ marginTop: 3 }} /> <span>Actualizar el costo de las prendas <span style={{ display: "block", fontSize: 11, color: C.stone }}>Promedio entre lo que ya había y lo que llegó. Se usa en Rentabilidad.</span></span></label>
        <Field label="Nota (opcional)"><input style={inputStyle} maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ej. pagado con transferencia" /></Field>
        {lines.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 14, fontWeight: 800, color: C.ink, margin: "6px 0 12px" }}><span>{units} prendas</span><span>{money2(total)}</span></div>}
        <PrimaryButton disabled={busy || !form.supplierId || !lines.length || !!bad} onClick={async () => {
          if (!reqId.current) reqId.current = "pur_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          setBusy(true);
          const { data, error } = await supabase.rpc("register_purchase", { p_supplier_id: Number(form.supplierId), p_doc_ref: form.docRef.trim() || null, p_location: form.location,
            p_items: lines.map((l) => ({ variantId: l.v.id, qty: parseInt(l.qty, 10), unitCost: Number(l.cost) })), p_note: form.note.trim() || null, p_update_cost: form.updateCost, p_request_id: reqId.current });
          setBusy(false);
          if (error) { alert("No se pudo registrar: " + purchaseErr(error.message)); return; }
          reqId.current = null; setLines([]); setForm((f) => ({ ...f, docRef: "", note: "" })); setMode("list"); setView(data); load(); refreshData && refreshData();
        }}>{busy ? "Registrando…" : `Registrar compra${lines.length ? ` (${units} prendas)` : ""}`}</PrimaryButton>
        <Faltan center items={[!form.supplierId && "elige el proveedor", !lines.length && "agrega al menos una prenda", bad && (!(parseInt(bad.qty, 10) > 0) ? `pon una cantidad mayor que 0 en «${bad.p.name}»` : `escribe el costo de «${bad.p.name}»`)]} />
      </div>
    );
  }

  // --- lista
  const tabBtn = (k, label) => <button onClick={() => setTab(k)} style={{ padding: "8px 14px", borderRadius: 999, border: `1px solid ${tab === k ? C.ink : C.line}`, background: tab === k ? C.ink : "transparent", color: tab === k ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>;
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const monthTotal = (list || []).filter((p) => p.status !== "anulada" && new Date(p.created_at) >= month).reduce((a, p) => a + Number(p.total), 0);
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: 0 }}>Compras</h1>
        {tab === "compras"
          ? <button onClick={() => { reqId.current = null; setLines([]); setMode("new"); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Registrar compra</button>
          : <button onClick={() => setSup(emptySupplier())} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}><Plus size={14} /> Nuevo proveedor</button>}
      </div>
      {hint("Mercadería que llega de tus proveedores. Solo la ve Administración (los costos son privados).")}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>{tabBtn("compras", "Compras")}{tabBtn("proveedores", `Proveedores (${suppliers.length})`)}</div>
      {list === null ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Cargando…</div> : tab === "compras" ? (
        <>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 12 }}>Comprado este mes: <strong>{money2(monthTotal)}</strong></div>
          {list.length === 0 ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Aún no hay compras registradas.</div> : list.map((pu) => (
            <button key={pu.id} onClick={() => setView(pu)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", marginBottom: 8, borderRadius: 10, border: `1px solid ${C.line}`, background: C.paper, cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY, opacity: pu.status === "anulada" ? 0.6 : 1 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{pu.code} · {pu.supplier_name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.stone }}>{pu.items.reduce((a, i) => a + i.qty, 0)} prendas → {locationName(settings, pu.location)} · {fmtDT(pu.created_at)}{pu.status === "anulada" ? " · ANULADA" : ""}</span>
              </span>
              <strong style={{ fontSize: 13, color: C.ink, whiteSpace: "nowrap", textDecoration: pu.status === "anulada" ? "line-through" : "none" }}>{money2(pu.total)}</strong>
            </button>
          ))}
        </>
      ) : (
        suppliers.length === 0 ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Aún no hay proveedores.</div> : suppliers.map((s) => {
          const bought = (list || []).filter((p) => p.supplier_id === s.id && p.status !== "anulada").reduce((a, p) => a + Number(p.total), 0);
          return (
            <button key={s.id} onClick={() => setSup({ ...emptySupplier(), ...s })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", marginBottom: 8, borderRadius: 10, border: `1px solid ${C.line}`, background: C.paper, cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY, opacity: s.active === false ? 0.55 : 1 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{s.name}{s.active === false ? " (inactivo)" : ""}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.stone }}>{[s.ruc && `RUC/DNI ${s.ruc}`, s.phone, s.contact].filter(Boolean).join(" · ") || "Sin datos de contacto"}</span>
              </span>
              <span style={{ fontSize: 11.5, color: C.stone, whiteSpace: "nowrap" }}>{money2(bought)}</span>
            </button>
          );
        })
      )}
    </div>
  );
};

// ---- Historial de una prenda (o de toda la tienda): lo anota la base de datos en cada cambio ----
const MOVE_LABEL = (t) => ({ compra: "Compra", "compra anulada": "Compra anulada", traslado: "Traspaso", entrada: "Entrada", devolucion: "Devolución", salida: "Salida", merma: "Dañada / no vendible", regalo: "Regalo", ajuste: "Ajuste", venta: "Venta" }[t] || t);
const StockHistory = ({ product, catalog, onBack }) => {
  // (los traspasos no cambian el total: se muestran pero no suman en ingresadas/vendidas)
  const [rows, setRows] = useState(null);
  const [legacy, setLegacy] = useState(false);
  const [variantId, setVariantId] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      let q = supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(product ? 500 : 200);
      if (product) q = q.eq("product_id", product.id);
      const { data, error } = await q;
      if (!alive) return;
      if (error) { // aún no se corrió el SQL 14: se muestra el historial anterior
        setLegacy(true);
        setRows((catalog.stockMovements || []).filter((m) => !product || m.productId === product.id).map((m) => ({
          id: m.id, created_at: m.createdAt, type: m.type, qty: ["venta", "salida", "merma"].includes(m.type) ? -Math.abs(m.qty) : m.qty,
          variant_id: m.variantId, size: m.size, color: m.colorName, product_name: m.productName, staff_name: m.staffName, note: m.note,
        })));
        return;
      }
      setRows(data || []);
    })();
    return () => { alive = false; };
  }, [product?.id]);
  const list = (rows || []).filter((r) => !variantId || r.variant_id === variantId);
  const isSale = (t) => /venta|pedido web/.test(t || "");
  const sum = (fn) => list.filter(fn).reduce((a, r) => a + Math.abs(r.qty || 0), 0);
  const sold = sum((r) => isSale(r.type) && r.qty < 0);
  const returned = sum((r) => /devoluci|anulaci|cancelado/.test(r.type || "") && r.qty > 0);
  const inbound = sum((r) => /entrada|alta/.test(r.type || "") && r.qty > 0);
  const lost = sum((r) => /merma|regalo|salida/.test(r.type || "") && r.qty < 0);
  const lastRestock = list.find((r) => /entrada|alta/.test(r.type || "") && r.qty > 0);
  const stat = (n, label) => <AdminCard style={{ padding: 12 }}><div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, color: C.ink }}>{n}</div><div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone }}>{label}</div></AdminCard>;
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver a Stock</button>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>{product ? `Historial: ${product.name}` : "Historial de movimientos"}</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 14 }}>{legacy ? "Historial anterior (falta correr el SQL 14 para ver el detalle completo)." : "Cada cambio de stock queda anotado solo: qué pasó, cuánto, precio, comprobante, clienta, vendedora y quién lo hizo."}</div>
      {product && (
        <>
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
            <option value="">Todas las tallas y colores</option>
            {product.variants.map((v) => <option key={v.id} value={v.id}>{v.size} · {v.colorName}{v.sku ? ` · ${v.sku}` : ""} (hay {v.stock})</option>)}
          </select>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 12 }}>
            {stat(inbound, "Ingresadas")}{stat(sold, "Vendidas")}{stat(returned, "Devueltas / anuladas")}{stat(lost, "Dañadas, regalos y salidas")}
          </div>
          {lastRestock && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>Última reposición: <strong>{new Date(lastRestock.created_at).toLocaleDateString("es-PE")}</strong> (+{lastRestock.qty}{lastRestock.size ? ` · ${lastRestock.size} ${lastRestock.color || ""}` : ""})</div>}
        </>
      )}
      {rows === null && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Cargando…</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((m) => (
          <AdminCard key={m.id} style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>{product ? `${m.size || ""} · ${m.color || ""}` : m.product_name}</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800, color: m.qty < 0 ? C.accent : C.ink, whiteSpace: "nowrap" }}>{m.qty > 0 ? "+" : ""}{m.qty}</span>
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft }}>
              <strong style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}>{MOVE_LABEL(m.type)}</strong>
              {!product && m.size ? ` · ${m.size} ${m.color || ""}` : ""}
              {m.stock_before != null ? ` · stock ${m.stock_before} → ${m.stock_after}` : ""}
              {m.unit_price != null && isSale(m.type) ? ` · ${moneyExact(m.unit_price)} c/u` : ""}
            </div>
            {(m.doc || m.customer || m.seller) && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{[m.doc, m.customer && `Clienta: ${m.customer}`, m.seller && `Vendió: ${m.seller}`].filter(Boolean).join(" · ")}</div>}
            {m.note && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, marginTop: 2, fontStyle: "italic" }}>{m.note}</div>}
            <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone, marginTop: 3 }}>{m.staff_name || "Sistema"}{m.channel ? ` · ${m.channel}` : ""}{m.store_id && m.store_id !== "web" ? ` · ${locationName(catalog.settings, m.store_id)}` : ""} · {new Date(m.created_at).toLocaleString("es-PE")}</div>
          </AdminCard>
        ))}
        {rows && list.length === 0 && <div style={{ textAlign: "center", padding: 30, fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Aún no hay movimientos registrados.</div>}
      </div>
    </div>
  );
};

// ---- Etiquetas con código de barras (para pistolear en caja, stock y guías). NO son comprobantes ----
const LABEL_FORMATS = {
  r5025: { name: "Rollo 50 × 25 mm", w: "50mm", h: "25mm", page: "50mm 25mm", roll: true, bar: 1.1, barH: 26 },
  r4030: { name: "Rollo 40 × 30 mm", w: "40mm", h: "30mm", page: "40mm 30mm", roll: true, bar: 0.9, barH: 34 },
  a4: { name: "Hoja A4 adhesiva (3 × 8)", w: "63.5mm", h: "33.9mm", page: "A4", roll: false, bar: 1.3, barH: 34 },
};
const Barcode = ({ value, width = 1.2, height = 30 }) => {
  const ref = useRef(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!ref.current || !value) return undefined;
    let alive = true;
    loadJsBarcode().then((JsBarcode) => {
      if (!alive || !ref.current) return;
      try { JsBarcode(ref.current, value, { format: "CODE128", width, height, margin: 0, displayValue: true, fontSize: 9, textMargin: 1, background: "#ffffff", lineColor: "#000000" }); setBad(false); }
      catch (e) { setBad(true); }
    }).catch(() => setBad(true));
    return () => { alive = false; };
  }, [value, width, height]);
  if (!value || bad) return <div style={{ fontSize: 9, color: "#b3261e" }}>Sin código válido</div>;
  return <svg ref={ref} style={{ maxWidth: "100%", height: "auto", display: "block" }} />;
};
const LabelsScreen = ({ catalog, onBack }) => {
  const [q, setQ] = useState("");
  const [qty, setQty] = useState({}); // variantId -> cantidad de etiquetas
  const [fmt, setFmt] = useState(() => { try { return localStorage.getItem("flyboutique:etiquetas") || "r5025"; } catch (e) { return "r5025"; } });
  const [showPrice, setShowPrice] = useState(true);
  const F = LABEL_FORMATS[fmt];
  const nq = q.trim().toLowerCase();
  const rows = catalog.products.flatMap((p) => p.variants.map((v) => ({ p, v }))).filter(({ p, v }) => !nq || `${p.name} ${v.sku || ""} ${v.size} ${v.colorName}`.toLowerCase().includes(nq));
  const labels = catalog.products.flatMap((p) => p.variants.flatMap((v) => Array.from({ length: Math.min(500, parseInt(qty[v.id] || "0", 10) || 0) }, (_, k) => ({ key: `${v.id}-${k}`, p, v }))));
  const setN = (id, n) => setQty((x) => ({ ...x, [id]: String(n) }));
  const onScan = (e) => {
    if (e.key !== "Enter") return;
    const code = q.trim().toLowerCase();
    for (const p of catalog.products) { const v = p.variants.find((x) => (x.sku || "").toLowerCase() === code); if (v) { setN(v.id, (parseInt(qty[v.id] || "0", 10) || 0) + 1); setQ(""); return; } }
  };
  const label = ({ key, p, v }) => (
    <div key={key} className="fly-label" style={{ width: F.w, height: F.h, boxSizing: "border-box", padding: "1.5mm 2mm", background: "#fff", color: "#000", fontFamily: "'Jost', Arial, sans-serif", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", border: "1px dashed #bbb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontFamily: "'Archivo', Arial, sans-serif", fontWeight: 900, fontSize: 10 }}>FLY</span>
        {showPrice && <span style={{ fontWeight: 700, fontSize: 10 }}>S/ {Number(p.price).toFixed(2)}</span>}
      </div>
      <div style={{ fontSize: 8.5, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
      <div style={{ fontSize: 8.5, fontWeight: 600 }}>Talla {v.size} · {v.colorName}</div>
      <Barcode value={v.sku} width={F.bar} height={F.barH} />
    </div>
  );
  const choose = (k) => { setFmt(k); try { localStorage.setItem("flyboutique:etiquetas", k); } catch (e) { /* nada */ } };
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver a Stock</button>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>Etiquetas con código de barras</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 14 }}>Para pegar en las prendas y pistolearlas en caja, stock y traslados. Cada talla y color lleva su propio código.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {Object.entries(LABEL_FORMATS).map(([k, x]) => <Chip key={k} active={fmt === k} onClick={() => choose(k)}>{x.name}</Chip>)}
      </div>
      <div style={{ marginBottom: 12 }}><Switch on={showPrice} onClick={() => setShowPrice((x) => !x)} label="Mostrar precio en la etiqueta" /></div>
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScan} placeholder="Busca la prenda o escanea su código + Enter (suma 1)" style={{ ...inputStyle, marginBottom: 10 }} />
      <AdminCard style={{ padding: 8, marginBottom: 14, maxHeight: 360, overflowY: "auto" }}>
        {rows.slice(0, 80).map(({ p, v }) => (
          <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 4px", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
            <span style={{ flex: 1, minWidth: 0 }}>{p.name} · {v.size} {v.colorName}<span style={{ display: "block", fontSize: 11, color: v.sku ? C.stone : C.accent }}>{v.sku || "Sin código: ponlo en Productos → editar"} · stock {v.stock}</span></span>
            <button type="button" onClick={() => setN(v.id, v.stock)} disabled={!v.stock} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 11, cursor: "pointer", color: C.ink }}>= stock</button>
            <input inputMode="numeric" value={qty[v.id] || ""} onChange={(e) => setN(v.id, e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="0" aria-label={`Etiquetas de ${p.name} ${v.size}`} style={{ ...inputStyle, width: 56, padding: "6px 8px", textAlign: "center" }} />
          </div>
        ))}
        {rows.length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, padding: 8 }}>Sin resultados.</div>}
      </AdminCard>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button onClick={() => window.print()} disabled={!labels.length} style={{ ...quickLinkStyle, justifyContent: "center", fontWeight: 600, opacity: labels.length ? 1 : 0.4 }}><Receipt size={15} /> Imprimir {labels.length} etiquetas</button>
        {labels.length > 0 && <button onClick={() => setQty({})} style={{ background: "none", border: "none", textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", color: C.ink }}>Vaciar</button>}
      </div>
      {labels.length > 0 && <span style={labelStyle}>Vista previa</span>}
      <div className="print-area labels-sheet" style={{ display: "flex", flexWrap: "wrap", gap: F.roll ? 8 : 0, background: "#fff", padding: F.roll ? 0 : 0 }}>
        <style>{`@media print { @page { size: ${F.page}; margin: ${F.roll ? "0" : "13mm 7mm"}; } .labels-sheet { gap: 0 !important; display: ${F.roll ? "block" : "grid"} !important; grid-template-columns: repeat(3, 63.5mm); } .fly-label { border: none !important; ${F.roll ? "page-break-after: always; break-after: page;" : ""} } }`}</style>
        {labels.map(label)}
      </div>
    </div>
  );
};

/* ---- Stock: main screen (shared by Vendedor + Administrador) ---- */
const StockScreen = ({ catalog, staffName, onRegisterMovement, onOpenTransfers, canEdit }) => {
  const [showLabels, setShowLabels] = useState(false);
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

  if (showLabels) return <LabelsScreen catalog={catalog} onBack={() => setShowLabels(false)} />;
  if (showHistory) return <StockHistory product={showHistory === true ? null : showHistory} catalog={catalog} onBack={() => setShowHistory(false)} />;

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

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => setShowHistory(true)} style={{ ...quickLinkStyle, flex: "1 1 200px", justifyContent: "center" }}><FileSpreadsheet size={15} /> Ver historial de movimientos</button>
        {onOpenTransfers && <button onClick={onOpenTransfers} style={{ ...quickLinkStyle, flex: "1 1 200px", justifyContent: "center" }}><Navigation size={15} /> Traslados entre sedes</button>}
        {canEdit && <button onClick={() => setShowLabels(true)} style={{ ...quickLinkStyle, flex: "1 1 200px", justifyContent: "center" }}><Scan size={15} /> Imprimir etiquetas</button>}
      </div>

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
                  <button onClick={() => setShowHistory(p)} style={{ ...quickLinkStyle, width: "100%", justifyContent: "center", marginBottom: 6 }}><FileSpreadsheet size={14} /> Historial de esta prenda (ventas, reposiciones, devoluciones)</button>
                  {p.variants.map((v) => (
                    <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, fontWeight: 500 }}>{v.size} · {v.colorName}</div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.stone }}>{v.sku} {v.stock <= (p.minStock ?? 3) && v.stock > 0 && <span style={{ color: C.accent }}> · stock bajo</span>}{v.stock === 0 && <span style={{ color: C.accent }}> · agotado</span>}</div>
                        {v.stock > 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.inkSoft }}>{stockLocations(catalog.settings).map((l) => `${l.name} ${Number(variantStockBy(v)[l.id]) || 0}`).join(" · ")}</div>}
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
          product={activeMove.product} variant={activeMove.variant} staffName={staffName} settings={catalog.settings}
          onClose={() => setActiveMove(null)}
          onSubmit={(mv) => onRegisterMovement(activeMove.product, activeMove.variant, mv)}
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
  const [color, setColor] = useState(() => colors.find((c) => colorTotalStock(product, c.n) > 0) || colors[0]);
  const [size, setSize] = useState(() => productSizes(product).find((s) => variantStock(product, s, (colors.find((c) => colorTotalStock(product, c.n) > 0) || colors[0])?.n) > 0) || null);
  const [qty, setQty] = useState(1);
  const stock = size ? variantStock(product, size, color?.n) : 0;
  const pickColor = (c) => { setColor(c); if (size && variantStock(product, size, c.n) <= 0) setSize(null); setQty(1); };
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
              <button key={c.n} onClick={() => pickColor(c)} title={outOfStock ? `${c.n} — agotado` : c.n} style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", background: c.h, border: color?.n === c.n ? `2px solid ${C.ink}` : `1px solid ${C.line}`, cursor: "pointer", opacity: outOfStock ? 0.35 : 1 }}>
                {outOfStock && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `linear-gradient(to top right, transparent calc(50% - 1px), ${C.ink} calc(50% - 1px), ${C.ink} calc(50% + 1px), transparent calc(50% + 1px))` }} />}
              </button>
            );
          })}
        </div>
        <span style={labelStyle}>Talla</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {productSizes(product).map((s) => { const st = variantStock(product, s, color?.n); return <button key={s} disabled={st === 0} onClick={() => { setSize(s); setQty(1); }} style={{ minWidth: 42, padding: "9px 6px", borderRadius: 8, border: `1px solid ${size === s ? C.ink : C.line}`, background: size === s ? C.ink : "transparent", color: st === 0 ? C.line : size === s ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, cursor: st === 0 ? "not-allowed" : "pointer" }}>{s}</button>; })}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: stock === 0 ? C.accent : C.stone, marginBottom: 16 }}>{size ? `Stock disponible: ${stock}` : "Elige una talla con stock en este color"}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={labelStyle}>Cantidad</span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px" }}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ background: "none", border: "none", cursor: "pointer" }}><Minus size={14} /></button>
            <span style={{ fontFamily: FONT_BODY, fontSize: 14 }}>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(stock || 1, q + 1))} style={{ background: "none", border: "none", cursor: "pointer" }}><Plus size={14} /></button>
          </div>
        </div>
        <PrimaryButton disabled={!size || stock === 0 || qty > stock} onClick={() => onAdd(product, size, color, qty)}>{size ? "Agregar a la venta" : "Elige una talla"}</PrimaryButton>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// COMPROBANTE (nota de venta interna) con todos los datos: empresa, RUC, cliente, detalle con
// cantidades, operación gravada, IGV 18%, total en letras, pagos, vendedora y cajero.
// Mientras no se conecte un proveedor SUNAT (ej. Nubefact) NO es boleta/factura electrónica y lo dice.
// RUC válido: 11 dígitos, empieza en 10/15/16/17/20 y cuadra su dígito verificador (igual que ruc_valido del SQL 24)
const rucValido = (r) => {
  if (!/^(10|15|16|17|20)\d{9}$/.test(r || "")) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let k = 11 - (w.reduce((a, x, i) => a + x * Number(r[i]), 0) % 11);
  if (k === 10) k = 0; else if (k === 11) k = 1;
  return k === Number(r[10]);
};
// Formatos: ticket 80 mm, ticket 58 mm o A4 (se recuerda por equipo, porque depende de la impresora).
// ------------------------------------------------------------------
const IGV_RATE = 0.18;
const RECEIPT_FORMAT_KEY = "flyboutique:formato-comprobante";
const RECEIPT_FORMATS = { "80": { label: "Ticket 80 mm", width: "72mm", page: "80mm auto", font: 11 }, "58": { label: "Ticket 58 mm", width: "48mm", page: "58mm auto", font: 9.5 }, a4: { label: "Hoja A4", width: "180mm", page: "A4", font: 12 } };
const UNITS = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const TENS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const HUNDREDS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
const words999 = (n) => {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 30 ? UNITS[r] : TENS[Math.floor(r / 10)] + (r % 10 ? " Y " + UNITS[r % 10] : "");
  return [HUNDREDS[h], rest].filter(Boolean).join(" ");
};
// 1250.5 → "MIL DOSCIENTOS CINCUENTA CON 50/100 SOLES"
const amountInWords = (amount) => {
  const total = Math.round(Number(amount || 0) * 100);
  let n = Math.floor(total / 100); const cents = String(total % 100).padStart(2, "0");
  if (n === 0) return `CERO CON ${cents}/100 SOLES`;
  const millions = Math.floor(n / 1e6), thousands = Math.floor((n % 1e6) / 1000), units = n % 1000;
  const parts = [];
  if (millions) parts.push(millions === 1 ? "UN MILLÓN" : `${words999(millions).replace(/UNO$/, "UN")} MILLONES`);
  if (thousands) parts.push(thousands === 1 ? "MIL" : `${words999(thousands).replace(/UNO$/, "UN")} MIL`);
  if (units) parts.push(words999(units));
  return `${parts.join(" ")} CON ${cents}/100 SOLES`;
};
const docTypeOf = (doc) => { const d = String(doc || ""); return /^\d{11}$/.test(d) ? "RUC" : /^\d{8}$/.test(d) ? "DNI" : d ? "Doc." : ""; };

// ---- Comprobante electrónico (SQL 25 / Nubefact) ----
const EINV_LABEL = { preparado: "Preparando", enviado: "Registrado · SUNAT pendiente", aceptado: "Aceptado por SUNAT", rechazado: "Rechazado", error: "Sin respuesta (reintentar)", anulacion_pendiente: "Anulación en trámite", anulado: "Anulado en SUNAT" };
const EINV_ERRORS = { DEVOLUCION_SIN_IMPORTE: "La devolución no tiene importe para la nota de crédito.", NO_CONFIGURADO: "Falta configurar Nubefact (Más → Facturación electrónica).", FACTURA_SIN_RUC: "La factura necesita un RUC válido.", BOLETA_700_SIN_DOCUMENTO: "Desde S/ 700 SUNAT pide el DNI del cliente.", PEDIDO_SIN_PAGO: "El pedido web aún no tiene el pago confirmado.", VENTA_ANULADA: "La venta está anulada.", REGIMEN_NRUS: "Con Nuevo RUS no se emiten boletas con IGV desde aquí.", SIN_PERMISO: "Tu usuario no puede hacer esto.", MOTIVO_REQUERIDO: "Escribe el motivo." };
const einvErr = (m = "") => { const k = Object.keys(EINV_ERRORS).find((x) => m.includes(x)); return k ? EINV_ERRORS[k] : m.replace(/^.*?(ANULACION_RECHAZADA|NO_SE_PUEDE_ANULAR):?/, "No se pudo: "); };
const einvOfficial = (e) => e && ["enviado", "aceptado", "anulacion_pendiente", "anulado"].includes(e.status);
let einvConfigCache = null; // { configured, auto } — se consulta una vez por sesión
const einvConfig = async () => {
  if (einvConfigCache) return einvConfigCache;
  const { data, error } = await supabase.rpc("einvoice_status");
  einvConfigCache = error ? { configured: false, missing: true } : data;
  return einvConfigCache;
};
// QR del comprobante (cadena que entrega Nubefact)
const EinvQR = ({ text }) => {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    if (text) import("qrcode").then((m) => (m.default || m).toDataURL(text, { margin: 0, width: 200, errorCorrectionLevel: "M" })).then((d) => { if (alive) setSrc(d); }).catch(() => {});
    return () => { alive = false; };
  }, [text]);
  return src ? <img src={src} alt="Código QR del comprobante" style={{ width: 96, height: 96, display: "block", margin: "6px auto" }} /> : null;
};

const ReceiptDocument = ({ sale, settings, format = "80", einv }) => {
  const company = companyOf(settings);
  const fmt = RECEIPT_FORMATS[format] || RECEIPT_FORMATS["80"];
  const withIgv = company.taxRegime !== "nrus";
  const total = Number(sale.total || 0);
  const gravada = Math.round((total / (1 + IGV_RATE)) * 100) / 100;
  const igv = Math.round((total - gravada) * 100) / 100;
  const subtotal = Number(sale.subtotal ?? (sale.items || []).reduce((a, i) => a + i.unitPrice * i.qty, 0));
  const units = (sale.items || []).reduce((a, i) => a + Number(i.qty || 0), 0);
  const label = `${sale.serie}-${String(sale.numero).padStart(6, "0")}`;
  const dt = new Date(sale.createdAt || Date.now());
  const store = (storesOf(settings).find((x) => x.id === sale.storeId) || {});
  const payments = sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod, amount: total }];
  const small = { fontSize: fmt.font - 1.5, color: "#333" };
  const line = <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />;
  const R = ({ l, v, b }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: b ? 700 : 400 }}><span>{l}</span><span style={{ whiteSpace: "nowrap" }}>{v}</span></div>;
  return (
    <div className="print-area receipt-doc" style={{ width: fmt.width, maxWidth: "100%", margin: "0 auto", background: "#fff", color: "#000", fontFamily: "'Jost', Arial, sans-serif", fontSize: fmt.font, lineHeight: 1.4, padding: format === "a4" ? "10mm" : "3mm 2mm" }}>
      <style>{`@media print { @page { size: ${fmt.page}; margin: ${format === "a4" ? "10mm" : "2mm"}; } }`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: fmt.font * 2.2, letterSpacing: "0.04em" }}>FLY</div>
        <div style={{ fontWeight: 700 }}>{company.legalName}</div>
        {company.ruc ? <div>RUC {company.ruc}</div> : <div style={small}>(RUC no configurado: Panel → Datos de la empresa)</div>}
        <div style={small}>{store.address || company.address}</div>
        <div style={small}>{company.phone ? `Tel. +${company.phone}` : ""}{company.email ? ` · ${company.email}` : ""}</div>
        {line}
        {einvOfficial(einv) ? (
          <>
            <div style={{ fontWeight: 800 }}>{einv.tipo === 1 ? "FACTURA ELECTRÓNICA" : "BOLETA DE VENTA ELECTRÓNICA"}</div>
            <div style={{ fontWeight: 700 }}>{einv.serie}-{String(einv.numero).padStart(8, "0")}</div>
            <div style={small}>Ref. interna {label}</div>
            {einv.status === "anulado" && <div style={{ fontWeight: 800 }}>*** ANULADO EN SUNAT ***</div>}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 800 }}>NOTA DE VENTA{sale.tipo === "factura" ? " (DATOS PARA FACTURA)" : ""}</div>
            <div style={{ fontWeight: 700 }}>{label}</div>
          </>
        )}
        {sale.status === "anulado" && <div style={{ fontWeight: 800 }}>*** ANULADA ***{sale.voidReason ? ` (${sale.voidReason})` : ""}</div>}
      </div>
      {line}
      <R l="Fecha de emisión" v={dt.toLocaleDateString("es-PE")} />
      <R l="Hora" v={dt.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })} />
      {(store.name || sale.storeName) && <R l="Tienda" v={store.name || sale.storeName} />}
      <R l="Moneda" v="Soles (PEN)" />
      {line}
      <div><strong>Cliente:</strong> {sale.customerName || "Cliente varios"}</div>
      {sale.customerDoc && sale.customerDoc !== "00000000" && <div>{({ DNI: "DNI", RUC: "RUC", CE: "Carné de extranjería", PAS: "Pasaporte" })[sale.customerDocType] || docTypeOf(sale.customerDoc)}: {sale.customerDoc}</div>}
      {sale.customerAddress && <div style={small}>Dirección: {sale.customerAddress}</div>}
      {line}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", columnGap: 6, fontWeight: 700 }}><span>Cant.</span><span>Descripción</span><span>Importe</span></div>
      {(sale.items || []).map((it, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", columnGap: 6, marginTop: 3 }}>
          <span>{it.qty}</span>
          <span>{it.name}<br /><span style={small}>{[it.size, it.colorName].filter(Boolean).join(" / ")} · P.U. {money2(it.unitPrice)}</span></span>
          <span style={{ textAlign: "right" }}>{money2(it.unitPrice * it.qty)}</span>
        </div>
      ))}
      {line}
      <R l={`Total de prendas`} v={units} />
      <R l="Subtotal" v={money2(subtotal)} />
      {Number(sale.discount) > 0 && <R l={`Descuentos${sale.promoCode ? ` (${sale.promoCode})` : ""}${sale.pointsDiscount ? " incl. puntos" : ""}`} v={`-${money2(sale.discount)}`} />}
      {Number(sale.shipping) > 0 && <R l="Envío" v={money2(sale.shipping)} />}
      {withIgv ? (<><R l="Op. gravada" v={money2(gravada)} /><R l="IGV (18%)" v={money2(igv)} /></>) : <R l="Op. no gravada (Nuevo RUS)" v={money2(total)} />}
      <div style={{ fontSize: fmt.font + 2 }}><R l="IMPORTE TOTAL" v={money2(total)} b /></div>
      <div style={{ ...small, marginTop: 3 }}>SON: {amountInWords(total)}</div>
      {line}
      {payments.map((p, i) => <R key={i} l={`Pago ${p.method}${p.code ? ` ${p.code}` : ""}`} v={money2(p.amount)} />)}
      {Number(sale.amountReceived) > 0 && <><R l="Efectivo recibido" v={money2(sale.amountReceived)} /><R l="Vuelto" v={money2(sale.vuelto || 0)} /></>}
      {line}
      <div style={small}>Atendió: {sale.staffName || "—"}{sale.sellerCode ? ` (${sale.sellerCode})` : ""}{sale.cashierName && sale.cashierName !== sale.staffName ? ` · Cajero(a): ${sale.cashierName}` : ""}</div>
      {sale.earnedPoints > 0 && <div style={small}>Puntos Club Fly ganados: {sale.earnedPoints}</div>}
      {sale.notaExterna && <div style={{ marginTop: 4, fontStyle: "italic" }}>{sale.notaExterna}</div>}
      {line}
      <div style={{ ...small, textAlign: "center" }}>Cambios de talla o color hasta 7 días con etiquetas y este documento.</div>
      <div style={{ ...small, textAlign: "center" }}>Libro de Reclamaciones virtual disponible en nuestra web.</div>
      {einvOfficial(einv) ? (
        <div style={{ ...small, textAlign: "center", marginTop: 4 }}>
          <EinvQR text={einv.qr} />
          <div style={{ fontWeight: 700 }}>Representación impresa de la {einv.tipo === 1 ? "factura" : "boleta de venta"} electrónica.</div>
          {einv.hash && <div>Resumen: {einv.hash}</div>}
          {einv.link && <div style={{ wordBreak: "break-all" }}>Consulta en: {einv.link}</div>}
        </div>
      ) : <div style={{ ...small, textAlign: "center", fontWeight: 700, marginTop: 4 }}>Documento interno de control. No es boleta ni factura electrónica (SUNAT).</div>}
      <div style={{ textAlign: "center", marginTop: 6 }}>¡Gracias por tu compra!</div>
    </div>
  );
};

const ReceiptView = ({ sale, settings, onNewSale, onSendWhatsApp, autoEmit = false }) => {
  const [format, setFormat] = useState(() => { try { return localStorage.getItem(RECEIPT_FORMAT_KEY) || "80"; } catch (e) { return "80"; } });
  const choose = (f) => { setFormat(f); try { localStorage.setItem(RECEIPT_FORMAT_KEY, f); } catch (e) { /* nada */ } };
  // Comprobante electrónico: se busca el que ya exista; justo después de vender se envía solo (si está activado)
  const [einv, setEinv] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [eBusy, setEBusy] = useState(false);
  const [eMsg, setEMsg] = useState("");
  const emit = async () => {
    setEBusy(true); setEMsg("");
    try {
      const { data, error } = await supabase.rpc("emit_einvoice", { p_sale_id: sale.id });
      if (error) setEMsg(einvErr(error.message));
      else if (data?.reason) setEMsg(einvErr(data.reason));
      else setEinv(data);
    } catch (e) { setEMsg("Sin conexión: vuelve a intentar."); }
    setEBusy(false);
  };
  const refresh = async () => {
    setEBusy(true);
    const { data, error } = await supabase.rpc("refresh_einvoice", { p_sale_id: sale.id });
    if (error) setEMsg(einvErr(error.message)); else setEinv(data);
    setEBusy(false);
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await einvConfig(); if (!alive) return; setCfg(c);
      if (c.missing) return;
      const { data } = await supabase.from("einvoices").select("*").eq("sale_id", sale.id).maybeSingle();
      if (!alive) return;
      if (data) setEinv(data);
      else if (autoEmit && c.configured && c.auto && sale.status !== "anulado") emit();
    })().catch(() => {});
    return () => { alive = false; };
  }, [sale.id]);
  return (
    <div style={{ padding: "18px 18px 90px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.paperDeep, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Check size={18} color={C.paper} /></span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}><strong>Venta registrada</strong> · {sale.serie}-{String(sale.numero).padStart(6, "0")} · {money2(sale.total)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {Object.entries(RECEIPT_FORMATS).map(([k, f]) => <Chip key={k} active={format === k} onClick={() => choose(k)}>{f.label}</Chip>)}
      </div>
      <div style={{ background: "#e9e9e9", borderRadius: 12, padding: "16px 8px", marginBottom: 16, overflowX: "auto" }}>
        <div style={{ boxShadow: "0 4px 18px rgba(0,0,0,0.12)", width: "fit-content", maxWidth: "100%", margin: "0 auto" }}><ReceiptDocument sale={sale} settings={settings} format={format} einv={einv} /></div>
      </div>
      {cfg && !cfg.missing && (cfg.configured || einv) && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${einv?.status === "rechazado" || einv?.status === "error" || eMsg ? C.accent : C.line}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
          {eBusy && <Loader2 size={15} className="spin" />}
          <span style={{ flex: 1, minWidth: 180 }}>
            <strong>SUNAT:</strong>{" "}
            {eBusy ? "enviando a Nubefact…" : einv ? `${EINV_LABEL[einv.status] || einv.status} · ${einv.serie}-${einv.numero}` : "aún no se envió"}
            {einv?.last_error && <span style={{ display: "block", color: C.accent }}>{einv.last_error}</span>}
            {eMsg && <span style={{ display: "block", color: C.accent }}>{eMsg}</span>}
          </span>
          {!eBusy && (!einv || ["preparado", "rechazado", "error"].includes(einv.status)) && cfg.configured && <button onClick={emit} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{einv ? "Reintentar" : "Enviar a SUNAT"}</button>}
          {!eBusy && einv && ["enviado", "anulacion_pendiente"].includes(einv.status) && <button onClick={refresh} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer", color: C.ink }}>Actualizar estado</button>}
          {einv?.pdf_url && <a href={einv.pdf_url} target="_blank" rel="noreferrer" style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.ink }}>PDF oficial</a>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <button onClick={() => window.print()} style={{ ...quickLinkStyle, justifyContent: "center", fontWeight: 600 }}><Receipt size={16} /> Imprimir</button>
        <button onClick={onSendWhatsApp} style={{ ...quickLinkStyle, justifyContent: "center", background: "#25D366", color: C.ink, border: "none", fontWeight: 600 }}><MessageCircle size={15} /> WhatsApp</button>
      </div>
      {sale.notaInterna && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 10 }}>Nota interna (no se imprime): {sale.notaInterna}</div>}
      <PrimaryButton onClick={onNewSale}>Nueva venta</PrimaryButton>
    </div>
  );
};

// Buscar o registrar al cliente de la tienda física (para su boleta y sus puntos)
const PosClientPicker = ({ customers, onPick, onCreate, onClose }) => {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", doc: "", phone: "51" });
  const nq = q.trim().toLowerCase();
  const list = (customers || []).filter((c) => !String(c.phone || "").startsWith("g:")).filter((c) => !nq || `${c.name} ${c.phone} ${c.doc || ""} ${c.email || ""}`.toLowerCase().includes(nq)).slice(0, 30);
  return (
    <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 66, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
      <div className="sheet-panel" style={{ position: "relative", background: C.paper, borderRadius: "18px 18px 0 0", padding: "18px 20px 24px", maxHeight: "85vh", overflowY: "auto", animation: "slideUp .25s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{creating ? "Nuevo cliente" : "Cliente"}</div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {creating ? (
          <>
            <Field label="Nombre completo o razón social"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="DNI / RUC / Carnet de extranjería"><input style={inputStyle} value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 12) })} /></Field>
            <Field label="Celular (para sus puntos y WhatsApp)"><PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></Field>
            <PrimaryButton disabled={!form.name.trim()} onClick={() => onCreate({ ...form, name: form.name.trim(), phone: phoneIsValid(form.phone) ? form.phone : "" })}>Guardar y usar</PrimaryButton>
            <Faltan center items={[!form.name.trim() && "escribe el nombre completo o razón social"]} />
          </>
        ) : (
          <>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, celular o DNI" style={{ ...inputStyle, marginBottom: 10 }} />
            <button onClick={() => onPick(null)} style={{ width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.paperDeep, fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer", marginBottom: 8 }}>Cliente genérico (sin datos)</button>
            {list.map((c) => (
              <button key={c.phone} onClick={() => onPick(c)} style={{ width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", cursor: "pointer", marginBottom: 6 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{c.name}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>{[c.doc && `Doc. ${c.doc}`, c.phone && `+${c.phone}`, `${c.points || 0} puntos`].filter(Boolean).join(" · ")}</div>
              </button>
            ))}
            <button onClick={() => setCreating(true)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px", borderRadius: 9, border: `1px dashed ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 6 }}><Plus size={14} /> Registrar cliente nuevo</button>
          </>
        )}
      </div>
    </div>
  );
};

// Insignia de cada medio de pago (colores propios para reconocerlo de un vistazo; no son los logos oficiales)
const PAY_BADGES = {
  Yape: { bg: "#742284", fg: "#FFFFFF", text: "yape" },
  Plin: { bg: "linear-gradient(135deg, #00C3B2 0%, #0A6EC2 100%)", fg: "#FFFFFF", text: "plin" },
  Efectivo: { bg: "#2E7D32", fg: "#FFFFFF", text: "S/" },
  Transferencia: { bg: "#1F4E8C", fg: "#FFFFFF", icon: "bank" },
  Tarjeta: { bg: "#111111", fg: "#FFFFFF", icon: "card" },
  "Tarjeta (Culqi)": { bg: "#111111", fg: "#FFFFFF", icon: "card" },
  Mixto: { bg: "#8F8F8F", fg: "#FFFFFF", text: "+" },
  Vale: { bg: "#FFFFFF", fg: "#111111", text: "V", border: true },
};
// Pago con vale: código + saldo consultado al servidor (el servidor vuelve a revisar el saldo al guardar la venta)
const ValeInput = ({ pay, onChange }) => {
  const [code, setCode] = useState(pay.code || "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    const c = code.trim().toUpperCase(); if (!c) return;
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("credit_lookup", { p_code: c });
    setBusy(false);
    if (error) { setMsg(error.code === "PGRST202" ? "Falta correr el SQL 22 en Supabase." : "No se pudo consultar. Revisa tu conexión."); onChange({ code: "", balance: null }); return; }
    if (!data) { setMsg("Ese código de vale no existe."); onChange({ code: "", balance: null }); return; }
    if (data.status !== "activo" || Number(data.balance) <= 0) { setMsg(data.status === "anulado" ? "Ese vale está anulado." : data.status === "vencido" ? `Ese vale venció el ${new Date(data.expiresAt).toLocaleDateString("es-PE")}.` : "Ese vale ya no tiene saldo."); onChange({ code: "", balance: null }); return; }
    const amt = Math.min(Number(pay.amount) || 0, Number(data.balance));
    onChange({ code: data.code, balance: Number(data.balance), amount: amt.toFixed(2) });
    setMsg(`Saldo ${moneyExact(data.balance)}${data.customer ? ` · a nombre de ${data.customer}` : ""}${data.expiresAt ? ` · vence el ${new Date(data.expiresAt).toLocaleDateString("es-PE")}` : ""}${amt < Number(pay.amount) ? ". Cobra lo que falta con otro medio." : ""}`);
  };
  return (
    <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 10)); onChange({ code: "", balance: null }); }} onKeyDown={(e) => e.key === "Enter" && check()} placeholder="Código del vale (ej. V7K2QX)" style={{ ...inputStyle, flex: 1, textTransform: "uppercase" }} />
        <button onClick={check} disabled={busy || !code.trim()} style={{ padding: "0 14px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{busy ? "…" : "Ver saldo"}</button>
      </div>
      {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: pay.code ? C.ink : C.accent, marginTop: 6 }}>{msg}</div>}
      {pay.code && Number(pay.amount) > Number(pay.balance) + 0.004 && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginTop: 6 }}>El monto con vale pasa el saldo ({moneyExact(pay.balance)}).</div>}
    </div>
  );
};

const PayBadge = ({ method, size = 30 }) => {
  const b = PAY_BADGES[method] || { bg: C.paperDeep, fg: C.ink, text: String(method || "?").slice(0, 2) };
  const r = Math.round(size * 0.26);
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: r, background: b.bg, color: b.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,0,0,0.15)", ...(b.border ? { border: `1.5px solid ${C.ink}` } : {}) }}>
      {b.icon === "card" ? (
        <svg width={size * 0.66} height={size * 0.48} viewBox="0 0 22 16"><rect x="0.75" y="0.75" width="20.5" height="14.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="0" y="4" width="22" height="2.6" fill="currentColor" /><rect x="3" y="10" width="5" height="2" rx="0.5" fill="currentColor" /></svg>
      ) : b.icon === "bank" ? (
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 20 20"><path d="M10 2 L19 7 H1 Z" fill="currentColor" /><rect x="3" y="8" width="2" height="7" fill="currentColor" /><rect x="9" y="8" width="2" height="7" fill="currentColor" /><rect x="15" y="8" width="2" height="7" fill="currentColor" /><rect x="1" y="16" width="18" height="2" fill="currentColor" /></svg>
      ) : (
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: b.text.length > 2 ? size * 0.3 : size * 0.42, letterSpacing: "-0.02em", lineHeight: 1 }}>{b.text}</span>
      )}
    </span>
  );
};
const POS_PAY_OPTIONS = [["Efectivo", Banknote], ["Tarjeta", CreditCard], ["Yape", Smartphone], ["Plin", Smartphone], ["Transferencia", Landmark], ["Vale", Ticket]];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ceil10 = (n) => Math.ceil(round2(n) * 10 - 1e-9) / 10;
const GENERIC_DOC = "00000000";

// Cobro con guía de pasos: 1 cliente, 2 descuentos, 3 pago (se puede dividir entre varios medios)
// Tope del descuento manual para vendedoras (Panel → ajustes). Si no se configuró: 20%. Igual que en el servidor.
const posDiscountCap = (settings) => { const v = settings?.posMaxDiscountPct; return v === undefined || v === null || v === "" || isNaN(Number(v)) ? 20 : Number(v); };

const PosCheckout = ({ catalog, saleItems, subtotal, comprobanteTipo, setComprobanteTipo, onSaveCustomer, onConfirm, onClose, busy, staffName, role, channel = "tienda" }) => {
  const [sellers, setSellers] = useState([]);
  const [seller, setSeller] = useState(staffName || "");
  // Códigos de vendedor (MA01): si existen, en tienda cada venta pide el código de quien atendió
  const [sellerCodes, setSellerCodes] = useState([]);
  const [sellerCode, setSellerCode] = useState("");
  useEffect(() => { if (channel === "tienda") supabase.from("sellers").select("code,name").eq("active", true).then(({ data }) => setSellerCodes(data || [])).catch(() => {}); }, [channel]);
  const useCodes = channel === "tienda" && sellerCodes.length > 0;
  const codeMatch = sellerCodes.find((x) => x.code === sellerCode.trim().toUpperCase());
  useEffect(() => { supabase.rpc("staff_sellers").then(({ data }) => setSellers((data || []).map((x) => x.name))).catch(() => {}); }, []);
  const customers = (catalog.customers || []).filter((c) => !String(c.phone || "").startsWith("g:"));
  const [doc, setDoc] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("51");
  const [email, setEmail] = useState("");
  const [anon, setAnon] = useState(false);
  const [matched, setMatched] = useState(null);
  const [showSug, setShowSug] = useState(false);
  const [discType, setDiscType] = useState("none");
  const [discValue, setDiscValue] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState(null);
  const [promoMsg, setPromoMsg] = useState("");
  const [payments, setPayments] = useState([]);
  const [received, setReceived] = useState("");
  const [notaInterna, setNotaInterna] = useState("");
  const [notaExterna, setNotaExterna] = useState("");

  const isFactura = comprobanteTipo === "factura";
  // Outlet: precio final (sin cupón ni puntos), igual que lo revisa el servidor
  const outletIds = new Set(catalog.products.filter(isOutlet).map((p) => p.id));
  const regularSubtotal = saleItems.reduce((s, i) => s + (outletIds.has(i.productId) ? 0 : i.unitPrice * i.qty), 0);
  const hasOutletItems = regularSubtotal < subtotal;
  const promoDiscount = promo ? computeDiscount(promo, regularSubtotal) : 0;
  const manualDiscount = discType === "percent" ? round2(subtotal * Math.min(100, Number(discValue) || 0) / 100) : discType === "monto" ? Math.min(Number(discValue) || 0, subtotal) : 0;
  // Tope de descuento manual (Administración no tiene tope; el servidor también lo revisa)
  const isAdminRole = role === "superadmin" || role === "administrador";
  const discountCap = posDiscountCap(catalog.settings);
  const manualOverCap = !isAdminRole && manualDiscount > round2(subtotal * discountCap / 100) + 0.01;
  // Puntos del Club en tienda: solo con la clienta identificada (su celular registrado)
  const [usePts, setUsePts] = useState(false);
  const loyalty = loyaltyOf(catalog.settings);
  const ptsAvailable = matched && !anon && phone === matched.phone ? Number(matched.points) || 0 : 0;
  const ptsBlocks = clubOn(catalog.settings) && loyalty.blockValue > 0 ? Math.min(Math.floor(ptsAvailable / loyalty.blockPoints), Math.floor(Math.max(0, regularSubtotal - promoDiscount) / loyalty.blockValue)) : 0;
  const pointsUsed = usePts ? ptsBlocks * loyalty.blockPoints : 0;
  const pointsDiscount = usePts ? ptsBlocks * loyalty.blockValue : 0;
  useEffect(() => { setUsePts(false); }, [matched?.phone, anon]);
  const total = round2(Math.max(0, subtotal - promoDiscount - manualDiscount - pointsDiscount));
  const paid = round2(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const pending = round2(total - paid);
  const cash = payments.find((p) => p.method === "Efectivo");
  const change = cash && received ? round2(Number(received) - (Number(cash.amount) || 0)) : null;

  // Buscar cliente por documento (exacto) o por nombre (sugerencias)
  const byDoc = (d) => customers.find((c) => c.doc && c.doc === d);
  // Tipo de documento: DNI, carné de extranjería, pasaporte o RUC (la factura siempre pide RUC)
  const [docTypeSel, setDocTypeSel] = useState("DNI");
  const docType = isFactura ? "RUC" : docTypeSel;
  const [customerAddress, setCustomerAddress] = useState("");
  // Consulta DNI (RENIEC) / RUC (SUNAT) con el SQL 24: llena el nombre (y la dirección fiscal del RUC).
  // Si falta el SQL o el token, no se muestra nada y la caja sigue igual que siempre.
  const [lookup, setLookup] = useState(null); // { state: "loading" | "ok" | "nf" | "err", data, msg }
  const lookupCache = useRef({});
  const lookupOff = useRef(false);
  const autoFill = useRef({ name: "", address: "" });
  useEffect(() => {
    if (anon || matched || !(docType === "DNI" || docType === "RUC")) { setLookup(null); return; }
    // Si cambia el número, se borra lo que se había llenado solo con el número anterior (lo escrito a mano se respeta)
    const prevName = autoFill.current.name, prevAddr = autoFill.current.address;
    if (prevName) { setName((n) => (n === prevName ? "" : n)); autoFill.current.name = ""; }
    if (prevAddr) { setCustomerAddress((x) => (x === prevAddr ? "" : x)); autoFill.current.address = ""; }
    if (docType === "RUC" && doc.length === 11 && !rucValido(doc)) { setLookup({ state: "err", msg: "Este RUC no es válido: revisa los números." }); return; }
    if (lookupOff.current) { setLookup(null); return; }
    if (!(docType === "DNI" ? /^\d{8}$/.test(doc) : /^\d{11}$/.test(doc))) { setLookup(null); return; }
    const apply = (r) => {
      if (!r?.ok) return;
      setName((n) => (!n.trim() || n === autoFill.current.name ? r.name : n)); autoFill.current.name = r.name;
      if (docType === "RUC" && r.address) { setCustomerAddress((a) => (!a.trim() || a === autoFill.current.address ? r.address : a)); autoFill.current.address = r.address; }
    };
    const key = docType + doc;
    if (lookupCache.current[key]) { setLookup(lookupCache.current[key].view); apply(lookupCache.current[key].res); return; }
    let alive = true;
    setLookup({ state: "loading" });
    const tm = setTimeout(async () => {
      let res = null;
      try { const { data, error } = await supabase.rpc("lookup_document", { p_type: docType, p_number: doc }); res = error ? null : data; } catch (e) { res = null; }
      if (!alive) return;
      if (!res || res.reason === "NO_CONFIGURADO") { lookupOff.current = !res || res.reason === "NO_CONFIGURADO"; setLookup(null); return; }
      const why = { SIN_SALDO: "Se acabaron las consultas del plan del proveedor: escribe el nombre a mano.", LIMITE: "Se alcanzó el límite de consultas de esta hora: escribe el nombre a mano.", SIN_CONEXION: "No se pudo consultar ahora: escribe el nombre a mano.", TOKEN_RECHAZADO: "La consulta de DNI/RUC no está funcionando (token). Avisa a Administración.", RUC_INVALIDO: "Este RUC no es válido: revisa los números.", NUMERO_INVALIDO: "Revisa el número." };
      const view = res.ok ? { state: "ok", data: res } : res.reason === "NO_ENCONTRADO" ? { state: "nf" } : { state: "err", msg: why[res.reason] || "No se pudo consultar: escribe el nombre a mano." };
      lookupCache.current[key] = { view, res };
      setLookup(view); apply(res);
    }, 350);
    return () => { alive = false; clearTimeout(tm); };
  }, [doc, docType, anon, matched]);
  const onDoc = (v) => {
    const max = { DNI: 8, RUC: 11, CE: 12, PAS: 12 }[docType] || 12;
    const d = (docType === "DNI" || docType === "RUC" ? v.replace(/\D/g, "") : v.replace(/[^0-9A-Za-z]/g, "").toUpperCase()).slice(0, max);
    setDoc(d); setAnon(false);
    const hit = d.length >= 8 ? byDoc(d) : null;
    setMatched(hit || null);
    if (hit) { setName(hit.name); setPhone(hit.phone || "51"); setEmail(hit.email || ""); }
  };
  const nameSug = name.trim().length >= 2 && !matched ? customers.filter((c) => c.name.toLowerCase().includes(name.trim().toLowerCase())).slice(0, 5) : [];
  const pick = (c) => { setMatched(c); setName(c.name); setDoc(c.doc || ""); setPhone(c.phone || "51"); setEmail(c.email || ""); setShowSug(false); };
  const toggleAnon = (on) => { setAnon(on); setMatched(null); if (on) { setDoc(GENERIC_DOC); setName("Cliente varios"); setPhone("51"); setEmail("sincorreo@flyboutique.pe"); } else { setDoc(""); setName(""); setEmail(""); } };

  const docOk = anon ? !isFactura : docType === "RUC" ? /^\d{11}$/.test(doc) : docType === "DNI" ? /^\d{8}$/.test(doc) : doc.length >= (docType === "CE" ? 9 : 6);
  const nameOk = name.trim().length >= 3;
  // Correo opcional en tienda: solo se revisa si lo escriben. Para factura, la dirección fiscal es obligatoria.
  const emailOk = anon || !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const addressOk = anon || docType !== "RUC" || customerAddress.trim().length >= 5;
  const customerOk = docOk && nameOk && emailOk && addressOk;
  const valePay = payments.find((p) => p.method === "Vale");
  const valeOk = !valePay || (valePay.code && valePay.balance != null && Number(valePay.amount) <= Number(valePay.balance) + 0.004);
  const paymentsOk = payments.length > 0 && Math.abs(pending) < 0.005 && (!cash || !received || Number(received) >= Number(cash.amount)) && valeOk;
  const canConfirm = customerOk && paymentsOk && saleItems.length > 0 && !busy && !manualOverCap && (!useCodes || !!codeMatch);

  // Tocar un medio: si ya está, se quita; si no falta nada por cobrar, reemplaza al último; si falta, se agrega con lo pendiente
  const addPayment = (m) => {
    setPayments((ps) => {
      if (ps.some((p) => p.method === m)) return ps.filter((p) => p.method !== m);
      if (pending <= 0.004 && ps.length) return [...ps.slice(0, -1), { ...ps[ps.length - 1], method: m }];
      return [...ps, { method: m, amount: (pending > 0 ? pending : total).toFixed(2) }];
    });
  };
  const applyPromo = () => { const p = findPromo(catalog.promoCodes, promoInput); if (!p) { setPromoMsg("Código no válido"); return; } setPromo(p); setPromoMsg(`Código ${p.code} aplicado`); };
  const confirm = () => {
    if (!canConfirm) return;
    const cleanPhone = phoneIsValid(phone) ? phone : "";
    if (!anon && cleanPhone && !matched && onSaveCustomer) onSaveCustomer({ name: name.trim(), doc, phone: cleanPhone, email: email.trim() });
    onConfirm({
      customerName: name.trim(), customerDoc: doc, customerDocType: anon ? "" : docType, customerAddress: docType === "RUC" ? customerAddress.trim() : "", customerPhone: anon ? "" : cleanPhone, customerEmail: anon ? "" : email.trim(),
      payments: payments.map((p) => ({ method: p.method, amount: round2(p.amount), ...(p.method === "Vale" ? { code: p.code } : {}) })),
      paymentMethod: payments.length > 1 ? "Mixto" : payments[0].method,
      amountReceived: cash && received ? Number(received) : null, vuelto: change && change > 0 ? change : 0,
      promoCode: promo?.code || null, discount: round2(promoDiscount + manualDiscount + pointsDiscount), subtotal, total,
      pointsUsed, pointsDiscount,
      manualDiscountLabel: manualDiscount > 0 ? (discType === "percent" ? `${discValue}%` : money(Number(discValue))) : null,
      notaInterna: notaInterna.trim(), notaExterna: notaExterna.trim(), anonymous: anon,
      ...(useCodes ? { sellerCode: codeMatch.code, staffName: codeMatch.name } : { staffName: seller || staffName }),
    });
  };
  const step = (n, title, ok, hint) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 10px" }}>
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: ok ? C.ink : "transparent", border: `1.5px solid ${C.ink}`, color: ok ? C.paper : C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700 }}>{ok ? "✓" : n}</span>
      <div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, color: C.ink }}>{title}</div>{hint && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{hint}</div>}</div>
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 65, background: C.paper, overflowY: "auto" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 3, background: C.ink, color: C.paper, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px" }}>
        <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.paper, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}><ArrowLeft size={16} /> Volver a la venta</button>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800 }}>Cobrar · {money(total)}</div>
      </div>
      <div className="checkout-grid" style={{ maxWidth: 1180, margin: "0 auto", padding: "16px 18px 40px" }}>
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["boleta", "Boleta / Nota de venta"], ["factura", "Factura"]].map(([k, l]) => <Chip key={k} active={comprobanteTipo === k} onClick={() => { setComprobanteTipo(k); if (k === "factura") toggleAnon(false); }}>{l}</Chip>)}
          </div>
          {step(1, "Cliente", customerOk, isFactura ? "Escribe el RUC: si ya compró antes, se completa solo." : "Escribe el DNI: si ya es cliente, se completa solo y suma sus puntos.")}
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, marginBottom: 6 }}>Los datos con * son obligatorios.</div>
          {!anon && !isFactura && (
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {[["DNI", "DNI"], ["CE", "Carné ext."], ["PAS", "Pasaporte"], ["RUC", "RUC"]].map(([k, l]) => <Chip key={k} active={docType === k} onClick={() => { setDocTypeSel(k); setDoc(""); setMatched(null); }}>{l}</Chip>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input autoFocus value={anon ? GENERIC_DOC : doc} disabled={anon} onChange={(e) => onDoc(e.target.value)} inputMode={docType === "DNI" || docType === "RUC" ? "numeric" : "text"} placeholder={{ DNI: "DNI (8 dígitos) *", RUC: "RUC (11 dígitos) *", CE: "Carné de extranjería *", PAS: "Pasaporte *" }[docType]} style={{ ...inputStyle, flex: 1, fontSize: 15 }} />
          </div>
          {lookup && !matched && (() => {
            const src = docType === "RUC" ? "SUNAT" : "RENIEC";
            const d = lookup.data || {};
            const warn = lookup.state === "ok" && docType === "RUC" && ((d.estado && d.estado.toUpperCase() !== "ACTIVO") || (d.condicion && d.condicion.toUpperCase() !== "HABIDO"));
            const txt = lookup.state === "loading" ? `Buscando en ${src}…` : lookup.state === "nf" ? `No aparece en ${src}: escribe el nombre a mano.` : lookup.state === "err" ? lookup.msg
              : docType === "RUC" ? `${warn ? "⚠" : "✓"} ${src}${d.estado ? ` · ${d.estado}` : ""}${d.condicion ? ` · ${d.condicion}` : ""}${d.source === "memoria" ? " (consultado antes)" : ""}` : `✓ Datos de ${src}${d.source === "memoria" ? " (consultado antes)" : ""}`;
            return (
              <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, background: C.paperDeep, borderRadius: 9, padding: "8px 12px", marginBottom: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: lookup.state === "err" || warn ? C.accent : C.ink }}>
                {lookup.state === "loading" && <Loader2 size={14} className="spin" />}
                <span>{txt}{warn ? " · Ojo: para factura SUNAT pide RUC activo y habido." : ""}</span>
              </div>
            );
          })()}
          {matched && <div style={{ background: C.paperDeep, borderRadius: 9, padding: "9px 12px", marginBottom: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>✓ Cliente registrado: <strong>{matched.name}</strong> · {matched.points || 0} puntos</div>}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input value={name} disabled={anon} onChange={(e) => { setName(e.target.value); setMatched(null); setShowSug(true); }} onFocus={() => setShowSug(true)} placeholder={isFactura || docType === "RUC" ? "Razón social *" : "Nombres y apellidos *"} style={{ ...inputStyle, fontSize: 15 }} />
            {showSug && nameSug.length > 0 && (
              <div style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 9, boxShadow: "0 10px 24px rgba(0,0,0,0.12)", marginTop: 4 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, padding: "8px 12px 2px" }}>Clientes que ya existen:</div>
                {nameSug.map((c) => <button key={c.phone} onClick={() => pick(c)} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5 }}><strong>{c.name}</strong> <span style={{ color: C.stone }}>{c.doc ? `· ${c.doc}` : ""} · +{c.phone}</span></button>)}
              </div>
            )}
          </div>
          {!anon && docType === "RUC" && <input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Dirección fiscal de la empresa *" style={{ ...inputStyle, marginBottom: 8 }} />}
          {!anon && (
            <>
              <PhoneInput value={phone} onChange={setPhone} placeholder="Celular (opcional, para sus puntos)" style={{ marginBottom: 8 }} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Correo (opcional: para ver sus compras y puntos)" style={{ ...inputStyle, marginBottom: 8, borderColor: email && !emailOk ? C.accent : undefined }} />
            </>
          )}
          {!isFactura && <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 18 }}><input type="checkbox" checked={anon} onChange={(e) => toggleAnon(e.target.checked)} /> El cliente no quiere dar sus datos (se registra como "Cliente varios", sin puntos)</label>}

          {step(2, "Descuentos", true, "Opcional")}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={discType} onChange={(e) => { setDiscType(e.target.value); setDiscValue(""); }} style={{ ...inputStyle, flex: 1 }}>
              <option value="none">Sin descuento manual</option><option value="percent">Porcentaje (%)</option><option value="monto">Monto (S/)</option>
            </select>
            {discType !== "none" && <input inputMode="decimal" value={discValue} onChange={(e) => setDiscValue(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={discType === "percent" ? "Ej. 10" : "Ej. 15.50"} style={{ ...inputStyle, flex: 1 }} />}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <input value={promoInput} disabled={!!promo} onChange={(e) => setPromoInput(e.target.value)} placeholder="Código promocional" style={inputStyle} />
            <button onClick={promo ? () => { setPromo(null); setPromoInput(""); setPromoMsg(""); } : applyPromo} style={{ padding: "0 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>{promo ? "Quitar" : "Aplicar"}</button>
          </div>
          {promoMsg && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: promo ? C.ink : C.accent, marginBottom: 8 }}>{promoMsg}</div>}
          {hasOutletItems && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.inkSoft, marginBottom: 8 }}>Hay prendas <strong>Outlet</strong>: precio final. El cupón y los puntos solo se aplican al resto, y no suman puntos.</div>}
          {manualOverCap && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.accent, marginBottom: 8 }}>El descuento manual máximo es {discountCap}% ({money(subtotal * discountCap / 100)}). Para más, pide a Administración que cobre la venta.</div>}
          {ptsBlocks > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${usePts ? C.ink : C.line}`, borderRadius: 10, padding: "10px 12px", margin: "8px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={usePts} onChange={(e) => setUsePts(e.target.checked)} />
              <Star size={14} color={C.ink} />
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>Usar {ptsBlocks * loyalty.blockPoints} puntos de {matched.name.split(" ")[0]}: <strong>-{money(ptsBlocks * loyalty.blockValue)}</strong> <span style={{ color: C.stone }}>(tiene {ptsAvailable})</span></span>
            </label>
          )}
          <input value={notaInterna} onChange={(e) => setNotaInterna(e.target.value)} placeholder="Comentario interno (solo el staff lo ve)" style={{ ...inputStyle, margin: "10px 0 8px" }} />
          <input value={notaExterna} onChange={(e) => setNotaExterna(e.target.value)} placeholder="Comentario en el comprobante (ej. gracias por tu compra)" style={{ ...inputStyle, marginBottom: 18 }} />
        </div>

        <div className="checkout-right">
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
            {saleItems.map((i) => {
              const prod = catalog.products.find((p) => p.id === i.productId);
              const img = prod ? (imgThumb(colorPhotos(prod, i.colorName)[0]) || mainImageUrl(prod)) : null;
              return (
                <div key={i.saleItemId} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, padding: "5px 0" }}>
                  <div style={{ width: 38, height: 50, borderRadius: 6, overflow: "hidden", background: C.paperDeep, flexShrink: 0 }}>{img && <ProductImg src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
                  <span style={{ flex: 1 }}>{i.name}<br /><span style={{ color: C.stone, fontSize: 11.5 }}>{i.size} / {i.colorName} × {i.qty}</span></span>
                  <span style={{ fontWeight: 600 }}>{money(i.unitPrice * i.qty)}</span>
                </div>
              );
            })}
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 8, paddingTop: 8 }}>
              <Row label="Subtotal" value={money(subtotal)} />
              {promoDiscount > 0 && <Row label={`Código ${promo.code}`} value={`-${money(promoDiscount)}`} />}
              {manualDiscount > 0 && <Row label="Descuento manual" value={`-${money(manualDiscount)}`} />}
              {pointsDiscount > 0 && <Row label={`Puntos Fly (${pointsUsed} pts)`} value={`-${money(pointsDiscount)}`} />}
              <Row label="Total a cobrar" value={money(total)} bold />
            </div>
          </div>
          {useCodes ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 6 }}>¿Quién atendió? * <span style={{ color: C.stone }}>Toca su nombre o escribe su código</span></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {sellerCodes.map((x) => {
                  const on = codeMatch?.code === x.code;
                  return (
                    <button key={x.code} onClick={() => setSellerCode(x.code)} title={`Atendió ${x.name} (${x.code})`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 7px", borderRadius: 999, border: `1.5px solid ${on ? C.ink : C.line}`, background: on ? C.ink : C.paper, color: on ? C.paper : C.ink, cursor: "pointer" }}>
                      <span style={{ width: 28, height: 28, borderRadius: "50%", background: on ? C.paper : C.paperDeep, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 800 }}>{x.code.slice(0, 2)}</span>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600 }}>{x.name.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, whiteSpace: "nowrap" }}>Código:</span>
                <input value={sellerCode} onChange={(e) => setSellerCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))} placeholder="Ej. MA01" autoCapitalize="characters" style={{ ...inputStyle, flex: 1, fontSize: 15, letterSpacing: "0.08em", borderColor: sellerCode && !codeMatch ? C.accent : undefined }} />
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, marginTop: 4, color: codeMatch ? C.ink : C.stone }}>{codeMatch ? `✓ ${codeMatch.name}` : sellerCode ? "Código no encontrado" : "Obligatorio para registrar la venta"}</div>
            </div>
          ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, whiteSpace: "nowrap" }}>Atendió:</span>
            <select value={seller} onChange={(e) => setSeller(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              {[...new Set([staffName, ...sellers].filter(Boolean))].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          )}
          {step(3, "Pago", paymentsOk, "Toca uno o varios medios. Puedes dividir el pago (ej. S/ 20 tarjeta + S/ 80 efectivo).")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
            {POS_PAY_OPTIONS.map(([m, Icon]) => {
              const used = payments.some((p) => p.method === m);
              return (
                <button key={m} onClick={() => addPayment(m)} title={used ? `Quitar pago con ${m}` : `Cobrar con ${m}. Puedes combinar varios medios.`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 4px", borderRadius: 10, border: `1.5px solid ${used ? C.ink : C.line}`, background: used ? C.ink : C.paper, color: used ? C.paper : C.ink, cursor: "pointer" }}>
                  <PayBadge method={m} size={32} /><span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600 }}>{m}</span>
                </button>
              );
            })}
          </div>
          {payments.map((p, idx) => (
            <div key={p.method} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink, width: 110 }}>{p.method}</span>
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>S/</span>
              <input inputMode="decimal" value={p.amount} onChange={(e) => setPayments((ps) => ps.map((x, j) => (j === idx ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x)))} style={{ ...inputStyle, flex: 1, fontSize: 15 }} />
              <button onClick={() => setPayments((ps) => ps.filter((_, j) => j !== idx))} aria-label="Quitar pago" style={{ background: "none", border: "none", cursor: "pointer" }}><X size={16} /></button>
            </div>
          ))}
          {payments.some((p) => p.method === "Vale") && (
            <ValeInput pay={payments.find((p) => p.method === "Vale")} onChange={(patch) => setPayments((ps) => ps.map((x) => (x.method === "Vale" ? { ...x, ...patch } : x)))} />
          )}
          {cash && (
            <div style={{ background: C.paperDeep, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, width: 140 }}>Efectivo recibido S/</span>
                <input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={Number(cash.amount || 0).toFixed(2)} style={{ ...inputStyle, flex: 1, fontSize: 15 }} />
              </div>
              {/* Billetes rápidos: un toque y calcula el vuelto */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <button onClick={() => setReceived(Number(cash.amount || 0).toFixed(2))} title="La clienta pagó con el monto justo" style={{ padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${C.ink}`, background: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Exacto</button>
                {[10, 20, 50, 100, 200].filter((b) => b >= Number(cash.amount || 0) * 0.2).map((b) => (
                  <button key={b} onClick={() => setReceived(String(b))} title={`La clienta pagó con S/ ${b}: calcula el vuelto`} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${Number(received) === b ? C.ink : C.line}`, background: Number(received) === b ? C.ink : C.paper, color: Number(received) === b ? C.paper : C.ink, fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, cursor: "pointer", minWidth: 58 }}>S/ {b}</button>
                ))}
              </div>
              {change !== null && (change >= 0
                ? <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.ink, marginTop: 8 }}>Vuelto: <strong style={{ fontSize: 18 }}>{money(change)}</strong>{Math.abs(change * 10 - Math.round(change * 10)) > 1e-6 && <span style={{ fontSize: 11.5, color: C.stone }}> · sin céntimos, entrega {money(ceil10(change))} (redondeo a favor del cliente)</span>}</div>
                : <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginTop: 8 }}>El efectivo recibido es menor al monto en efectivo.</div>)}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>{pending > 0.004 ? "Falta cobrar" : pending < -0.004 ? "Se cobró de más" : "Cobrado completo"}</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: Math.abs(pending) < 0.005 ? C.ink : C.accent }}>{money(Math.abs(pending))}</span>
          </div>
          {!canConfirm && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 8, lineHeight: 1.5 }}><span style={{ color: C.accent, fontWeight: 600 }}>Falta completar (*):</span> {[!docOk && (docType === "RUC" ? "RUC de 11 dígitos" : docType === "DNI" ? "DNI de 8 dígitos" : "documento del cliente"), !nameOk && "nombre del cliente", !addressOk && "dirección fiscal", !emailOk && "correo válido (o déjalo vacío)", useCodes && !codeMatch && "quién atendió", !paymentsOk && "completar el pago", manualOverCap && "bajar el descuento manual"].filter(Boolean).join(", ")}.</div>}
          <PrimaryButton disabled={!canConfirm} onClick={confirm}>{busy ? "Registrando…" : `Registrar venta · ${money2(total)}`}</PrimaryButton>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.stone, marginTop: 8, lineHeight: 1.5 }}>Comprobante interno hasta activar la facturación electrónica SUNAT.</div>
        </div>
      </div>
    </div>
  );
};

const PosScreen = ({ catalog, staffName, onCompleteSale, onReserveNumber, onSaveCustomer, channel = "tienda", title = "Punto de Venta", role, onGoCash }) => {
  const [confirmingSale, setConfirmingSale] = useState(false);
  const [posCategory, setPosCategory] = useState("Todo");
  const [customerPhone, setCustomerPhone] = useState("");
  const [showClients, setShowClients] = useState(false);
  const posStores = storesOf(catalog.settings);
  const [storeId, setStoreId] = useState(() => { try { return localStorage.getItem("flyboutique:sede") || posStores[0].id; } catch (e) { return posStores[0].id; } });
  const currentStore = posStores.find((x) => x.id === storeId) || posStores[0];
  // Venta en tienda: solo con la caja de la sede abierta (el servidor también lo exige)
  const [cashState, setCashState] = useState("loading"); // loading | open | closed | unknown
  const checkCash = async () => {
    if (channel !== "tienda") { setCashState("open"); return; }
    const { data, error } = await supabase.rpc("current_cash", { p_store: currentStore.id });
    setCashState(error ? "unknown" : data ? "open" : "closed"); // unknown: aún no se corrió el SQL de caja → no se bloquea
  };
  useEffect(() => {
    checkCash();
    window.addEventListener("focus", checkCash);
    return () => window.removeEventListener("focus", checkCash);
  }, [currentStore.id, channel]);
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
  // Identificador de este cobro: si se corta internet y se reintenta, el servidor no duplica la venta
  const requestIdRef = useRef(null);
  useEffect(() => { requestIdRef.current = null; }, [saleItems]);

  const suggestions = q.trim() ? catalog.products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.variants.some((v) => v.sku?.toLowerCase().includes(q.toLowerCase()))).slice(0, 6) : [];

  // Lector de códigos: al leer, muestra la prenda encontrada para confirmar con Enter o un toque
  const [scanned, setScanned] = useState(null);
  const handleScanEnter = (e) => {
    if (e.key !== "Enter") return;
    const val = q.trim().toLowerCase();
    if (!val) return;
    for (const p of catalog.products) {
      const v = p.variants.find((vv) => vv.sku && vv.sku.toLowerCase() === val);
      if (v) { setScanned({ p, v }); setQ(""); return; }
    }
    alert(`No se encontró ningún producto con el código "${q.trim()}".`); setQ("");
  };
  const confirmScanned = () => { if (!scanned) return; addItem(scanned.p, scanned.v.size, { n: scanned.v.colorName, h: scanned.v.colorHex }, 1); setScanned(null); };

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
  const outletIds = new Set(catalog.products.filter(isOutlet).map((p) => p.id));
  const promoDiscount = appliedPromo ? computeDiscount(appliedPromo, saleItems.reduce((s, i) => s + (outletIds.has(i.productId) ? 0 : i.unitPrice * i.qty), 0)) : 0;
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

  const confirmSale = async (extra = null) => {
    if (!extra && comprobanteTipo === "factura" && !customerDoc.trim()) { alert("Ingresa el RUC para factura."); return; }
    if (confirmingSale) return;
    const serie = comprobanteTipo === "factura" ? "F001" : "B001";
    const sale = {
      tipo: comprobanteTipo, serie,
      items: saleItems, subtotal, discount, promoCode: appliedPromo?.code || null,
      manualDiscountLabel: manualDiscount > 0 ? (manualDiscountType === "percent" ? `${manualDiscountValue}%` : money(Number(manualDiscountValue))) : null,
      total, paymentMethod, amountReceived: amountReceived ? Number(amountReceived) : null, vuelto: vuelto || 0,
      notaInterna: notaInterna.trim(), notaExterna: notaExterna.trim(),
      customerName: customerName.trim(), customerDoc: customerDoc.trim(), customerPhone: customerPhone || "",
      storeId: channel === "tienda" ? currentStore.id : "web", storeName: channel === "tienda" ? currentStore.name : "Tienda online",
      staffName, channel, source: "pos", status: "emitido", createdAt: Date.now(),
      ...(extra || {}),
    };
    if (!requestIdRef.current) requestIdRef.current = genId("req");
    sale.clientRequestId = requestIdRef.current;
    setConfirmingSale(true);
    const saved = await onCompleteSale(sale);
    setConfirmingSale(false);
    if (!saved) { checkCash(); return; }
    requestIdRef.current = null;
    setLastSale(saved);
    setSaleItems([]); setShowCheckout(false); setCustomerName(""); setCustomerDoc(""); setCustomerPhone(""); setAppliedPromo(null); setPromoInput(""); setPromoMsg(null);
    setManualDiscountType("none"); setManualDiscountValue(""); setAmountReceived(""); setNotaInterna(""); setNotaExterna("");
  };

  const sendReceiptWhatsApp = () => {
    const lines = [`Comprobante Fly Boutique ${lastSale.serie}-${String(lastSale.numero).padStart(6, "0")}`, "",
      ...lastSale.items.map((i) => `• ${i.name} — ${i.size}/${i.colorName} × ${i.qty} — ${money(i.unitPrice * i.qty)}`),
      "", ...(lastSale.discount ? [`Descuento (${lastSale.promoCode}): -${money(lastSale.discount)}`] : []), `Total: ${money(lastSale.total)}`, `Pago: ${lastSale.paymentMethod}`, "", "¡Gracias por tu compra en Fly Boutique!"];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  if (lastSale) return <ReceiptView sale={lastSale} settings={catalog.settings} onNewSale={() => setLastSale(null)} onSendWhatsApp={sendReceiptWhatsApp} autoEmit />;

  const posCategories = ["Todo", ...new Set(catalog.products.map((p) => p.category))];
  const tiles = (q.trim() ? suggestions : catalog.products.filter((p) => posCategory === "Todo" || p.category === posCategory)).filter((p) => p.status !== "inactivo");
  const itemsCount = saleItems.reduce((a, i) => a + i.qty, 0);
  if (channel === "tienda" && cashState === "closed") {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
        <Banknote size={30} color={C.line} style={{ marginBottom: 12 }} />
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, color: C.ink, marginBottom: 8 }}>La caja de {currentStore.name} está cerrada</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, marginBottom: 18, lineHeight: 1.6 }}>
          {["superadmin", "administrador", "cajero"].includes(role)
            ? "Para vender en tienda primero hay que abrir la caja con el fondo inicial."
            : <>Tu usuario ({ROLE_LABELS[role] || role}) puede vender, pero <strong>no abrir la caja</strong>. Pide al cajero o a Administración que la abra y luego toca «Ya está abierta, revisar».<br /><br />Si tú eres quien abre la caja, pide en Administración que a tu usuario le pongan el rol <strong>Cajero(a)</strong>.</>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {["superadmin", "administrador", "cajero"].includes(role) && onGoCash && <button onClick={onGoCash} style={{ padding: "12px 20px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Ir a abrir la caja</button>}
          <button onClick={checkCash} style={{ padding: "12px 20px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Ya está abierta, revisar</button>
        </div>
        {posStores.length > 1 && <select value={currentStore.id} onChange={(e) => { setStoreId(e.target.value); try { localStorage.setItem("flyboutique:sede", e.target.value); } catch (err) { /* nada */ } }} style={{ ...inputStyle, width: "auto", marginTop: 16 }}>{posStores.map((x) => <option key={x.id} value={x.id}>Sede: {x.name}</option>)}</select>}
      </div>
    );
  }
  return (
    <div className={`pos${saleItems.length ? " pos-busy" : ""}`} style={{ padding: "16px 16px 90px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>{title}</h1>
          {channel === "tienda" && (
            <select value={currentStore.id} onChange={(e) => { setStoreId(e.target.value); try { localStorage.setItem("flyboutique:sede", e.target.value); } catch (err) { /* nada */ } }} style={{ ...inputStyle, width: "auto", maxWidth: "100%", padding: "7px 10px" }} aria-label="Sede">
              {posStores.map((x) => <option key={x.id} value={x.id}>Sede: {x.name}</option>)}
            </select>
          )}
        </div>
        <select value={comprobanteTipo} onChange={(e) => setComprobanteTipo(e.target.value)} aria-label="Tipo de comprobante" style={{ ...inputStyle, width: "auto", maxWidth: "100%", padding: "8px 10px" }}>
          <option value="boleta">Boleta / Nota de venta</option>
          <option value="factura">Factura</option>
        </select>
      </div>
      <div className="pos-grid">
        <div className="pos-left">
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.ink}`, borderRadius: 9, padding: "0 12px", marginBottom: 10, background: C.paper }}>
            <Scan size={15} color={C.ink} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleScanEnter} placeholder="Lector de códigos o buscar producto"
              style={{ border: "none", outline: "none", padding: "12px 0", fontFamily: FONT_BODY, fontSize: 13, flex: 1, background: "transparent" }} />
            {q && <button onClick={() => setQ("")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={15} color={C.stone} /></button>}
          </div>
          {scanned && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, border: `2px solid ${C.ink}`, borderRadius: 12, padding: 10, marginBottom: 12 }}>
              <div style={{ width: 54, height: 68, borderRadius: 6, overflow: "hidden", background: C.paperDeep, flexShrink: 0 }}><ProductImg src={mainImageUrl(scanned.p)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>Código leído · stock {scanned.v.stock}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, color: C.ink }}>{scanned.p.name}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft }}>Talla {scanned.v.size} · {scanned.v.colorName} · {money(scanned.p.price)}</div>
              </div>
              <button autoFocus onClick={confirmScanned} onKeyDown={(e) => e.key === "Escape" && setScanned(null)} disabled={scanned.v.stock <= 0} style={{ padding: "12px 16px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: scanned.v.stock <= 0 ? 0.4 : 1 }}>{scanned.v.stock <= 0 ? "Sin stock" : "Agregar (Enter)"}</button>
              <button onClick={() => setScanned(null)} aria-label="Cancelar" style={{ background: "none", border: "none", cursor: "pointer" }}><X size={16} /></button>
            </div>
          )}
          {!q.trim() && (
            <div className="hscroll" style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 12, scrollbarWidth: "none" }}>
              {posCategories.map((c) => <Chip key={c} active={posCategory === c} onClick={() => setPosCategory(c)}>{c}</Chip>)}
            </div>
          )}
          <div className="pos-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
            {tiles.map((p) => {
              const st = productTotalStock(p);
              return (
                <button key={p.id} onClick={() => st > 0 && setPicking(p)} disabled={st <= 0} style={{ textAlign: "left", padding: 8, borderRadius: 10, border: `1px solid ${C.line}`, background: C.paper, cursor: st > 0 ? "pointer" : "not-allowed", opacity: st > 0 ? 1 : 0.5 }}>
                  <div style={{ borderRadius: 7, overflow: "hidden", background: C.paperDeep, marginBottom: 6 }}><ProductImg src={mainImageUrl(p)} alt={p.name} dim={st <= 0} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} /></div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: C.ink }}>{money(p.price)}</span>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: st <= 5 ? C.accent : C.stone, fontWeight: st <= 5 ? 600 : 400 }}>{st <= 0 ? "Agotado" : `Stock ${st}`}</span>
                  </div>
                </button>
              );
            })}
            {tiles.length === 0 && <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 24, fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>No hay productos con esa búsqueda.</div>}
          </div>
        </div>

        <div className="pos-right">
          <button onClick={() => setShowClients(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", marginBottom: 12, textAlign: "left" }}>
            <User size={16} color={C.ink} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{customerName || "Cliente genérico"}</span>
              <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{customerDoc ? `Doc. ${customerDoc}` : "Tocar para buscar o registrar"}{customerPhone ? ` · +${customerPhone}` : ""}</span>
            </span>
            <ChevronRight size={15} color={C.ink} />
          </button>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.stone, marginBottom: 8 }}>Venta actual ({itemsCount})</div>
          {saleItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: 26, fontFamily: FONT_BODY, fontSize: 12, color: C.stone, border: `1px dashed ${C.line}`, borderRadius: 10, marginBottom: 12 }}>Escanea o toca una prenda para agregarla</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {saleItems.map((i) => (
                <div key={i.saleItemId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 10px", borderRadius: 9, border: `1px solid ${C.line}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}>{i.size} · {i.colorName} · {money(i.unitPrice)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <button className="tap-round" onClick={() => updateQty(i.saleItemId, -1)} aria-label="Menos"><Minus size={15} /></button>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, minWidth: 16, textAlign: "center" }}>{i.qty}</span>
                    <button className="tap-round" onClick={() => updateQty(i.saleItemId, 1)} aria-label="Más"><Plus size={15} /></button>
                    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 800, color: C.ink, minWidth: 54, textAlign: "right" }}>{money(i.unitPrice * i.qty)}</span>
                    <button className="tap-round tap-plain" onClick={() => removeItem(i.saleItemId)} aria-label="Quitar"><Trash2 size={15} color={C.ink} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${C.line}`, marginBottom: 12 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, color: C.ink }}>Subtotal</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 800, color: C.ink }}>{money(subtotal)}</span>
          </div>
          <PrimaryButton disabled={!saleItems.length} onClick={() => setShowCheckout(true)}><Receipt size={15} /> Cobrar {saleItems.length ? money(subtotal) : ""}</PrimaryButton>
        </div>
      </div>

      {showClients && (
        <PosClientPicker customers={catalog.customers} onClose={() => setShowClients(false)}
          onPick={(c) => { setCustomerName(c?.name || ""); setCustomerDoc(c?.doc || ""); setCustomerPhone(c?.phone || ""); setShowClients(false); }}
          onCreate={(c) => { if (onSaveCustomer && c.phone) onSaveCustomer(c); setCustomerName(c.name); setCustomerDoc(c.doc || ""); setCustomerPhone(c.phone || ""); setShowClients(false); }} />
      )}
      {picking && <PosVariantPicker product={picking} onClose={() => setPicking(null)} onAdd={addItem} />}

      {showCheckout && (
        <PosCheckout catalog={catalog} saleItems={saleItems} subtotal={subtotal} comprobanteTipo={comprobanteTipo} setComprobanteTipo={setComprobanteTipo}
          onSaveCustomer={null} onClose={() => setShowCheckout(false)} busy={confirmingSale} staffName={staffName} role={role} channel={channel}
          onConfirm={(extra) => confirmSale(extra)} />
      )}
    </div>
  );
};

/* ==================================================================== */
/*  ============================  COMPROBANTES  ========================*/
/* ==================================================================== */
// Devolución parcial o cambio (talla, color u otra prenda) de una venta ya hecha. Lo calcula y guarda el servidor (SQL 21).
const RETURN_ERRORS = {
  SIN_PERMISO: "Tu usuario no puede hacer devoluciones (solo Caja y Administración).", MOTIVO_REQUERIDO: "Escribe el motivo.",
  YA_DEVUELTO: "Esa cantidad ya fue devuelta antes.", NO_ESTA_EN_LA_VENTA: "Esa prenda no está en esta venta.", VENTA_ANULADA: "La venta está anulada.",
  PEDIDO_SIN_PAGO: "El pedido aún no tiene el pago validado: cancélalo en Pedidos Web.", SIN_STOCK: "No hay stock de la prenda nueva.",
  CAJA_CERRADA: "Para devolver o cobrar en efectivo, la caja tiene que estar abierta.", VENDEDOR_INVALIDO: "Ese código de vendedora no existe o está inactivo.",
  NADA_PARA_DEVOLVER: "Elige al menos una prenda que vuelve.", NUMERO_INVALIDO: "Escribe el número así: B001-000123.",
};
const returnErrorText = (e) => {
  if (e?.code === "PGRST202") return "Falta correr el SQL 21 en Supabase.";
  const m = e?.message || "";
  const k = Object.keys(RETURN_ERRORS).find((x) => m.includes(x));
  if (k === "YA_DEVUELTO") return `Solo quedan ${m.split("YA_DEVUELTO:")[1] || 0} por devolver de esa prenda.`;
  return k ? RETURN_ERRORS[k] : "No se pudo guardar. Revisa tu conexión e intenta de nuevo (no se duplica).";
};
// Venta "neta" para reportes: resta lo devuelto y suma lo que se llevó en un cambio (SQL 21).
// Total, prendas y pagos quedan como si la venta hubiera sido así desde el inicio.
const netSale = (s) => {
  if (!s || !(s.returns || []).length) return s;
  const back = {};
  s.returns.forEach((r) => (r.lines || []).forEach((l) => { back[l.variantId] = (back[l.variantId] || 0) + l.qty; }));
  const items = s.items.map((i) => { const take = Math.min(back[i.variantId] || 0, i.qty); back[i.variantId] = (back[i.variantId] || 0) - take; return { ...i, qty: i.qty - take }; })
    .concat(s.returns.flatMap((r) => r.newItems || [])).filter((i) => i.qty > 0);
  const basePays = s.payments && s.payments.length ? s.payments : [{ method: s.paymentMethod || "—", amount: s.total }];
  const payments = basePays.concat(s.returns.filter((r) => r.difference).map((r) => ({ method: r.method, amount: -r.difference })));
  return { ...s, items, payments, total: Math.round(((Number(s.total) || 0) - (Number(s.refundedTotal) || 0)) * 100) / 100 };
};
const saleLabel = (s) => `${s.serie}-${String(s.numero).padStart(6, "0")}`;
const returnedQtyOf = (s, variantId) => (s.returns || []).reduce((a, r) => a + (r.lines || []).filter((l) => l.variantId === variantId).reduce((b, l) => b + l.qty, 0), 0);

const ReturnsScreen = ({ catalog, initialSale, onSaved }) => {
  const [doc, setDoc] = useState(initialSale ? saleLabel(initialSale) : "");
  const [sale, setSale] = useState(initialSale || null);
  const [ret, setRet] = useState({});
  const [newItems, setNewItems] = useState([]);
  const [pq, setPq] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const [loc, setLoc] = useState("");
  const [seller, setSeller] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(null);
  const reqId = useRef(genId("dev"));
  // Nota de crédito electrónica (SQL 26): sale sola si la venta ya tenía boleta/factura electrónica
  const [note, setNote] = useState(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState("");
  const emitNote = async (saleId, returnId) => {
    setNoteBusy(true); setNoteMsg("");
    try {
      const { data, error } = await supabase.rpc("emit_credit_note", { p_sale_id: saleId, p_return_id: returnId });
      if (error) setNoteMsg(error.code === "PGRST202" ? "" : einvErr(error.message));
      else if (data?.reason) setNoteMsg(data.reason === "NO_CONFIGURADO" || data.reason === "VENTA_SIN_COMPROBANTE" ? "" : einvErr(data.reason));
      else setNote(data);
    } catch (e) { setNoteMsg("Sin conexión: vuelve a intentar."); }
    setNoteBusy(false);
  };
  const locs = stockLocations(catalog.settings);
  const reset = () => { setRet({}); setNewItems([]); setReason(""); setMsg(""); setDone(null); reqId.current = genId("dev"); };
  const find = async () => {
    setMsg(""); setBusy(true);
    const local = (catalog.sales || []).find((x) => saleLabel(x).toLowerCase() === doc.trim().toLowerCase());
    const { data, error } = await supabase.rpc("find_sale_for_return", { p_doc: doc.trim() });
    setBusy(false);
    const found = data || (error?.code === "PGRST202" ? local : null);
    if (error && error.code !== "PGRST202") { setMsg(returnErrorText(error)); return; }
    if (!found) { setMsg("No encontramos esa venta. Revisa el número."); return; }
    reset(); setSale(found); setLoc(locs.some((l) => l.id === found.storeId) ? found.storeId : locs[0]?.id || "principal");
  };
  useEffect(() => { if (initialSale) setLoc(locs.some((l) => l.id === initialSale.storeId) ? initialSale.storeId : locs[0]?.id || "principal"); }, []);

  const txt = { fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft };
  const head = (t) => <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, color: C.stone, margin: "16px 0 8px" }}>{t}</div>;
  const stepBtn = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: C.white, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

  if (done) {
    const r = done.returns[done.returns.length - 1];
    return (
      <div style={{ padding: "18px 18px 100px", maxWidth: 560, margin: "0 auto" }}>
        <div className="print-area">
          <AdminCard>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800, color: C.ink }}>{r.newItems?.length ? "Cambio registrado" : "Devolución registrada"}</div>
            <div style={{ ...txt, marginTop: 4 }}>Venta {saleLabel(done)} · {new Date(r.at).toLocaleString("es-PE")} · {r.by}{r.seller ? ` · ${r.seller}` : ""}</div>
            <div style={{ ...txt, marginTop: 10 }}>Vuelve: {r.lines.map((l) => `${l.name} ${l.size}/${l.colorName} ×${l.qty}`).join(" · ")}</div>
            {r.newItems?.length > 0 && <div style={{ ...txt, marginTop: 4 }}>Se lleva: {r.newItems.map((l) => `${l.name} ${l.size}/${l.colorName} ×${l.qty}`).join(" · ")}</div>}
            <div style={{ fontFamily: FONT_BODY, fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 12 }}>
              {r.difference > 0 ? `Devolver ${moneyExact(r.difference)} (${r.method})` : r.difference < 0 ? `Cobrar ${moneyExact(-r.difference)} (${r.method})` : "Sin diferencia de dinero"}
            </div>
            {r.valeCode && <div style={{ border: `2px dashed ${C.ink}`, borderRadius: 10, padding: "10px 12px", marginTop: 10, textAlign: "center" }}><div style={{ ...txt, fontSize: 11 }}>VALE DE COMPRA</div><div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 900, letterSpacing: "0.08em", color: C.ink }}>{r.valeCode}</div><div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>Saldo {moneyExact(r.difference)} · úsalo en la tienda Fly</div>{creditMonthsOf(catalog.settings) > 0 && <div style={{ ...txt, fontSize: 11 }}>Vence el {(() => { const d = new Date(r.at); d.setMonth(d.getMonth() + creditMonthsOf(catalog.settings)); return d.toLocaleDateString("es-PE"); })()}</div>}</div>}
            {r.method === "Vale" && r.difference > 0 && !r.valeCode && <div style={{ ...txt, color: C.accent, marginTop: 8 }}>El vale se crea cuando se corra el SQL 22 en Supabase.</div>}
            <div style={{ ...txt, marginTop: 4 }}>Motivo: {r.reason}{r.pointsRemoved ? ` · Se quitaron ${r.pointsRemoved} puntos del Club` : ""}</div>
            {note && ["enviado", "aceptado"].includes(note.status)
              ? <div style={{ ...txt, marginTop: 8, fontWeight: 600, color: C.ink }}>Nota de crédito electrónica {note.serie}-{note.numero} por {moneyExact(note.total)} · {EINV_LABEL[note.status]}{note.pdf_url ? <> · <a href={note.pdf_url} target="_blank" rel="noreferrer" style={{ color: C.ink }}>PDF</a></> : null}</div>
              : <div style={{ ...txt, marginTop: 8, fontSize: 10.5 }}>Documento interno. No es nota de crédito electrónica (SUNAT).</div>}
          </AdminCard>
        </div>
        {(noteBusy || noteMsg || (note && !["enviado", "aceptado"].includes(note.status))) && (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${noteMsg || note ? C.accent : C.line}`, borderRadius: 12, padding: "10px 14px", marginTop: 12, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
            {noteBusy && <Loader2 size={15} className="spin" />}
            <span style={{ flex: 1, minWidth: 180 }}><strong>Nota de crédito:</strong> {noteBusy ? "enviando a Nubefact…" : note ? `${EINV_LABEL[note.status] || note.status} · ${note.serie}-${note.numero}` : ""}
              {(noteMsg || note?.last_error) && <span style={{ display: "block", color: C.accent }}>{noteMsg || note.last_error}</span>}</span>
            {!noteBusy && <button onClick={() => emitNote(done.id, r.id)} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Reintentar</button>}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => window.print()} style={{ ...quickLinkStyle, flex: 1, justifyContent: "center" }}><Receipt size={15} /> Imprimir</button>
          <button onClick={() => { setSale(null); setDoc(""); reset(); }} style={{ ...quickLinkStyle, flex: 1, justifyContent: "center" }}>Otra devolución</button>
        </div>
      </div>
    );
  }

  const retLines = sale ? sale.items.map((it) => ({ it, max: Math.max(0, it.qty - returnedQtyOf(sale, it.variantId)), q: ret[it.variantId] || 0 })) : [];
  const sub = sale ? (Number(sale.subtotal) || sale.items.reduce((a, i) => a + i.unitPrice * i.qty, 0)) : 0;
  const ratio = sale && sub > 0 ? Math.min(Math.max(((Number(sale.total) || 0) - (Number(sale.shipping) || 0)) / sub, 0), 1) : 1;
  const retAmount = retLines.reduce((a, l) => a + Math.round(l.it.unitPrice * ratio * 100) / 100 * l.q, 0);
  const newAmount = newItems.reduce((a, n) => a + n.price * n.qty, 0);
  const diff = Math.round((retAmount - newAmount) * 100) / 100;
  const anyRet = retLines.some((l) => l.q > 0);
  const hasOutlet = sale && retLines.some((l) => l.q > 0 && isOutlet(catalog.products.find((p) => p.id === l.it.productId)));
  const nq = pq.trim().toLowerCase();
  const results = nq.length >= 2 ? catalog.products.flatMap((p) => p.variants.filter((v) => v.stock > 0 && (`${p.name} ${v.sku || ""}`.toLowerCase().includes(nq))).map((v) => ({ p, v }))).slice(0, 12) : [];
  const addNew = (p, v) => { setNewItems((xs) => xs.some((x) => x.variantId === v.id) ? xs.map((x) => (x.variantId === v.id && x.qty < v.stock ? { ...x, qty: x.qty + 1 } : x)) : [...xs, { variantId: v.id, name: p.name, size: v.size, colorName: v.colorName, price: Number(p.price) || 0, qty: 1, max: v.stock }]); setPq(""); };
  const save = async () => {
    if (!anyRet) { setMsg(RETURN_ERRORS.NADA_PARA_DEVOLVER); return; }
    if (!reason.trim()) { setMsg(RETURN_ERRORS.MOTIVO_REQUERIDO); return; }
    if (method === "Vale" && diff < 0) { setMsg("Si la persona tiene que pagar la diferencia, elige cómo paga (efectivo, Yape…), no «Vale»."); return; }
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("return_sale", {
      p_sale_id: sale.id, p_lines: retLines.filter((l) => l.q > 0).map((l) => ({ variantId: l.it.variantId, qty: l.q })), p_reason: reason.trim(),
      p_method: method, p_new_items: newItems.map((n) => ({ variantId: n.variantId, qty: n.qty })), p_location: loc || null, p_request_id: reqId.current, p_seller: seller.trim() || null,
    });
    setBusy(false);
    if (error || !data) { setMsg(returnErrorText(error)); return; }
    setDone(data); setSale(data); setNote(null); setNoteMsg("");
    onSaved && onSaved(data);
    const last = (data.returns || [])[data.returns.length - 1];
    if (last && data.einvoice && ["enviado", "aceptado"].includes(data.einvoice.status)) emitNote(data.id, last.id);
  };

  return (
    <div style={{ padding: "18px 18px 100px", maxWidth: 620, margin: "0 auto" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>Devolución o cambio</h1>
      <div style={{ ...txt, marginBottom: 12 }}>Elige qué prendas vuelven y, si es un cambio, cuál se lleva. El sistema calcula la diferencia, ajusta el stock y la caja.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={doc} onChange={(e) => setDoc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()} placeholder="N.° de la venta (ej. B001-000123)" style={inputStyle} />
        <button onClick={find} disabled={busy || !doc.trim()} style={{ padding: "0 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Buscar</button>
      </div>
      {msg && !sale && <div style={{ ...txt, color: C.accent, marginTop: 8 }}>{msg}</div>}
      {sale && (
        <>
          <AdminCard style={{ marginTop: 14, padding: 12 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{saleLabel(sale)} · {moneyExact(sale.total)}{sale.status === "anulado" ? " · ANULADA" : ""}</div>
            <div style={txt}>{new Date(sale.createdAt).toLocaleString("es-PE")} · {sale.channel === "online" ? "Web" : "Tienda"}{sale.customerName ? ` · ${sale.customerName}` : ""}{sale.discount > 0 ? ` · Descuento ${moneyExact(sale.discount)}` : ""}</div>
            {(sale.returns || []).length > 0 && <div style={{ ...txt, marginTop: 4 }}>Ya tuvo {sale.returns.length} devolución(es)/cambio(s).</div>}
          </AdminCard>
          {head("1. ¿Qué prendas vuelven?")}
          {retLines.map(({ it, max, q }) => (
            <div key={it.variantId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{it.name} — {it.size}/{it.colorName}</div>
                <div style={{ ...txt, fontSize: 11 }}>Compró {it.qty} · {max === 0 ? "ya devuelta" : `puede devolver ${max}`} · pagó {moneyExact(Math.round(it.unitPrice * ratio * 100) / 100)} c/u</div>
              </div>
              <button aria-label="Menos" disabled={q <= 0} onClick={() => setRet((r) => ({ ...r, [it.variantId]: Math.max(0, q - 1) }))} style={stepBtn}><Minus size={13} /></button>
              <span style={{ width: 18, textAlign: "center", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700 }}>{q}</span>
              <button aria-label="Más" disabled={q >= max} onClick={() => setRet((r) => ({ ...r, [it.variantId]: Math.min(max, q + 1) }))} style={stepBtn}><Plus size={13} /></button>
            </div>
          ))}
          {hasOutlet && <div style={{ ...txt, color: C.accent, marginTop: 8 }}>Prenda Outlet: sin cambios ni devoluciones, salvo falla de fábrica. Anótalo en el motivo.</div>}

          {head("2. ¿Se lleva otra prenda? (cambio, opcional)")}
          <input value={pq} onChange={(e) => setPq(e.target.value)} onKeyDown={(e) => { if (e.key !== "Enter") return; const code = pq.trim().toLowerCase(); for (const p of catalog.products) { const v = p.variants.find((x) => (x.sku || "").toLowerCase() === code); if (v && v.stock > 0) { addNew(p, v); return; } } }} placeholder="Busca por nombre o escanea el código" style={inputStyle} />
          {results.length > 0 && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
              {results.map(({ p, v }) => (
                <button key={v.id} onClick={() => addNew(p, v)} style={{ display: "flex", width: "100%", justifyContent: "space-between", padding: "9px 10px", border: "none", borderBottom: `1px solid ${C.line}`, background: C.white, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textAlign: "left" }}>
                  <span>{p.name} — {v.size}/{v.colorName}</span><span>{moneyExact(p.price)} · stock {v.stock}</span>
                </button>
              ))}
            </div>
          )}
          {newItems.map((n) => (
            <div key={n.variantId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>{n.name} — {n.size}/{n.colorName} · {moneyExact(n.price)}</div>
              <button aria-label="Menos" onClick={() => setNewItems((xs) => xs.map((x) => (x.variantId === n.variantId ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))} style={stepBtn}><Minus size={13} /></button>
              <span style={{ width: 18, textAlign: "center", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700 }}>{n.qty}</span>
              <button aria-label="Más" disabled={n.qty >= n.max} onClick={() => setNewItems((xs) => xs.map((x) => (x.variantId === n.variantId ? { ...x, qty: x.qty + 1 } : x)))} style={stepBtn}><Plus size={13} /></button>
            </div>
          ))}

          {head("3. Dinero y datos")}
          <AdminCard style={{ padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", ...txt }}><span>Vuelve</span><span>{moneyExact(retAmount)}</span></div>
            {newItems.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", ...txt }}><span>Se lleva</span><span>− {moneyExact(newAmount)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 6 }}>
              <span>{diff > 0 ? "Devolver a la persona" : diff < 0 ? "Cobrar a la persona" : "Diferencia"}</span><span>{moneyExact(Math.abs(diff))}</span>
            </div>
            {sale.shipping > 0 && <div style={{ ...txt, fontSize: 10.5, marginTop: 4 }}>El envío ({moneyExact(sale.shipping)}) no se devuelve.</div>}
          </AdminCard>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Cómo se paga o devuelve" style={inputStyle}>
              {["Efectivo", "Yape", "Plin", "Tarjeta", "Transferencia", "Vale"].map((m) => <option key={m} value={m}>{m === "Vale" ? "Vale de compra (saldo para otra compra)" : m}</option>)}
            </select>
            <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Dónde queda la prenda devuelta" style={inputStyle}>
              {locs.map((l) => <option key={l.id} value={l.id}>Queda en {l.name}</option>)}
            </select>
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 200))} placeholder="Motivo (obligatorio): talla, color, falla…" style={{ ...inputStyle, marginBottom: 8 }} />
          <input value={seller} onChange={(e) => setSeller(e.target.value.toUpperCase().slice(0, 5))} placeholder="Código de quien atiende (ej. MA01, opcional)" style={{ ...inputStyle, marginBottom: 8 }} />
          {method === "Efectivo" && diff !== 0 && <div style={{ ...txt, fontSize: 11, marginBottom: 8 }}>Quedará como {diff > 0 ? "salida" : "entrada"} de efectivo en la caja abierta.</div>}
          {msg && <div style={{ ...txt, color: C.accent, marginBottom: 8 }}>{msg}</div>}
          <PrimaryButton disabled={busy || !anyRet} onClick={save}>{busy ? "Guardando…" : newItems.length ? "Registrar cambio" : "Registrar devolución"}</PrimaryButton>
          <Faltan center items={[!anyRet && "marca qué prendas devuelve", !reason.trim() && "escribe el motivo"]} />
        </>
      )}
    </div>
  );
};

// Vales de compra (SQL 22): saldo, a nombre de quién, de qué venta salió y cada uso. Administración puede anularlos.
const creditMonthsOf = (settings) => { const n = Number(settings?.creditMonths); return Number.isFinite(n) && settings?.creditMonths !== undefined && settings?.creditMonths !== "" ? Math.max(0, Math.min(36, Math.round(n))) : 6; };
const isExpired = (c) => c.status === "activo" && c.expires_at && new Date(c.expires_at) < new Date();
const CreditsScreen = ({ role, settings, onSaveMonths }) => {
  const [months, setMonths] = useState(String(creditMonthsOf(settings)));
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [f, setF] = useState("activo");
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data, error } = await supabase.from("store_credits").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) { setMsg(/store_credits|42P01/.test(`${error.code} ${error.message}`) ? "Falta correr el SQL 22 en Supabase." : "No se pudo cargar. Revisa tu conexión."); setList([]); return; }
    setList(data || []);
  };
  useEffect(() => { load(); }, []);
  const voidIt = async (c) => {
    const reason = prompt(`Motivo para anular el vale ${c.code} (saldo ${moneyExact(c.balance)}):`);
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.rpc("void_credit", { p_code: c.code, p_reason: reason.trim() });
    if (error) { alert("No se pudo anular: " + (error.message.includes("SIN_PERMISO") ? "solo Administración." : error.message)); return; }
    load();
  };
  const nq = q.trim().toLowerCase();
  const rows = (list || []).filter((c) => f === "todos" || (f === "vencido" ? isExpired(c) : f === "activo" ? c.status === "activo" && !isExpired(c) : c.status === f)).filter((c) => !nq || `${c.code} ${c.customer_name || ""} ${c.customer_phone || ""} ${c.origin_doc || ""}`.toLowerCase().includes(nq));
  const active = (list || []).filter((c) => c.status === "activo" && !isExpired(c));
  const txt = { fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft };
  return (
    <div style={{ padding: "18px 18px 100px", maxWidth: 680, margin: "0 auto" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>Vales de compra</h1>
      <div style={{ ...txt, marginBottom: 12 }}>{active.length} vale(s) activos · saldo pendiente {moneyExact(active.reduce((a, c) => a + Number(c.balance), 0))}. Se crean en «Devolución o cambio» y se usan en caja con «Vale».</div>
      {STAFF_ADMIN.includes(role) && onSaveMonths && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...txt, marginBottom: 12 }}>
          Los vales nuevos vencen a los
          <input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))} style={{ ...inputStyle, width: 56, padding: "6px 8px", textAlign: "center" }} />
          meses (0 = no vencen)
          {String(creditMonthsOf(settings)) !== months && months !== "" && <button onClick={() => onSaveMonths(Math.min(36, Number(months)))} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Guardar</button>}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código, nombre, celular o venta" style={{ ...inputStyle, marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["activo", "Activos"], ["vencido", "Vencidos"], ["usado", "Usados"], ["anulado", "Anulados"], ["todos", "Todos"]].map(([k, l]) => <Chip key={k} active={f === k} onClick={() => setF(k)}>{l}</Chip>)}
      </div>
      {msg && <div style={{ ...txt, color: C.accent, marginBottom: 10 }}>{msg}</div>}
      {list === null ? <div style={txt}>Cargando…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((c) => (
            <AdminCard key={c.code} style={{ padding: 12 }}>
              <button onClick={() => setOpen(open === c.code ? null : c.code)} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, letterSpacing: "0.06em", color: C.ink }}>{c.code}</div>
                  <div style={txt}>{c.customer_name || "Sin nombre"}{c.origin_doc ? ` · de ${c.origin_doc}` : ""} · {new Date(c.created_at).toLocaleDateString("es-PE")}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, color: C.ink }}>{moneyExact(c.balance)}</div>
                  <div style={{ ...txt, fontSize: 10.5, color: isExpired(c) ? C.accent : C.inkSoft }}>{isExpired(c) ? `venció ${new Date(c.expires_at).toLocaleDateString("es-PE")}` : c.status === "activo" ? `de ${moneyExact(c.amount)}${c.expires_at ? ` · vence ${new Date(c.expires_at).toLocaleDateString("es-PE")}` : ""}` : c.status === "usado" ? "usado" : "anulado"}</div>
                </div>
              </button>
              {open === c.code && (
                <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 8 }}>
                  {(c.history || []).map((h, i) => (
                    <div key={i} style={{ ...txt, marginBottom: 4 }}>{new Date(h.at).toLocaleString("es-PE")} · {h.type}{h.doc ? ` ${h.doc}` : ""} · {Number(h.amount) >= 0 ? "+" : "−"}{moneyExact(Math.abs(Number(h.amount) || 0))}{h.by ? ` · ${h.by}` : ""}{h.note ? ` · «${h.note}»` : ""}</div>
                  ))}
                  {c.note && <div style={{ ...txt, marginTop: 4 }}>Motivo de la devolución: {c.note}</div>}
                  {c.status === "activo" && STAFF_ADMIN.includes(role) && <button onClick={() => voidIt(c)} style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Anular vale</button>}
                </div>
              )}
            </AdminCard>
          ))}
          {!rows.length && <div style={{ ...txt, textAlign: "center", padding: 24 }}>No hay vales con ese filtro.</div>}
        </div>
      )}
    </div>
  );
};

const AdminInvoicesScreen = ({ sales, onVoid, storesSettings, onReturn }) => {
  const [selected, setSelected] = useState(null);
  const [tipoFilter, setTipoFilter] = useState("todos");
  const [estadoFilter, setEstadoFilter] = useState("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");
  const [storeF, setStoreF] = useState("todas");
  const [channelF, setChannelF] = useState("todos");

  if (selected) {
    return (
      <div style={{ padding: "18px 18px 90px" }}>
        <button onClick={() => setSelected(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", marginBottom: 14, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}><ArrowLeft size={15} /> Volver</button>
        <ReceiptView sale={selected} settings={storesSettings} onNewSale={() => setSelected(null)} onSendWhatsApp={() => {
          const lines = [`Comprobante Fly Boutique ${selected.serie}-${String(selected.numero).padStart(6, "0")}`, "", ...selected.items.map((i) => `• ${i.name} — ${i.size}/${i.colorName} × ${i.qty} — ${money(i.unitPrice * i.qty)}`), "", `Total: ${money(selected.total)}`];
          window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
        }} />
        {(selected.returns || []).length > 0 && (
          <AdminCard style={{ marginTop: -60, marginBottom: 70 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Devoluciones y cambios</div>
            {selected.returns.map((r) => (
              <div key={r.id} style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginBottom: 6 }}>
                {new Date(r.at).toLocaleString("es-PE")} · {r.by}: vuelve {r.lines.map((l) => `${l.name} ${l.size}/${l.colorName} ×${l.qty}`).join(", ")}
                {r.newItems?.length ? `; se lleva ${r.newItems.map((l) => `${l.name} ${l.size}/${l.colorName} ×${l.qty}`).join(", ")}` : ""}
                {" · "}{r.difference > 0 ? `devuelto ${moneyExact(r.difference)}` : r.difference < 0 ? `cobrado ${moneyExact(-r.difference)}` : "sin diferencia"} ({r.method}) · «{r.reason}»
              </div>
            ))}
          </AdminCard>
        )}
        {selected.status !== "anulado" && onReturn && (
          <button onClick={() => onReturn(selected)} style={{ ...quickLinkStyle, width: "100%", justifyContent: "center", marginTop: (selected.returns || []).length ? -60 : -70, marginBottom: 80 }}>
            <RotateCcw size={15} /> Devolución o cambio de prendas
          </button>
        )}
        {selected.status !== "anulado" && !(selected.returns || []).length && (
          <button onClick={() => { onVoid(selected.id); setSelected(null); }} style={{ width: "100%", marginTop: -70, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", borderRadius: 9, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            <Undo2 size={15} /> Anular (nota de crédito) y devolver stock
          </button>
        )}
      </div>
    );
  }

  const filtered = sales.filter((s) => {
    if (channelF === "tienda" && s.channel === "online") return false;
    if (channelF === "web" && s.channel !== "online") return false;
    if (storeF !== "todas" && (s.storeId || (s.channel === "online" ? "web" : "principal")) !== storeF) return false;
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
        <select value={channelF} onChange={(e) => setChannelF(e.target.value)} style={inputStyle}><option value="todos">Tienda física y web</option><option value="tienda">Solo tienda física</option><option value="web">Solo web</option></select>
        <select value={storeF} onChange={(e) => setStoreF(e.target.value)} style={inputStyle}><option value="todas">Todas las sedes</option>{storesOf(storesSettings).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="web">Tienda online</option></select>
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
// ---- Filtros de ventas reutilizables (reportes y comprobantes) ----
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
function periodRange(f) {
  const now = new Date(); const t0 = startOfDay(now);
  if (f.period === "hoy") return [t0, new Date(t0.getTime() + 864e5)];
  if (f.period === "ayer") return [new Date(t0.getTime() - 864e5), t0];
  if (f.period === "semana") { const d = (t0.getDay() + 6) % 7; const st = new Date(t0.getTime() - d * 864e5); return [st, new Date(st.getTime() + 7 * 864e5)]; }
  if (f.period === "mes") return [new Date(f.year, f.month, 1), new Date(f.year, f.month + 1, 1)];
  if (f.period === "anio") return [new Date(f.year, 0, 1), new Date(f.year + 1, 0, 1)];
  if (f.period === "rango") return [f.from ? new Date(f.from + "T00:00:00") : new Date(2000, 0, 1), f.to ? new Date(new Date(f.to + "T00:00:00").getTime() + 864e5) : new Date(2100, 0, 1)];
  return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
}
const defaultSalesFilter = () => { const n = new Date(); return { period: "mes", month: n.getMonth(), year: n.getFullYear(), from: "", to: "", store: "todas", channel: "todos", tipo: "todos", estado: "emitido", seller: "todos", pay: "todos" }; };
const payMethodsOf = (s) => (s.payments && s.payments.length ? s.payments.map((p) => p.method) : [s.paymentMethod || "—"]);
function filterSales(sales, f) {
  const [a, b] = periodRange(f);
  return sales.filter((s) => {
    const t = new Date(s.createdAt);
    if (t < a || t >= b) return false;
    const isWeb = s.channel === "online";
    if (f.channel === "tienda" && isWeb) return false;
    if (f.channel === "web" && !isWeb) return false;
    if (f.store !== "todas" && (s.storeId || (isWeb ? "web" : "principal")) !== f.store) return false;
    if (f.tipo !== "todos" && s.tipo !== f.tipo) return false;
    if (f.estado === "emitido" && s.status === "anulado") return false;
    if (f.estado === "anulado" && s.status !== "anulado") return false;
    if (f.seller !== "todos" && (s.staffName || "Sin asignar") !== f.seller) return false;
    if (f.pay && f.pay !== "todos" && !payMethodsOf(s).includes(f.pay)) return false;
    return true;
  });
}
const SalesFilterBar = ({ f, setF, stores, sellers, showSeller = true }) => {
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const years = []; for (let y = new Date().getFullYear(); y >= 2024; y--) years.push(y);
  const sel = { ...inputStyle, width: "auto", padding: "8px 10px", fontSize: 12.5 };
  return (
    <div style={{ background: C.paperDeep, borderRadius: 12, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {[["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "Esta semana"], ["mes", "Mes"], ["anio", "Año"], ["rango", "Rango de fechas"], ["todo", "Todo"]].map(([k, l]) => <Chip key={k} active={f.period === k} onClick={() => set("period", k)}>{l}</Chip>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {f.period === "mes" && <select value={f.month} onChange={(e) => set("month", Number(e.target.value))} style={sel}>{MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>}
        {(f.period === "mes" || f.period === "anio") && <select value={f.year} onChange={(e) => set("year", Number(e.target.value))} style={sel}>{years.map((y) => <option key={y}>{y}</option>)}</select>}
        {f.period === "rango" && <><span style={{ fontFamily: FONT_BODY, fontSize: 12 }}>Del</span><input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} style={sel} /><span style={{ fontFamily: FONT_BODY, fontSize: 12 }}>al</span><input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} style={sel} /></>}
        <select value={f.store} onChange={(e) => set("store", e.target.value)} style={sel}><option value="todas">Todas las sedes</option>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="web">Tienda online</option></select>
        <select value={f.channel} onChange={(e) => set("channel", e.target.value)} style={sel}><option value="todos">Tienda física y web</option><option value="tienda">Solo tienda física</option><option value="web">Solo web</option></select>
        <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} style={sel}><option value="todos">Boletas y facturas</option><option value="boleta">Solo boletas</option><option value="factura">Solo facturas</option></select>
        <select value={f.estado} onChange={(e) => set("estado", e.target.value)} style={sel}><option value="emitido">Emitidos</option><option value="anulado">Anulados</option><option value="todos">Todos los estados</option></select>
        <select value={f.pay || "todos"} onChange={(e) => set("pay", e.target.value)} style={sel} aria-label="Medio de pago"><option value="todos">Todos los pagos</option>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
        {showSeller && <select value={f.seller} onChange={(e) => set("seller", e.target.value)} style={sel}><option value="todos">Todas las vendedoras</option>{sellers.map((n) => <option key={n}>{n}</option>)}</select>}
        <button onClick={() => setF(defaultSalesFilter())} style={{ background: "none", border: "none", textDecoration: "underline", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Restablecer</button>
      </div>
    </div>
  );
};

// ---- Rentabilidad: ventas, costo de lo vendido, gastos y ganancia (solo con datos reales; si falta algo, se dice) ----
const EXPENSE_CATEGORIES = ["Alquiler", "Sueldos y comisiones", "Luz, agua e internet", "Publicidad", "Delivery y envíos", "Comisiones de cobro (POS, Yape)", "Bolsas y empaques", "Mantenimiento", "Impuestos y trámites", "Otros"];
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const ProfitSection = ({ catalog, sales, all, range }) => {
  const [costs, setCosts] = useState(null); // { productId: cost } | "no" si falta el SQL 18
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState({ spent_on: ymd(Date.now()), category: EXPENSE_CATEGORIES[0], amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [a, b] = range;
  const loadExpenses = async () => {
    const { data, error } = await supabase.from("expenses").select("*").gte("spent_on", ymd(a)).lt("spent_on", ymd(b)).order("spent_on", { ascending: false }).limit(500);
    setExpenses(error ? [] : data || []);
  };
  useEffect(() => {
    supabase.from("product_costs").select("product_id,cost").then(({ data, error }) => setCosts(error ? "no" : Object.fromEntries((data || []).map((r) => [r.product_id, Number(r.cost)]))));
  }, []);
  useEffect(() => { loadExpenses(); }, [a.getTime(), b.getTime()]);
  if (costs === "no") return <AdminCard style={{ marginBottom: 14 }}><span style={labelStyle}>Rentabilidad</span><div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Falta correr el SQL 18 (costos y gastos) en Supabase.</div></AdminCard>;
  if (!costs) return null;
  const netSales = sales.reduce((t, s) => t + (s.total || 0) - (s.shipping || 0), 0);
  const discounts = sales.reduce((t, s) => t + (s.discount || 0) + (s.channel === "online" ? (s.pointsDiscount || 0) : 0), 0);
  const voided = all.filter((s) => s.status === "anulado");
  let cogs = 0, units = 0, unitsNoCost = 0; const missing = {};
  sales.forEach((s) => s.items.forEach((i) => {
    units += i.qty;
    const c = costs[i.productId];
    if (c === undefined) { unitsNoCost += i.qty; missing[i.name] = (missing[i.name] || 0) + i.qty; } else cogs += c * i.qty;
  }));
  const complete = units > 0 && unitsNoCost === 0;
  const gross = netSales - cogs;
  const activeExp = expenses.filter((e) => !e.voided);
  const totalExp = activeExp.reduce((t, e) => t + Number(e.amount), 0);
  const incompleto = <span style={{ color: C.accent }}>Incompleto</span>;
  const row = (label, value, strong, hint) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 13, color: C.ink }}>
      <span>{label}{hint && <span style={{ display: "block", fontSize: 11, color: C.stone }}>{hint}</span>}</span>
      <span style={{ fontWeight: strong ? 800 : 500, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
  const addExpense = async () => {
    const amt = Number(form.amount);
    if (!(amt > 0)) { alert("Escribe el monto del gasto."); return; }
    setBusy(true);
    const { error } = await supabase.from("expenses").insert({ spent_on: form.spent_on, category: form.category, amount: amt, note: form.note.trim() || null });
    setBusy(false);
    if (error) { alert("No se pudo guardar el gasto: " + error.message); return; }
    setForm((f) => ({ ...f, amount: "", note: "" })); loadExpenses();
  };
  const voidExpense = async (e) => {
    const why = prompt(`¿Por qué anulas el gasto de ${money2(e.amount)} (${e.category})?`, "Registrado por error");
    if (!why || !why.trim()) return;
    const { error } = await supabase.from("expenses").update({ voided: true, void_reason: why.trim() }).eq("id", e.id);
    if (error) { alert("No se pudo anular: " + error.message); return; }
    loadExpenses();
  };
  return (
    <>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Rentabilidad del periodo</span>
        {row("Ventas (sin envío)", money2(netSales), false, `${sales.length} ventas válidas`)}
        {row("Descuentos dados", `− ${money2(discounts)}`, false, "Ya están restados de las ventas")}
        {row("Anuladas / devueltas", `${voided.length} · ${money2(voided.reduce((t, s) => t + (s.total || 0), 0))}`, false, "No cuentan en las ventas")}
        {row("Costo de lo vendido", complete ? `− ${money2(cogs)}` : incompleto, false, complete ? "Con el costo de compra de cada prenda" : `Faltan costos de ${unitsNoCost} de ${units} prendas vendidas`)}
        {row("Margen bruto", complete ? `${money2(gross)} (${netSales > 0 ? Math.round((gross / netSales) * 100) : 0}%)` : incompleto, true)}
        {row("Gastos registrados", `− ${money2(totalExp)}`, false, `${activeExp.length} gastos en el periodo`)}
        {row("Ganancia estimada", complete ? money2(gross - totalExp) : incompleto, true, "Antes del impuesto a la renta. Montos con IGV incluido.")}
        {!complete && units > 0 && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginTop: 10, lineHeight: 1.5 }}>
            Para ver la ganancia real, pon el costo de compra en Productos → editar. Faltan: {Object.entries(missing).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([n, q]) => `${n} (${q})`).join(" · ")}{Object.keys(missing).length > 6 ? "…" : ""}
          </div>
        )}
      </AdminCard>
      <AdminCard style={{ marginBottom: 14 }}>
        <span style={labelStyle}>Gastos del negocio</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginBottom: 10, lineHeight: 1.5 }}>Alquiler, sueldos, luz, publicidad… La compra de mercadería no va aquí: va como costo de cada prenda.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input type="date" value={form.spent_on} onChange={(e) => setForm({ ...form, spent_on: e.target.value })} style={{ ...inputStyle, flex: "1 1 140px" }} aria-label="Fecha del gasto" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...inputStyle, flex: "2 1 180px" }} aria-label="Tipo de gasto">{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="Monto S/ *" style={{ ...inputStyle, flex: "1 1 110px" }} />
          <input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Nota (opcional)" style={{ ...inputStyle, flex: "3 1 200px" }} />
        </div>
        <button onClick={addExpense} disabled={busy} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1, marginBottom: 10 }}>{busy ? "Guardando…" : "Registrar gasto"}</button>
        {expenses.length === 0 ? <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Sin gastos en este periodo.</div> : expenses.map((e) => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: e.voided ? C.stone : C.ink, textDecoration: e.voided ? "line-through" : "none" }}>
            <span style={{ minWidth: 0 }}>{new Date(e.spent_on + "T12:00:00").toLocaleDateString("es-PE")} · {e.category}{e.note ? ` · ${e.note}` : ""}<span style={{ display: "block", fontSize: 10.5, color: C.stone, textDecoration: "none" }}>{e.created_by || ""}{e.voided ? ` · anulado por ${e.voided_by || ""}: ${e.void_reason || ""}` : ""}</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{money2(e.amount)}</strong>
              {!e.voided && <button onClick={() => voidExpense(e)} style={{ padding: "5px 9px", borderRadius: 6, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 11, cursor: "pointer", color: C.ink }}>Anular</button>}
            </span>
          </div>
        ))}
      </AdminCard>
    </>
  );
};

const AdminReportsScreen = ({ catalog }) => {
  const [f, setF] = useState(defaultSalesFilter);
  const stores = storesOf(catalog.settings);
  const sellers = [...new Set(catalog.sales.map((s) => s.staffName || "Sin asignar"))].sort();
  const list = filterSales(catalog.sales, f);
  const valid = list.filter((s) => s.status !== "anulado").map(netSale);
  const total = valid.reduce((a, s) => a + (s.total || 0), 0);
  // Mismo periodo anterior (ej. este mes vs. el mes pasado), con los mismos filtros
  const [ra, rb] = periodRange(f);
  const prevTotal = f.period === "todo" ? null : catalog.sales.filter((s) => {
    const t = new Date(s.createdAt).getTime(), len = rb - ra;
    return t >= ra.getTime() - len && t < ra.getTime() && s.status !== "anulado";
  }).filter((s) => filterSales([{ ...s, createdAt: ra.getTime() }], f).length).map(netSale).reduce((a, s) => a + (s.total || 0), 0);
  const vsPrev = prevTotal === null ? null : prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  const storeName = (id) => (id === "web" ? "Tienda online" : (stores.find((x) => x.id === id)?.name || id));
  const byStore = {}; valid.forEach((s) => { const k = storeName(s.storeId || (s.channel === "online" ? "web" : "principal")); byStore[k] = byStore[k] || { count: 0, total: 0 }; byStore[k].count++; byStore[k].total += s.total || 0; });
  const soldIds = new Set(valid.flatMap((s) => s.items.map((i) => i.productId)));
  const stale = catalog.products.filter((p) => productTotalStock(p) > 0 && !soldIds.has(p.id));
  const units = valid.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qty, 0), 0);
  const web = valid.filter((s) => s.channel === "online"); const tienda = valid.filter((s) => s.channel !== "online");
  const sum = (arr) => arr.reduce((a, s) => a + (s.total || 0), 0);

  const bySeller = {}; valid.forEach((s) => { const k = s.staffName || "Sin asignar"; bySeller[k] = bySeller[k] || { total: 0, count: 0, units: 0 }; bySeller[k].total += s.total; bySeller[k].count++; bySeller[k].units += s.items.reduce((x, i) => x + i.qty, 0); });
  const byDay = {}; valid.forEach((s) => { const k = new Date(s.createdAt).toLocaleDateString("es-PE"); byDay[k] = (byDay[k] || 0) + s.total; });
  const byPay = {}; valid.forEach((s) => (s.payments && s.payments.length ? s.payments : [{ method: s.paymentMethod || "—", amount: s.total }]).forEach((p) => { byPay[p.method] = (byPay[p.method] || 0) + Number(p.amount || 0); }));
  const byProduct = {}; valid.forEach((s) => s.items.forEach((i) => { byProduct[i.name] = byProduct[i.name] || { qty: 0, total: 0 }; byProduct[i.name].qty += i.qty; byProduct[i.name].total += i.qty * (i.unitPrice || 0); }));

  const exportCsv = () => {
    const rows = [["Fecha", "Comprobante", "Canal", "Sede", "Vendedora", "Cliente", "Documento", "Pago", "Subtotal", "Descuento", "Total", "Estado"]];
    list.forEach((s) => rows.push([new Date(s.createdAt).toLocaleString("es-PE"), `${s.serie}-${String(s.numero).padStart(6, "0")}`, s.channel === "online" ? "Web" : "Tienda", s.storeName || (s.channel === "online" ? "Tienda online" : "Tienda principal"), s.staffName || "", s.customerName || "", s.customerDoc || "", s.payments ? s.payments.map((p) => `${p.method} ${p.amount}`).join(" + ") : (s.paymentMethod || ""), s.subtotal, s.discount || 0, s.total, s.status]));
    const csv = "\uFEFF" + rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `ventas-fly-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  const card = (label, value, sub) => (
    <AdminCard style={{ padding: "14px 16px" }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 800, color: C.ink, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 2 }}>{sub}</div>}
    </AdminCard>
  );
  const table = (title, rows, cols, open = false) => (
    <FoldCard id={`rep-${title}`} title={title} defaultOpen={open} summary={rows.length ? `${rows.length} ${rows.length === 1 ? "fila" : "filas"} · primero: ${rows[0][0]} (${rows[0][rows[0].length - 1]})` : "Sin datos en este periodo"}>
      {rows.length === 0 ? <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone }}>Sin datos en este periodo.</div> : rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.paperDeep}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
          <span style={{ flex: 1 }}>{r[0]}</span>{cols.map((c, j) => <span key={j} style={{ minWidth: 70, textAlign: "right", fontWeight: j === cols.length - 1 ? 700 : 400 }}>{r[j + 1]}</span>)}
        </div>
      ))}
    </FoldCard>
  );
  const totalUnidades = catalog.products.reduce((a, p) => a + productTotalStock(p), 0);
  const agotados = catalog.products.filter(productSoldOut).length;
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: 0 }}>Reportes</h1>
        <button onClick={exportCsv} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Download size={14} /> Excel (CSV)</button>
      </div>
      <SalesFilterBar f={f} setF={setF} stores={stores} sellers={sellers} />
      <div className="report-cards" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {card("Ventas", money(total), `${valid.length} comprobantes${vsPrev !== null ? ` · ${vsPrev >= 0 ? "+" : ""}${vsPrev}% vs. periodo anterior` : prevTotal === 0 && total > 0 ? " · sin ventas el periodo anterior" : ""}`)}
        {card("Ticket promedio", money(valid.length ? total / valid.length : 0), `${units} prendas vendidas`)}
        {card("Tienda física", money(sum(tienda)), `${tienda.length} ventas`)}
        {card("Web", money(sum(web)), `${web.length} pedidos`)}
      </div>
      <ProfitSection catalog={catalog} sales={valid} all={list} range={periodRange(f)} />
      {table("Por vendedora", Object.entries(bySeller).sort((a, b) => b[1].total - a[1].total).map(([n, v]) => [n, v.count, v.units, money(v.total)]), ["Ventas", "Prendas", "Total"], true)}
      {table("Por sede", Object.entries(byStore).sort((x, y) => y[1].total - x[1].total).map(([n, v]) => [n, v.count, money(v.total)]), ["Ventas", "Total"])}
      {table("Por día", Object.entries(byDay).sort((a, b) => { const p = (x) => x.split("/").reverse().join(""); return p(b[0]).localeCompare(p(a[0])); }).map(([d, v]) => [d, money(v)]), ["Total"])}
      {table("Por medio de pago", Object.entries(byPay).sort((a, b) => b[1] - a[1]).map(([m, v]) => [m, money(v)]), ["Total"])}
      {table("Prendas más vendidas", Object.entries(byProduct).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10).map(([n, v]) => [n, v.qty, money(v.total)]), ["Unid.", "Total"])}
      {f.period !== "todo" && table("Sin ventas en el periodo (con stock)", stale.sort((x, y) => productTotalStock(y) - productTotalStock(x)).slice(0, 12).map((p) => [`${p.name}${isOutlet(p) ? " · Outlet" : ""}`, productTotalStock(p)]), ["En stock"])}
      <AdminCard>
        <span style={labelStyle}>Inventario actual</span>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, lineHeight: 1.8 }}>{totalUnidades} unidades en stock · {agotados} productos agotados</div>
      </AdminCard>
    </div>
  );
};

/* ---- "Más" menu (Administrador) ---- */
const AdminComplaintsScreen = ({ staffName }) => {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [answer, setAnswer] = useState("");
  const load = async () => {
    const { data, error } = await supabase.from("complaints").select("*").order("created_at", { ascending: false }).limit(300);
    setList(error ? [] : data || []);
  };
  useEffect(() => { load(); }, []);
  const save = async (c, status) => {
    const { error } = await supabase.from("complaints").update({ status, response: answer, responded_by: staffName, responded_at: status === "respondido" ? new Date().toISOString() : null }).eq("id", c.id);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    await load(); setOpen(null);
  };
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Libro de Reclamaciones</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 14, lineHeight: 1.5 }}>Plazo legal: 15 días hábiles improrrogables desde el registro. Guarda las hojas al menos 2 años.</div>
      {!list ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>Cargando…</div> : list.length === 0 ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone }}>No hay hojas de reclamación registradas.</div>
      ) : list.map((c) => {
        const d = c.data || {};
        const deadline = addBusinessDays(new Date(c.created_at).getTime(), 15);
        const daysLeft = Math.ceil((deadline - Date.now()) / 86400000);
        const late = c.status !== "respondido" && daysLeft < 0;
        return (
          <AdminCard key={c.id} style={{ marginBottom: 10 }}>
            <div onClick={() => { setOpen(open === c.id ? null : c.id); setAnswer(c.response || ""); }} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{c.code} · {d.kind === "queja" ? "Queja" : "Reclamo"}</div>
                <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: c.status === "respondido" ? C.ink : "transparent", color: c.status === "respondido" ? C.paper : late ? C.accent : C.ink, border: `1px solid ${late ? C.accent : C.ink}` }}>{COMPLAINT_STATUS[c.status]}</span>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 3 }}>{d.name} · {new Date(c.created_at).toLocaleDateString("es-PE")} · {c.status === "respondido" ? "Respondido" : late ? `Vencido hace ${-daysLeft} días` : `Responder antes del ${deadline.toLocaleDateString("es-PE")} (${daysLeft} días)`}</div>
            </div>
            {open === c.id && (
              <div style={{ marginTop: 10, fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6 }}>
                <div><strong>Documento:</strong> {d.docType} {d.docNumber} · <strong>Tel.:</strong> +{d.phone} · <strong>Correo:</strong> {d.email}</div>
                <div><strong>Domicilio:</strong> {d.address}{d.minor ? ` · Menor de edad (apoderado: ${d.guardian})` : ""}</div>
                <div><strong>Bien:</strong> {d.itemType} · {d.itemDesc}{d.amount ? ` · S/ ${d.amount}` : ""}{d.orderRef ? ` · Pedido ${d.orderRef}` : ""}</div>
                <div><strong>Detalle:</strong> {d.detail}</div>
                <div><strong>Pedido:</strong> {d.request}</div>
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Respuesta al consumidor" style={{ ...inputStyle, minHeight: 80, marginTop: 10 }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button onClick={() => save(c, "en_proceso")} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}>Marcar en proceso</button>
                  <button disabled={!answer.trim()} onClick={() => save(c, "respondido")} style={{ padding: "9px 12px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: answer.trim() ? 1 : 0.5 }}>Guardar respuesta</button>
                  {d.email && <a href={`mailto:${d.email}?subject=${encodeURIComponent(`Respuesta a su hoja de reclamación ${c.code}`)}&body=${encodeURIComponent(`Estimado(a) ${d.name}:\n\n${answer}\n\nAtentamente,\nFly Boutique`)}`} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.ink}`, fontFamily: FONT_BODY, fontSize: 12, color: C.ink, textDecoration: "none" }}>Enviar por correo</a>}
                </div>
              </div>
            )}
          </AdminCard>
        );
      })}
    </div>
  );
};

// Copia de seguridad completa en un archivo (productos, ventas, clientas, stock, staff y reclamos)
// Supabase entrega como máximo 1000 filas por consulta: se piden de 1000 en 1000 hasta traer todas
async function fetchAllRows(table, cols, orderCol) {
  const out = [];
  for (let from = 0; from < 500000; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order(orderCol).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function downloadBackup() {
  try {
    const [main, salesRows, customersRows, priv, staff, complaints, reviews] = await Promise.all([
      supabase.from("store_data").select("data").eq("id", "main").maybeSingle(),
      fetchAllRows("sales", "id,data", "id"), fetchAllRows("customers", "phone,data", "phone"),
      supabase.from("store_private").select("data").eq("id", "main").maybeSingle(),
      supabase.from("staff_profiles").select("username,name,role,active,created_at"),
      supabase.from("complaints").select("*"), supabase.from("product_reviews").select("*"),
    ]);
    const backup = {
      exportedAt: new Date().toISOString(), app: "Fly Boutique",
      catalog: main.data?.data || null, sales: salesRows.map((r) => r.data), customers: customersRows,
      private: priv.data?.data || null, staff: staff.data || [], complaints: complaints.data || [], reviews: reviews.data || [],
    };
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `fly-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    alert(`Copia descargada: ${salesRows.length} ventas y pedidos, ${customersRows.length} clientas. Guárdala en un lugar seguro (por ejemplo Google Drive). Hazlo al menos una vez por semana. Las fotos se descargan aparte: Más → Copia de las fotos.`);
  } catch (e) { alert("No se pudo generar la copia: " + (e.message || e)); }
}

// «Más»: opciones agrupadas por tema (orden alfabético dentro de cada grupo), con buscador, «Lo último que usaste»,
// un ícono propio y una frase de para qué sirve cada una.
const MORE_GROUPS = [
  ["ventas", "Ventas y caja"], ["inventario", "Inventario y compras"], ["clientes", "Clientes y promociones"],
  ["tienda", "Tienda online"], ["equipo", "Equipo y reportes"], ["seguridad", "Seguridad y copias"],
];
const MORE_ITEMS = [
  { id: "caja", g: "ventas", t: "Caja", d: "Abrir con el fondo, entradas y salidas de dinero, arqueo y cierre del turno.", icon: Banknote, k: "abrir cerrar arqueo turno efectivo fondo" },
  { id: "invoices", g: "ventas", t: "Comprobantes", d: "Buscar una venta, reimprimirla (58 mm, 80 mm, A4), enviarla o anularla.", icon: Receipt, k: "boleta nota venta reimprimir ticket anular buscar" },
  { id: "returns", g: "ventas", t: "Devolución o cambio", d: "La persona trae una prenda: se devuelve el dinero, un vale o se cambia.", icon: Undo2, k: "devolver cambiar talla reembolso" },
  { id: "facturacion", g: "ventas", t: "Facturación electrónica", d: "Boletas, facturas y notas de crédito en SUNAT con Nubefact: estado y reintentos.", icon: FileText, k: "sunat nubefact factura boleta nota credito token ruta" },
  { id: "onlineorders", g: "ventas", t: "Pedidos online", d: "Pedidos de la web: validar el pago, preparar, enviar y entregar.", icon: Truck, k: "web pedido envio delivery pago validar", badge: "orders" },
  { id: "credits", g: "ventas", t: "Vales de compra", d: "Consultar el saldo de un vale, su vencimiento o anularlo.", icon: Wallet, k: "vale saldo credito" },
  { id: "purchases", g: "inventario", t: "Compras a proveedores", d: "Registrar la mercadería que llega: suma stock y actualiza el costo.", icon: ClipboardList, k: "proveedor compra factura mercaderia entrada costo" },
  { id: "products", g: "inventario", t: "Productos", d: "Crear y editar prendas, fotos, tallas, colores y precios.", icon: LayoutGrid, k: "prenda foto precio talla color crear editar" },
  { id: "stock", g: "inventario", t: "Stock", d: "Ver cuánto hay por sede, corregir y ver el historial de cada prenda.", icon: Package, k: "inventario cantidad ajuste merma historial" },
  { id: "transfers", g: "inventario", t: "Traslados entre sedes", d: "Enviar y recibir prendas entre Larco y el Almacén con guía.", icon: ArrowLeftRight, k: "guia traspaso almacen larco enviar recibir" },
  { id: "customers", g: "clientes", t: "Clientas (Club Fly)", d: "Datos, puntos y permiso de publicidad de cada clienta.", icon: Users, k: "club puntos cliente publicidad whatsapp" },
  { id: "promocodes", g: "clientes", t: "Códigos promocionales", d: "Crear cupones de descuento para la web y la caja.", icon: BadgePercent, k: "cupon descuento promocion codigo", only: "superadmin" },
  { id: "complaints", g: "clientes", t: "Libro de Reclamaciones", d: "Ver y responder reclamos y quejas (plazo legal 15 días hábiles).", icon: BookOpenCheck, k: "reclamo queja indecopi" },
  { id: "banners", g: "tienda", t: "Banners", d: "Las imágenes o videos grandes que rotan en la portada de la tienda.", icon: Images, k: "portada imagen video inicio" },
  { id: "collections", g: "tienda", t: "Colecciones", d: "Agrupar prendas (ej. «Oficina») para mostrarlas juntas en la web.", icon: Layers, k: "coleccion look agrupar" },
  { id: "manual", g: "equipo", t: "Manual del equipo", d: "Cómo se hace cada cosa, paso a paso, con imágenes.", icon: BookOpen, k: "ayuda guia como se hace" },
  { id: "activity", g: "equipo", t: "Registro de actividad", d: "Quién abrió o cerró la caja, anuló, devolvió o cambió algo, y cuándo.", icon: History, k: "auditoria historial quien cambios log bitacora actividad" },
  { id: "reports", g: "equipo", t: "Reportes", d: "Ventas por día, vendedora, sede y prenda; rentabilidad y gastos.", icon: BarChart3, k: "reporte venta ganancia margen gasto vendedor" },
  { id: "users", g: "equipo", t: "Usuarios y permisos", d: "Crear cuentas del staff, cambiar su rol o contraseña.", icon: UserCog, k: "usuario rol contraseña cajero acceso", only: "superadmin" },
  { id: "sellers", g: "equipo", t: "Vendedores (códigos)", d: "El código de cada vendedora (ej. MA01) para saber quién vendió.", icon: Contact, k: "vendedora codigo ma01 comision" },
  { id: "docapi", g: "seguridad", t: "Consulta DNI / RUC", d: "Token del proveedor para que la caja complete nombres solos.", icon: Scan, k: "dni ruc reniec sunat decolecta token", only: "superadmin" },
  { id: "diagnostico", g: "seguridad", t: "Diagnóstico del equipo", d: "Si la página se traba o queda en blanco en este equipo: ver y copiar lo anotado.", icon: AlertCircle, k: "error trabada lenta blanco falla problema celular" },
  { id: "fotoscopia", g: "seguridad", t: "Copia de las fotos", d: "Descargar todas las fotos y videos en ZIP (una vez al mes).", icon: FolderArchive, k: "respaldo backup fotos zip", only: "superadmin" },
  { id: "backup", g: "seguridad", t: "Copia de seguridad (datos)", d: "Descargar ventas, clientas y catálogo (una vez por semana).", icon: HardDriveDownload, k: "respaldo backup datos json", only: "superadmin" },
];
const MORE_RECENT_KEY = "flyboutique:mas-recientes:v1";
const MORE_OPEN_KEY = "flyboutique:mas-abiertos:v1";
const MORE_GROUP_ICONS = { ventas: Banknote, inventario: Package, clientes: Users, tienda: Store, equipo: BarChart3, seguridad: ShieldCheck };
const normTxt = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const AdminMoreScreen = ({ setScreen, role, catalog }) => {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState(() => { try { return JSON.parse(localStorage.getItem(MORE_RECENT_KEY) || "[]"); } catch (e) { return []; } });
  // Grupos desplegables (como un menú por módulos): se ven solo los títulos y se abre el que necesitas. Se recuerda qué dejaste abierto.
  const [openG, setOpenG] = useState(() => { try { const v = JSON.parse(localStorage.getItem(MORE_OPEN_KEY) || "null"); return Array.isArray(v) ? v : []; } catch (e) { return []; } });
  const toggleG = (g) => setOpenG((cur) => { const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]; try { localStorage.setItem(MORE_OPEN_KEY, JSON.stringify(next)); } catch (e) { /* sin guardado */ } return next; });
  const items = MORE_ITEMS.filter((it) => !it.only || it.only === role);
  const ordersPending = (catalog?.sales || []).filter((x) => x.channel === "online" && x.source === "web" && x.status !== "anulado" && x.paymentStatus !== "confirmado").length;
  const badgeOf = (it) => (it.badge === "orders" && ordersPending > 0 ? ordersPending : 0);
  const open = (it) => {
    const next = [it.id, ...recent.filter((x) => x !== it.id)].slice(0, 4);
    setRecent(next); try { localStorage.setItem(MORE_RECENT_KEY, JSON.stringify(next)); } catch (e) { /* sin guardado */ }
    if (it.id === "backup") downloadBackup(); else setScreen(it.id);
  };
  const nq = normTxt(q.trim());
  const found = nq ? items.filter((it) => normTxt(`${it.t} ${it.d} ${it.k}`).includes(nq)) : null;
  const tile = (it, i) => {
    const Icon = it.icon; const n = badgeOf(it);
    return (
      <button key={it.id} className="more-tile" onClick={() => open(it)} style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
        <span className="more-ico"><Icon size={19} color={C.paper} strokeWidth={1.8} />{n > 0 && <span className="more-badge">{n}</span>}</span>
        <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: C.ink }}>{it.t}</span>
          <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, lineHeight: 1.4, marginTop: 2 }}>{it.d}</span>
        </span>
        <ChevronRight className="more-chev" size={16} color={C.stone} />
      </button>
    );
  };
  const recentItems = recent.map((id) => items.find((it) => it.id === id)).filter(Boolean);
  let idx = 0;
  return (
    <div style={{ padding: "18px 18px 90px", maxWidth: 980 }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>Más</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 12 }}>Todo lo del negocio, ordenado por tema. Escribe lo que necesitas y aparece.</div>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search size={16} color={C.stone} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué necesitas hacer? (ej. devolución, boleta, vale)" aria-label="Buscar en Más" style={{ ...inputStyle, paddingLeft: 40 }} />
        {q && <button onClick={() => setQ("")} aria-label="Borrar búsqueda" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex" }}><X size={16} color={C.stone} /></button>}
      </div>
      {found ? (
        found.length ? <div className="more-grid">{found.map((it, i) => tile(it, i))}</div>
          : <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>No encontramos «{q}». Prueba con otra palabra o abre el Manual del equipo.</div>
      ) : (
        <>
          {recentItems.length > 0 && (
            <>
              <div className="more-head">Lo último que usaste</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                {recentItems.map((it) => { const Icon = it.icon; return <button key={it.id} className="more-chip" onClick={() => open(it)}><Icon size={14} /> {it.t}</button>; })}
              </div>
            </>
          )}
          {MORE_GROUPS.map(([g, title]) => {
            const list = items.filter((it) => it.g === g).sort((a, b) => a.t.localeCompare(b.t, "es"));
            if (!list.length) return null;
            const isOpen = openG.includes(g); const GIcon = MORE_GROUP_ICONS[g] || LayoutGrid;
            const alert = list.reduce((a, it) => a + badgeOf(it), 0);
            return (
              <section key={g} className={`more-group${isOpen ? " is-open" : ""}`}>
                <button type="button" className="more-group-btn" aria-expanded={isOpen} onClick={() => toggleG(g)}>
                  <span className="more-group-ico"><GIcon size={17} color={C.ink} strokeWidth={1.8} /></span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 14.5, fontWeight: 700, color: C.ink }}>{title}</span>
                    {!isOpen && <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{list.map((it) => it.t).join(" · ")}</span>}
                  </span>
                  {alert > 0 && !isOpen && <span className="more-badge" style={{ position: "static" }}>{alert}</span>}
                  <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone }}>{list.length}</span>
                  <ChevronDown className="more-group-chev" size={18} color={C.ink} />
                </button>
                {isOpen && <div className="more-grid more-group-body">{list.map((it) => tile(it, idx++))}</div>}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
};

// Gestión del staff (solo Super Admin). Crear cuentas, cambiar rol, desactivar,
// cambiar contraseña y reiniciar la verificación en dos pasos si alguien perdió el celular.
const staffRpcError = (e) => {
  const m = e?.message || String(e || "");
  if (m.includes("SIN_PERMISO")) return "No tienes permiso para esto.";
  if (m.includes("CLAVE_CORTA")) return "La contraseña debe tener al menos 8 caracteres.";
  if (m.includes("NO_PUEDES")) return "No puedes quitarte tu propio acceso de Super Admin.";
  if (m.includes("USUARIO_EXISTE")) return "Ese usuario ya lo usa otra persona. Elige otro.";
  if (m.includes("USUARIO_INVALIDO")) return "El usuario solo puede tener letras, números, punto o guion (mínimo 3).";
  if (m.includes("staff_set_username") || e?.code === "PGRST202") return "Para cambiar el usuario falta correr el archivo 09-fase2b-club-caja.sql en Supabase.";
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
      const uname = f.username.trim().toLowerCase();
      if (uid && uname !== f.originalUsername) {
        if (!/^[a-z0-9._-]{3,30}$/.test(uname)) throw new Error("El usuario solo puede tener letras, números, punto o guion (mínimo 3).");
        const { error: e1 } = await supabase.rpc("staff_set_username", { p_user: uid, p_username: uname });
        if (e1) throw e1;
      }
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
      const { error } = await supabase.rpc("staff_upsert_profile", { p_user: uid, p_username: uname, p_name: f.name, p_role: f.role, p_phone: f.phone || "", p_active: f.active !== false });
      if (error) throw error;
      setEditing(null); await load();
    } catch (e) { setMsg(staffRpcError(e)); }
    setBusy(false);
  };
  const [pwdFor, setPwdFor] = useState(null); // { staff, value }
  const changePassword = (s) => setPwdFor({ staff: s, value: "" });
  const savePassword = async () => {
    const { staff: s, value: pwd } = pwdFor;
    if (pwd.length < 8) { alert("La contraseña debe tener al menos 8 caracteres."); return; }
    const { error } = await supabase.rpc("staff_set_password", { p_user: s.user_id, p_password: pwd });
    if (error) { alert(staffRpcError(error)); return; }
    setPwdFor(null);
    alert("Contraseña cambiada. Avísale la nueva clave en persona, no por chat.");
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
          <Field label="Usuario (para iniciar sesión)"><input style={inputStyle} value={editing.username} onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s/g, ""))} autoCapitalize="none" /></Field>
          {!isNew && editing.username.trim() !== editing.originalUsername && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft, marginTop: -6, marginBottom: 12, lineHeight: 1.5 }}>Al guardar, {editing.name || "esta persona"} tendrá que entrar con el usuario nuevo: <strong>{editing.username.trim()}</strong>. Su contraseña no cambia.</div>}
          {isNew && <Field label="Contraseña (mínimo 8 caracteres)"><PasswordInput style={inputStyle} autoComplete="new-password" value={editing.password} onChange={(e) => set("password", e.target.value)} /></Field>}
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
        <Faltan center items={[!editing.name.trim() && "escribe el nombre completo", !editing.username.trim() && "escribe el usuario", isNew && editing.password.length < 8 && "la contraseña debe tener al menos 8 caracteres"]} />
      </div>
    );
  }

  const smallBtn = { height: 30, padding: "0 10px", borderRadius: 7, border: `1px solid ${C.line}`, background: C.paperDeep, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 11, color: C.ink, display: "flex", alignItems: "center", gap: 5 };
  return (
    <div style={{ padding: "18px 18px 90px" }}>
      {pwdFor && (
        <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div onClick={() => setPwdFor(null)} style={{ position: "absolute", inset: 0, background: `${C.scrim}77` }} />
          <div className="sheet-panel sheet-small" style={{ position: "relative", background: C.paper, borderRadius: "18px 18px 0 0", padding: "20px 22px 28px" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Nueva contraseña</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.stone, marginBottom: 12 }}>Para @{pwdFor.staff.username} · mínimo 8 caracteres. Toca el ojito para revisar lo que escribiste.</div>
            <div style={{ marginBottom: 14 }}><PasswordInput autoFocus autoComplete="new-password" value={pwdFor.value} onChange={(e) => setPwdFor((x) => ({ ...x, value: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && savePassword()} style={inputStyle} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPwdFor(null)} style={{ flex: 1, padding: "12px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={savePassword} disabled={pwdFor.value.length < 8} style={{ flex: 2, padding: "12px", borderRadius: 9, border: "none", background: pwdFor.value.length < 8 ? C.line : C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cambiar contraseña</button>
            </div>
            <Faltan center items={[pwdFor.value.length < 8 && "la contraseña debe tener al menos 8 caracteres"]} />
          </div>
        </div>
      )}
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
                <button onClick={() => setEditing({ ...emptyStaffForm(), ...s, password: "", originalUsername: s.username })} style={smallBtn}><Pencil size={12} /> Editar</button>
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
  const mine = sales.filter((s) => s.staffName === staffName && s.status !== "anulado").map(netSale);
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


// ------------------------------------------------------------------
// CAJA (turno): abrir con fondo, entradas/salidas, arqueo y cierre.
// Todo lo calcula y guarda el servidor (open_cash, cash_move, close_cash). La caja queda abierta
// aunque cambie la vendedora o se cierre la sesión del panel; solo el cajero o Administración la cierran.
// ------------------------------------------------------------------
const CASH_ERRORS = {
  SIN_PERMISO: "Tu usuario no puede manejar la caja.", CAJA_YA_ABIERTA: "Esta caja ya está abierta.", CAJA_CERRADA: "La caja ya está cerrada.",
  MOTIVO_REQUERIDO: "Escribe el motivo.", VENDEDOR_INVALIDO: "Toca quién lo hace (su código de vendedora).", MOTIVO_DIFERENCIA: "Hay diferencia entre lo contado y lo esperado: escribe el motivo.",
};
const cashErrorText = (e) => {
  if (e?.code === "PGRST202") return "Falta correr el archivo 11-fase2-caja.sql en Supabase.";
  const m = e?.message || String(e || "");
  const k = Object.keys(CASH_ERRORS).find((x) => m.includes(x));
  if (!k && typeof navigator !== "undefined" && navigator.onLine === false) return "Sin internet: no se guardó. Conéctate y vuelve a tocar el botón (no se duplica).";
  return k ? CASH_ERRORS[k] : "No se pudo completar. Revisa tu conexión e intenta de nuevo.";
};
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

const useStoreChoice = (settings) => {
  const stores = storesOf(settings);
  const [storeId, setStoreId] = useState(() => { try { return localStorage.getItem("flyboutique:sede") || stores[0].id; } catch (e) { return stores[0].id; } });
  const store = stores.find((x) => x.id === storeId) || stores[0];
  const choose = (id) => { setStoreId(id); try { localStorage.setItem("flyboutique:sede", id); } catch (e) { /* nada */ } };
  return { stores, store, choose };
};

// Llama a una función nueva del servidor; si el SQL aún no se corrió, repite sin los datos nuevos
const rpcWithFallback = async (fn, args, newKeys) => {
  const res = await supabase.rpc(fn, args);
  if (res.error?.code === "PGRST202" && newKeys.length) {
    const old = Object.fromEntries(Object.entries(args).filter(([k]) => !newKeys.includes(k)));
    return supabase.rpc(fn, old);
  }
  return res;
};
// Elegir quién lo hace (código de vendedora) con un toque
const SellerPicker = ({ sellers, value, onChange, label }) => {
  if (!sellers.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {sellers.map((x) => {
          const on = value === x.code;
          return (
            <button key={x.code} onClick={() => onChange(x.code)} title={`${x.name} (${x.code})`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 7px", borderRadius: 999, border: `1.5px solid ${on ? C.ink : C.line}`, background: on ? C.ink : C.paper, color: on ? C.paper : C.ink, cursor: "pointer" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: on ? C.paper : C.paperDeep, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 800 }}>{x.code.slice(0, 2)}</span>
              <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600 }}>{x.name.split(" ")[0]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
// Tabla "¿Quién cobró qué?"
const BySellerTable = ({ bySeller }) => {
  const rows = Object.entries(bySeller || {});
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.stone, fontWeight: 600, marginBottom: 6 }}>¿Quién cobró qué?</div>
      {rows.map(([who, v]) => (
        <div key={who} style={{ padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 12.5 }}><strong>{who}</strong><strong>{money2(v.total)}</strong></div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft }}>{v.ventas} venta{v.ventas === 1 ? "" : "s"} · {Object.entries(v.porMetodo || {}).map(([m, t]) => `${m} ${money2(t)}`).join(" · ")}</div>
        </div>
      ))}
    </div>
  );
};

const CashReport = ({ s, storeName }) => (
  <div className="print-area" style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800, marginBottom: 2 }}>Cierre de caja · {storeName}</div>
    <div style={{ color: C.stone, fontSize: 11.5, marginBottom: 10 }}>Abrió {s.opened_seller || s.opened_by_name || "—"} ({fmtDateTime(s.opened_at)}) · Cerró {s.closed_seller || s.closed_by_name || "—"} ({fmtDateTime(s.closed_at)})</div>
    <Row label="Fondo inicial" value={money2(s.opening_amount)} />
    {Object.entries(s.byMethod || s.totals?.byMethod || {}).map(([m, v]) => <Row key={m} label={`Ventas ${m}`} value={money2(v)} />)}
    <Row label="Entradas de efectivo" value={money2(s.entradas ?? s.totals?.entradas)} />
    <Row label="Salidas de efectivo" value={`-${money2(s.salidas ?? s.totals?.salidas)}`} />
    <Row label="Efectivo esperado" value={money2(s.expected_cash ?? s.expectedCash)} bold />
    <Row label="Efectivo contado" value={money2(s.counted_cash)} />
    <Row label="Diferencia" value={money2(s.difference)} bold />
    {s.notes && <div style={{ marginTop: 6, color: C.inkSoft }}>Motivo / nota: {s.notes}</div>}
    <BySellerTable bySeller={s.bySeller || s.totals?.bySeller} />
    <div style={{ marginTop: 6, color: C.stone, fontSize: 11 }}>{s.salesCount ?? s.totals?.salesCount ?? 0} ventas · Documento interno de control</div>
  </div>
);

// Botón grande con ícono (pantallas de caja: fáciles de tocar en el mostrador)
const BigAction = ({ icon: Icon, title, hint, onClick, dark = false, disabled = false }) => (
  <button className={`big-action${dark ? " big-main" : ""}`} onClick={onClick} disabled={disabled} title={hint ? `${title}: ${hint}` : title} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, padding: "16px 14px", borderRadius: 14, border: `1.5px solid ${C.ink}`, background: dark ? C.ink : C.paper, color: dark ? C.paper : C.ink, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, textAlign: "left", minHeight: 108 }}>
    <span className="big-ico" style={{ width: 40, height: 40, borderRadius: 12, background: dark ? "rgba(255,255,255,0.12)" : C.paperDeep, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={21} /></span>
    <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 800 }}>{title}</span>
    {hint && <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, opacity: 0.75, lineHeight: 1.4 }}>{hint}</span>}
  </button>
);

// Paso numerado (se marca ✓ al completarlo): guía al abrir la caja
const CashStep = ({ n, title, done, children }) => (
  <div className={`cash-step${done ? " is-done" : ""}`}>
    <span className="cash-step-n">{done ? <Check size={14} /> : n}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  </div>
);

const CashScreen = ({ catalog, role, onGoSell, onReturns, onCredits }) => {
  const canManage = ["superadmin", "administrador", "cajero"].includes(role);
  const isAdmin = role === "superadmin" || role === "administrador";
  const { stores, store, choose } = useStoreChoice(catalog.settings);
  const [cash, setCash] = useState(undefined); // undefined = cargando, null = cerrada
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [openAmount, setOpenAmount] = useState("");
  const [move, setMove] = useState(null); // { type, amount, reason }
  const [closing, setClosing] = useState(null); // { counted, notes }
  const [closedReport, setClosedReport] = useState(null);
  const [history, setHistory] = useState([]);
  const formRef = useRef(null);
  const reportRef = useRef(null);
  useEffect(() => { if (closedReport && reportRef.current) reportRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); }, [closedReport]);
  useEffect(() => { if ((move || closing) && formRef.current) formRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [!!move, !!closing, move?.type, closing?.shift]);
  // Quién hace cada cosa (si hay códigos de vendedora creados)
  const [sellers, setSellers] = useState([]);
  useEffect(() => { supabase.from("sellers").select("code,name").eq("active", true).order("code").then(({ data }) => setSellers(data || []), () => {}); }, []);
  const [openSeller, setOpenSeller] = useState("");
  const needSeller = sellers.length > 0;

  const load = async () => {
    setMsg("");
    const { data, error } = await supabase.rpc("current_cash", { p_store: store.id });
    if (error) { setMsg(cashErrorText(error)); setCash(null); return; }
    setCash(data || null);
    if (isAdmin) {
      const h = await supabase.from("cash_sessions").select("*").eq("status", "cerrada").order("closed_at", { ascending: false }).limit(15);
      setHistory(h.data || []);
    }
  };
  useEffect(() => { setCash(undefined); load(); }, [store.id]);
  const run = async (fn) => { setBusy(true); setMsg(""); try { await fn(); } finally { setBusy(false); } };

  const openCash = () => run(async () => {
    const { error } = await rpcWithFallback("open_cash", { p_store: store.id, p_amount: Number(openAmount) || 0, p_seller: openSeller || null }, ["p_seller"]);
    if (error) { setMsg(cashErrorText(error)); return; }
    setOpenAmount(""); setOpenSeller(""); await load();
  });
  const saveMove = () => run(async () => {
    const { error } = await rpcWithFallback("cash_move", { p_session: cash.id, p_type: move.type, p_amount: Number(move.amount), p_reason: move.reason.trim(), p_seller: move.seller || null }, ["p_seller"]);
    if (error) { setMsg(cashErrorText(error)); return; }
    setMove(null); await load();
  });
  const expected = Number(cash?.expectedCash || 0);
  const counted = closing ? Number(closing.counted || 0) : 0;
  const diff = Math.round((counted - expected) * 100) / 100;
  const closeCash = () => run(async () => {
    if (closing.shift) {
      const next = closing.next === "" ? counted : Number(closing.next) || 0;
      const { data, error } = await supabase.rpc("shift_change", { p_session: cash.id, p_counted: counted, p_notes: closing.notes.trim(), p_next_amount: next, p_seller_out: closing.seller || null, p_seller_in: closing.sellerIn || null });
      if (error) { setMsg(error.code === "PGRST202" ? "Para el cambio de turno falta correr el archivo 13-caja-turnos.sql en Supabase." : error.message?.includes("FONDO_MAYOR") ? "El dinero que queda no puede ser mayor que lo contado." : cashErrorText(error)); return; }
      setClosing(null); setClosedReport(data.closed); await load(); return;
    }
    const { data, error } = await rpcWithFallback("close_cash", { p_session: cash.id, p_counted: counted, p_notes: closing.notes.trim(), p_seller: closing.seller || null }, ["p_seller"]);
    if (error) { setMsg(cashErrorText(error)); return; }
    setClosing(null); setClosedReport(data); await load();
  });

  const btn = (primary) => ({ padding: "11px 16px", borderRadius: 9, border: primary ? "none" : `1px solid ${C.ink}`, background: primary ? C.ink : "transparent", color: primary ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" });

  return (
    <div style={{ padding: "18px 18px 100px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: 0 }}>Caja</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {stores.length > 1 && <select value={store.id} onChange={(e) => choose(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "8px 10px" }}>{stores.map((x) => <option key={x.id} value={x.id}>Sede: {x.name}</option>)}</select>}
          <button onClick={load} style={btn(false)}>Actualizar</button>
        </div>
      </div>
      {msg && !closing && !move && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.accent, marginBottom: 12 }}>{msg}</div>}

      {closedReport && (
        <AdminCard style={{ marginBottom: 14 }}>
          <div ref={reportRef} style={{ scrollMarginTop: 80 }} />
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 8 }}>✓ Caja cerrada. Este es el informe del turno.</div>
          <CashReport s={closedReport} storeName={store.name} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => window.print()} style={btn(false)}>Imprimir</button>
            <button onClick={() => setClosedReport(null)} style={btn(true)}>Listo</button>
          </div>
        </AdminCard>
      )}

      {cash === undefined ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Cargando…</div>
      ) : !cash ? (
        <AdminCard>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}><Banknote size={26} color={C.paper} /></div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 6 }}>La caja de {store.name} está cerrada</div>
          {canManage ? (
            <>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, marginBottom: 14, lineHeight: 1.6 }}>Sigue estos pasos para empezar el día. La caja queda abierta todo el turno, aunque cambie la vendedora.</div>
              {needSeller && (
                <CashStep n={1} title="¿Quién abre la caja?" done={!!openSeller}>
                  <SellerPicker sellers={sellers} value={openSeller} onChange={setOpenSeller} label="" />
                </CashStep>
              )}
              <CashStep n={needSeller ? 2 : 1} title="¿Con cuánto dinero empiezas? (fondo para dar vuelto)" done={openAmount !== ""}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  {[0, 50, 100, 150, 200].map((v) => <Chip key={v} active={openAmount === String(v)} onClick={() => setOpenAmount(String(v))}>{v === 0 ? "Sin fondo" : `S/ ${v}`}</Chip>)}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 13 }}>Otro monto S/</span>
                  <input inputMode="decimal" value={openAmount} onChange={(e) => setOpenAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" aria-label="Fondo inicial" style={{ ...inputStyle, width: 130, fontSize: 16 }} />
                </div>
              </CashStep>
              <CashStep n={needSeller ? 3 : 2} title="Abre la caja" done={false}>
                <button disabled={busy || (needSeller && !openSeller)} onClick={openCash} className={!(needSeller && !openSeller) && openAmount !== "" ? "btn-ready" : ""}
                  style={{ width: "100%", padding: "15px", borderRadius: 12, border: "none", background: needSeller && !openSeller ? C.line : C.ink, color: needSeller && !openSeller ? C.stone : C.paper, fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", cursor: needSeller && !openSeller ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Banknote size={18} /> {busy ? "Abriendo…" : `Abrir caja${openAmount !== "" ? ` con ${money2(Number(openAmount) || 0)}` : ""}`}
                </button>
                {needSeller && !openSeller && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 6 }}>Primero toca quién abre la caja (paso 1).</div>}
              </CashStep>
            </>
          ) : <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft }}>Pide al cajero o a Administración que la abra para poder vender.</div>}
        </AdminCard>
      ) : (
        <>
          <div className="cash-hero">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="cash-live" /> <span style={{ fontFamily: FONT_BODY, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Caja abierta · {store.name}</span></div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, opacity: 0.7 }}>Abrió {cash.opened_seller || cash.opened_by_name || "—"} · {fmtDateTime(cash.opened_at)}</div>
            </div>
            {canManage && cash.expectedCash !== undefined ? (
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, opacity: 0.7 }}>Efectivo que debe haber en la caja</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>{money2(cash.expectedCash)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="cash-pill">{cash.salesCount || 0} ventas</span>
                  <span className="cash-pill">Vendido {money2(Object.values(cash.byMethod || {}).reduce((a, v) => a + Number(v || 0), 0))}</span>
                </div>
              </div>
            ) : <div style={{ fontFamily: FONT_BODY, fontSize: 13, marginTop: 10, opacity: 0.85 }}>Ya puedes vender.</div>}
          </div>
          {canManage && cash.expectedCash !== undefined && (
          <AdminCard style={{ marginBottom: 14 }}>
            <details>
              <summary style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" }}>Ver detalle del turno (fondo, pagos, entradas y salidas, por vendedora)</summary>
              <div style={{ marginTop: 10 }}>
                <Row label="Fondo inicial" value={money2(cash.opening_amount)} />
                {Object.entries(cash.byMethod || {}).map(([m, v]) => <Row key={m} label={`Ventas ${m}`} value={money2(v)} />)}
                <Row label="Entradas" value={money2(cash.entradas)} />
                <Row label="Salidas" value={`-${money2(cash.salidas)}`} />
                <Row label="Efectivo que debe haber" value={money2(cash.expectedCash)} bold />
                <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, marginTop: 4 }}>{cash.salesCount || 0} ventas en este turno</div>
                <BySellerTable bySeller={cash.bySeller} />
              </div>
            </details>
          </AdminCard>
          )}

          {canManage && (
            <>
              <div className="more-head">Atender clientes</div>
              <div className="cash-grid">
                {onGoSell && <BigAction icon={ShoppingCart} title="Vender" hint="Cobrar prendas al cliente" onClick={onGoSell} dark />}
                {onReturns && <BigAction icon={Undo2} title="Devolución o cambio" hint="La persona trae una prenda" onClick={onReturns} />}
                {onCredits && <BigAction icon={Wallet} title="Vales" hint="Ver el saldo de un vale" onClick={onCredits} />}
              </div>
              <div className="more-head">Dinero de la caja</div>
              <div className="cash-grid">
                <BigAction icon={Plus} title="Entrada" hint="Meter efectivo (ej. sencillo)" onClick={() => { setMove({ type: "entrada", amount: "", reason: "" }); setClosing(null); }} />
                <BigAction icon={Minus} title="Salida" hint="Sacar efectivo (ej. compras)" onClick={() => { setMove({ type: "salida", amount: "", reason: "" }); setClosing(null); }} />
              </div>
              <div className="more-head">Fin del turno</div>
              <div className="cash-grid">
                <BigAction icon={RotateCcw} title="Cambio de turno" hint="Entregar la caja a otra persona" onClick={() => { setClosing({ counted: "", notes: "", shift: true, next: "" }); setMove(null); }} />
                <BigAction icon={Banknote} title="Cerrar caja" hint="Contar el dinero y cerrar el día" onClick={() => { setClosing({ counted: "", notes: "", shift: false }); setMove(null); }} />
              </div>
              <div ref={formRef} />
              {move && (
                <AdminCard style={{ marginBottom: 14, border: `1.5px solid ${C.ink}` }}>
                  <span style={labelStyle}>{move.type === "entrada" ? "Entrada de efectivo" : "Salida de efectivo"}</span>
                  <SellerPicker sellers={sellers} value={move.seller || ""} onChange={(c) => setMove({ ...move, seller: c })} label="¿Quién lo hace?" />
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input inputMode="decimal" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="Monto S/" style={{ ...inputStyle, width: 130 }} />
                    <input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder={move.type === "entrada" ? "Motivo (ej. sencillo del banco)" : "Motivo (ej. compra de bolsas)"} style={inputStyle} />
                  </div>
                  {(() => { const falta = [needSeller && !move.seller && "toca quién lo hace", !(Number(move.amount) > 0) && "escribe el monto", !move.reason.trim() && "escribe el motivo"].filter(Boolean);
                    return falta.length ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, marginBottom: 8 }}>Para guardar: {falta.join(", ")}.</div> : null; })()}
                  {msg && <div role="alert" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.accent, marginBottom: 8 }}>{msg}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setMove(null)} style={btn(false)}>Cancelar</button>
                    <button disabled={busy || !(Number(move.amount) > 0) || !move.reason.trim() || (needSeller && !move.seller)} onClick={saveMove} style={btn(true)}>Guardar</button>
                  </div>
                </AdminCard>
              )}
              {closing && (
                <AdminCard style={{ marginBottom: 14, border: `1.5px solid ${C.ink}` }}>
                  <span style={labelStyle}>{closing.shift ? "Cambio de turno" : "Cierre y arqueo"}</span>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                    <Chip active={!closing.shift} onClick={() => setClosing({ ...closing, shift: false })}>Cerrar el día</Chip>
                    <Chip active={!!closing.shift} onClick={() => setClosing({ ...closing, shift: true, next: closing.next ?? "" })}>Cambio de turno (sigue abierta)</Chip>
                  </div>
                  <SellerPicker sellers={sellers} value={closing.seller || ""} onChange={(c) => setClosing({ ...closing, seller: c })} label={closing.shift ? "¿Quién entrega la caja?" : "¿Quién cierra la caja?"} />
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, marginBottom: 10, lineHeight: 1.6 }}>Cuenta todo el efectivo de la caja (incluido el fondo) y escríbelo.</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 13 }}>Efectivo contado S/</span>
                    <input autoFocus inputMode="decimal" value={closing.counted} onChange={(e) => setClosing({ ...closing, counted: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inputStyle, width: 130, fontSize: 15 }} />
                  </div>
                  {closing.counted !== "" && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, marginBottom: 8, color: diff === 0 ? C.ink : C.accent }}>
                      Esperado {money2(expected)} · {diff === 0 ? "Cuadra exacto ✓" : diff > 0 ? `Sobra ${money2(diff)}` : `Falta ${money2(-diff)}`}
                    </div>
                  )}
                  {closing.counted !== "" && diff !== 0 && <input value={closing.notes} onChange={(e) => setClosing({ ...closing, notes: e.target.value })} placeholder="Motivo de la diferencia (obligatorio)" style={{ ...inputStyle, marginBottom: 8 }} />}
                  {closing.shift && closing.counted !== "" && (
                    <div style={{ background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 13 }}>Dinero que queda para el siguiente turno S/</span>
                        <input inputMode="decimal" value={closing.next} onChange={(e) => setClosing({ ...closing, next: e.target.value.replace(/[^0-9.]/g, "") })} placeholder={Number(counted).toFixed(2)} style={{ ...inputStyle, width: 120 }} />
                      </div>
                      {closing.next !== "" && Number(closing.next) < counted && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>Se retiran {money2(counted - Number(closing.next))} (quedará anotado en el informe).</div>}
                      <SellerPicker sellers={sellers} value={closing.sellerIn || ""} onChange={(c) => setClosing({ ...closing, sellerIn: c })} label="¿Quién recibe la caja?" />
                    </div>
                  )}
                  {(() => {
                    const falta = [needSeller && !closing.seller && (closing.shift ? "toca quién entrega la caja" : "toca quién cierra la caja"), closing.counted === "" && "escribe el efectivo contado",
                      closing.counted !== "" && diff !== 0 && !closing.notes.trim() && "escribe el motivo de la diferencia", needSeller && closing.shift && !closing.sellerIn && "toca quién recibe la caja"].filter(Boolean);
                    return falta.length ? <div className="cash-missing" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, marginBottom: 8 }}>Para continuar: {falta.join(", ")}.</div> : null;
                  })()}
                  {msg && <div role="alert" className="cash-form-error" style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.accent, marginBottom: 8 }}>{msg}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setClosing(null)} style={btn(false)}>Cancelar</button>
                    <button disabled={busy || closing.counted === "" || (diff !== 0 && !closing.notes.trim()) || (needSeller && (!closing.seller || (closing.shift && !closing.sellerIn)))}
                      onClick={() => { if (confirm(closing.shift ? "¿Hacer el cambio de turno? Se cierra este turno con su arqueo y se abre el siguiente." : "¿Cerrar la caja? Ya no se podrá vender en esta sede hasta abrirla de nuevo.")) closeCash(); }} style={btn(true)}>{busy ? "Guardando…" : closing.shift ? "Hacer cambio de turno" : "Cerrar caja"}</button>
                  </div>
                </AdminCard>
              )}
              {(cash.movements || []).length > 0 && (
                <AdminCard style={{ marginBottom: 14 }}>
                  <span style={labelStyle}>Movimientos del turno</span>
                  {cash.movements.map((m) => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontFamily: FONT_BODY, fontSize: 12.5, padding: "6px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
                      <span>{m.type === "entrada" ? "+" : "−"} {m.reason} <span style={{ color: C.stone }}>· {m.seller || m.created_by_name || ""} · {fmtDateTime(m.created_at)}</span></span>
                      <strong>{money2(m.amount)}</strong>
                    </div>
                  ))}
                </AdminCard>
              )}
            </>
          )}
        </>
      )}

      {isAdmin && history.length > 0 && (
        <AdminCard style={{ marginTop: 14 }}>
          <span style={labelStyle}>Últimos cierres</span>
          {history.map((h) => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontFamily: FONT_BODY, fontSize: 12, padding: "7px 0", borderBottom: `1px solid ${C.paperDeep}` }}>
              <span>{fmtDateTime(h.closed_at)} · {(stores.find((x) => x.id === h.store_id) || {}).name || h.store_id} · {h.closed_by_name || "—"}</span>
              <span>Esperado {money2(h.expected_cash)} · Contado {money2(h.counted_cash)} · <strong style={{ color: Number(h.difference) === 0 ? C.ink : C.accent }}>{Number(h.difference) === 0 ? "cuadra" : money2(h.difference)}</strong></span>
            </div>
          ))}
        </AdminCard>
      )}
    </div>
  );
};

// ------------------------------------------------------------------
// VENDEDORES: códigos únicos (ej. MA01) para saber quién hizo cada venta.
// El código NO es una contraseña ni da permisos: solo identifica a la vendedora.
// ------------------------------------------------------------------
const suggestSellerCode = (name, existing) => {
  const parts = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, "").split(" ").filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0] || "XX").slice(0, 2).padEnd(2, "X");
  for (let i = 1; i < 100; i++) { const c = `${letters}${String(i).padStart(2, "0")}`; if (!existing.includes(c)) return c; }
  return letters + "99";
};

// Clientas del Club Fly: compras, puntos y permiso de publicidad (Ley 29733). Solo administración.
const consentOf = (c) => (c.marketing && typeof c.marketing.optIn === "boolean" ? c.marketing : null);
const CustomersScreen = ({ catalog, refreshData }) => {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("todas");
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [local, setLocal] = useState({});
  const stats = useMemo(() => {
    const m = new Map();
    (catalog.sales || []).forEach((s) => {
      if (!s.customerPhone || s.status === "anulado") return;
      const x = m.get(s.customerPhone) || { n: 0, total: 0, last: 0 };
      x.n += 1; x.total += Number(netSale(s).total) || 0; x.last = Math.max(x.last, s.createdAt || 0);
      m.set(s.customerPhone, x);
    });
    return m;
  }, [catalog.sales]);
  const all = useMemo(() => (catalog.customers || []).map((c) => (local[c.phone] ? { ...c, marketing: local[c.phone] } : c))
    .map((c) => ({ ...c, st: stats.get(c.phone) || { n: 0, total: 0, last: 0 } })), [catalog.customers, stats, local]);
  const nq = q.trim().toLowerCase();
  const list = all
    .filter((c) => filter === "todas" || (filter === "si" ? consentOf(c)?.optIn === true : consentOf(c)?.optIn !== true))
    .filter((c) => !nq || `${c.name || ""} ${c.phone || ""} ${c.email || ""} ${c.doc || ""}`.toLowerCase().includes(nq))
    .sort((a, b) => (b.st.last || b.createdAt || 0) - (a.st.last || a.createdAt || 0));
  const yes = all.filter((c) => consentOf(c)?.optIn === true).length;
  const showPhone = (p) => (String(p || "").startsWith("g:") ? "" : `+${p}`);
  const exportConsent = async () => {
    const rows = all.filter((c) => consentOf(c)?.optIn === true).map((c) => ({
      Nombre: c.name || "", Celular: showPhone(c.phone), Correo: c.email || "", Puntos: Number(c.points) || 0,
      Compras: c.st.n, "Total comprado (S/)": Number(c.st.total.toFixed(2)), "Permiso desde": new Date(c.marketing.at).toLocaleDateString("es-PE"), "Dio el permiso por": c.marketing.via || "",
    }));
    if (!rows.length) { setMsg("Aún no hay personas con permiso para recibir publicidad."); return; }
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Con permiso");
    XLSX.writeFile(wb, `fly-clientas-con-permiso-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const setConsent = async (c, optIn) => {
    if (!note.trim()) { setMsg("Escribe cómo lo pidió (ej. «Lo pidió en tienda» o «Pidió baja por WhatsApp»)."); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("staff_set_marketing", { p_phone: c.phone, p_optin: optIn, p_note: note.trim() });
    setBusy(false);
    if (error) { setMsg(error.code === "PGRST202" ? "Falta correr el SQL 20 en Supabase." : "No se pudo guardar. Intenta de nuevo."); return; }
    setLocal((l) => ({ ...l, [c.phone]: { optIn, at: Date.now(), via: "staff", note: note.trim() } }));
    setNote(""); setMsg(optIn ? "Guardado: acepta recibir publicidad." : "Guardado: no recibirá publicidad.");
    refreshData && refreshData();
  };
  const chip = (k, l) => <button key={k} onClick={() => setFilter(k)} style={{ padding: "7px 12px", borderRadius: 999, border: `1px solid ${filter === k ? C.ink : C.line}`, background: filter === k ? C.ink : "transparent", color: filter === k ? C.paper : C.ink, fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer" }}>{l}</button>;
  const txt = { fontFamily: FONT_BODY, fontSize: 11.5, color: C.inkSoft };
  return (
    <div style={{ padding: "18px 18px 100px", maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 4px" }}>Clientas (Club Fly)</h1>
      <div style={{ ...txt, marginBottom: 14 }}>{all.length} registradas · <strong>{yes}</strong> aceptan recibir publicidad. Solo a ellas se les envían ofertas; los avisos de pedidos se envían a todas.</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, celular, correo o DNI" style={{ ...inputStyle, marginBottom: 10 }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {chip("todas", "Todas")}{chip("si", "Con permiso")}{chip("no", "Sin permiso")}
        <button onClick={exportConsent} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, border: `1px solid ${C.ink}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}><FileSpreadsheet size={13} /> Descargar las que tienen permiso</button>
      </div>
      {msg && <div style={{ ...txt, color: C.ink, background: C.paperDeep, borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>{msg}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.slice(0, 200).map((c) => {
          const cs = consentOf(c);
          const isOpen = open === c.phone;
          return (
            <AdminCard key={c.phone} style={{ padding: 12 }}>
              <button onClick={() => { setOpen(isOpen ? null : c.phone); setNote(""); setMsg(""); }} style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.ink }}>{c.name || "Sin nombre"}</div>
                  <div style={{ ...txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[showPhone(c.phone), c.email].filter(Boolean).join(" · ")}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.ink }}>{c.st.n ? moneyExact(c.st.total) : "Sin compras"}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: cs?.optIn ? C.ink : C.stone, fontWeight: cs?.optIn ? 700 : 400 }}>{cs ? (cs.optIn ? "✓ Acepta publicidad" : "No quiere publicidad") : "Sin respuesta"}</div>
                </div>
              </button>
              {isOpen && (
                <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 10 }}>
                  <div style={txt}>Puntos: <strong>{Number(c.points) || 0}</strong> · Compras: <strong>{c.st.n}</strong>{c.st.last ? ` · Última: ${new Date(c.st.last).toLocaleDateString("es-PE")}` : ""}{c.doc ? ` · Doc.: ${c.doc}` : ""}</div>
                  <div style={{ ...txt, marginTop: 4 }}>Registro: {c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-PE") : "—"}{c.via ? ` (${c.via})` : ""}</div>
                  <div style={{ ...txt, marginTop: 4 }}>Publicidad: {cs ? `${cs.optIn ? "acepta" : "no acepta"} desde ${new Date(cs.at).toLocaleString("es-PE")} (${cs.via || "—"}${cs.by ? `, anotó ${cs.by}` : ""}${cs.note ? `: «${cs.note}»` : ""})` : "nunca respondió → no se le envía publicidad"}</div>
                  <div style={{ marginTop: 10 }}>
                    <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="¿Cómo lo pidió? (obligatorio)" style={{ ...inputStyle, marginBottom: 8 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button disabled={busy} onClick={() => setConsent(c, true)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Acepta publicidad</button>
                      <button disabled={busy} onClick={() => setConsent(c, false)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Dar de baja</button>
                    </div>
                  </div>
                </div>
              )}
            </AdminCard>
          );
        })}
        {!list.length && <div style={{ ...txt, textAlign: "center", padding: 24 }}>No hay clientas con ese filtro.</div>}
        {list.length > 200 && <div style={{ ...txt, textAlign: "center" }}>Se muestran 200. Usa el buscador para encontrar a alguien.</div>}
      </div>
    </div>
  );
};

const SellersScreen = ({ catalog }) => {
  const stores = storesOf(catalog.settings);
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data, error } = await supabase.from("sellers").select("*").order("code");
    if (error) { setMsg(error.code === "42P01" || /sellers/.test(error.message || "") ? "Falta correr el archivo 11-fase2-caja.sql en Supabase." : error.message); setList([]); return; }
    setList(data || []);
  };
  useEffect(() => { load(); }, []);
  const codes = (list || []).map((s) => s.code);
  const save = async () => {
    const code = editing.code.trim().toUpperCase();
    if (!/^[A-Z]{2,3}[0-9]{2}$/.test(code)) { setMsg("El código debe tener 2 o 3 letras y 2 números (ej. MA01)."); return; }
    if (editing.isNew && codes.includes(code)) { setMsg("Ese código ya existe."); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("upsert_seller", { p_code: code, p_name: editing.name.trim(), p_store: editing.store_id, p_active: editing.active });
    setBusy(false);
    if (error) { setMsg(cashErrorText(error)); return; }
    setEditing(null); load();
  };
  if (editing) {
    return (
      <div style={{ padding: "18px 18px 100px", maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ink, fontWeight: 800, margin: "0 0 14px" }}>{editing.isNew ? "Nuevo código de vendedor" : `Editar ${editing.code}`}</h1>
        <AdminCard>
          <Field label="Nombre de la vendedora"><input style={inputStyle} value={editing.name} onChange={(e) => { const name = e.target.value; setEditing((f) => ({ ...f, name, code: f.isNew && !f.codeTouched ? suggestSellerCode(name, codes) : f.code })); }} /></Field>
          <Field label="Código (2–3 letras + 2 números)"><input style={{ ...inputStyle, opacity: editing.isNew ? 1 : 0.6, textTransform: "uppercase" }} disabled={!editing.isNew} value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5), codeTouched: true })} /></Field>
          {stores.length > 1 && <Field label="Sede"><select style={inputStyle} value={editing.store_id} onChange={(e) => setEditing({ ...editing, store_id: e.target.value })}>{stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
          {!editing.isNew && <Switch on={editing.active} onClick={() => setEditing({ ...editing, active: !editing.active })} label="Código activo" />}
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, margin: "6px 0 12px", lineHeight: 1.5 }}>El código solo identifica quién vendió. No es una contraseña ni da acceso al panel. Si alguien deja de trabajar, desactívalo (no se borra, para no perder sus ventas en los reportes).</div>
          {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginBottom: 10 }}>{msg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setEditing(null); setMsg(""); }} style={{ flex: 1, padding: "12px", borderRadius: 9, border: `1px solid ${C.line}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
            <button disabled={busy || !editing.name.trim() || !editing.code} onClick={save} style={{ flex: 2, padding: "12px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{busy ? "Guardando…" : "Guardar"}</button>
          </div>
          <Faltan center items={[!editing.name.trim() && "escribe el nombre de la vendedora", !editing.code && "escribe el código (ej. MA01)"]} />
        </AdminCard>
      </div>
    );
  }
  return (
    <div style={{ padding: "18px 18px 100px", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: C.ink, fontWeight: 800, margin: 0 }}>Vendedores</h1>
        <button onClick={() => { setEditing({ isNew: true, name: "", code: "", store_id: stores[0].id, active: true }); setMsg(""); }} style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: C.paper, border: "none", borderRadius: 8, padding: "9px 14px", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}><Plus size={14} /> Nuevo código</button>
      </div>
      {msg && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.accent, marginBottom: 10 }}>{msg}</div>}
      {list === null ? <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone }}>Cargando…</div> : list.length === 0 ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, lineHeight: 1.6 }}>Aún no hay códigos. Mientras no crees ninguno, en caja se elige la vendedora de la lista como antes. Cuando crees el primero, cada venta en tienda pedirá el código.</div>
      ) : list.map((s) => (
        <div key={s.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}`, marginBottom: 8, opacity: s.active ? 1 : 0.5 }}>
          <div><strong style={{ fontFamily: FONT_DISPLAY, fontSize: 15 }}>{s.code}</strong> <span style={{ fontFamily: FONT_BODY, fontSize: 13 }}>· {s.name}</span>{!s.active && <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.stone }}> (inactivo)</span>}</div>
          <button onClick={() => { setEditing({ ...s, isNew: false }); setMsg(""); }} style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 7, padding: "6px 10px", fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}><Pencil size={12} /> Editar</button>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------
// AYUDA DEL PANEL: botón "? Ayuda" en cada pantalla con los pasos explicados.
// ------------------------------------------------------------------
const STAFF_GUIDES = {
  caja: { title: "Cómo usar la caja", img: "/guia/caja-abierta.png", steps: [
    ["Banknote", "Al empezar el día, cuenta el dinero con el que abres (el fondo para dar vuelto)."],
    ["User", "Toca quién abre la caja (tu nombre) y el monto del fondo. Luego «Abrir caja»."],
    ["ShoppingCart", "Para vender, toca «Vender». La caja queda abierta todo el día, aunque cambie la vendedora."],
    ["Minus", "Si metes o sacas efectivo (sencillo, taxi, compras), usa «Entrada» o «Salida», toca quién lo hace y escribe el motivo."],
    ["RotateCcw", "Si otra vendedora se queda con la caja: «Cambio de turno». Cuentas el dinero, eliges cuánto queda y quién la recibe."],
    ["Receipt", "Al final del día: «Cerrar caja». Cuenta todo el efectivo y escríbelo. Si no cuadra, explica por qué. Imprime el informe."],
  ] },
  pos: { title: "Cómo hacer una venta", img: "/guia/venta.png", steps: [
    ["Scan", "Escanea la etiqueta o toca la prenda. Elige talla y color."],
    ["ShoppingBag", "Revisa la venta a la derecha. Cambia la cantidad con + y −."],
    ["Banknote", "Toca «Cobrar»."],
    ["User", "Elige el documento (DNI, carné, pasaporte o RUC) y escríbelo: si la clienta ya compró, sus datos se completan solos."],
    ["Star", "Toca tu nombre en «¿Quién atendió?»."],
    ["CreditCard", "Elige cómo paga. Si es efectivo, toca el billete que te dio y verás el vuelto."],
    ["Check", "Toca «Registrar venta». Luego imprime el comprobante o envíalo por WhatsApp."],
  ] },
  onlinesales: { title: "Registrar una venta online", steps: [
    ["ShoppingBag", "Agrega las prendas que la clienta pidió por WhatsApp o redes."],
    ["User", "Completa sus datos y la forma de pago."],
    ["Check", "Registra la venta: el stock se descuenta al instante."],
  ] },
  mysales: { title: "Mis ventas", steps: [["BarChart3", "Aquí ves las ventas registradas a tu nombre y el total."]] },
  onlineorders: { title: "Pedidos de la web", img: "/guia/pedidos.png", steps: [
    ["Package", "Cada pedido nuevo suena y aparece aquí. La prenda queda apartada para esa clienta."],
    ["Check", "Administración confirma el pago cuando llega el dinero (Yape, Plin, transferencia)."],
    ["X", "Si la clienta no pagó, toca «Cancelar: no pagó»: la prenda vuelve al stock. Si nadie lo hace, se cancela sola pasadas las horas configuradas."],
    ["Navigation", "Cambia el estado: preparando → listo → entregado/enviado. Si es envío, pon el número de seguimiento e imprime la etiqueta."],
  ] },
  purchases: { title: "Compras a proveedores", steps: [
    ["User", "La primera vez: pestaña «Proveedores» → «Nuevo proveedor» (nombre; RUC y celular si los tienes)."],
    ["Plus", "Cuando llega mercadería: «Registrar compra» → proveedor → N.° de su factura → dónde entra (Larco o Almacén)."],
    ["Package", "Escanea o busca cada prenda, pon cuántas llegaron y cuánto costó cada una. Si la prenda es nueva, primero créala en Productos con stock 0."],
    ["Check", "«Registrar compra»: el stock sube en esa sede y el costo de la prenda se actualiza (promedio). Queda en el historial."],
    ["X", "Si te equivocaste: abre la compra → «Anular compra» con el motivo. Se restan esas prendas (si todavía están en esa sede)."],
  ] },
  transfers: { title: "Traslados entre sedes", steps: [
    ["Plus", "Quien envía: «Nueva guía» → elige desde y hacia → escanea o busca las prendas → cantidad → «Emitir guía». Puedes imprimirla y enviarla con la mercadería."],
    ["Package", "Las prendas de la guía quedan «en camino»: no se venden en ninguna sede hasta que lleguen."],
    ["Check", "Quien recibe: abre la guía → «Recibir» → confirma cuántas llegaron. Si falta algo, escribe qué pasó. Queda tu nombre y la hora."],
    ["X", "Si la guía se emitió por error y aún no llega: «Anular guía» (solo quien la emitió o Administración). Las prendas vuelven a la sede de origen."],
  ] },
  stock: { title: "Stock", steps: [
    ["Scan", "Escanea el código de la etiqueta (cada talla y color tiene el suyo) o busca por nombre."],
    ["Plus", "Llegó mercadería: «Movimiento» → «Entrada» y la cantidad. Se SUMA a lo que hay (si alguien vende mientras tanto, no se pierde)."],
    ["Minus", "Prenda malograda o que no se puede vender: «Dañada». Si se regaló: «Regalo» y a quién. Ambos piden motivo."],
    ["Pencil", "Contaste las prendas: «Conteo» y el total. Si alguien vendió mientras contabas, te avisa para que vuelvas a contar."],
    ["BarChart3", "«Historial de esta prenda»: cuántas entraron, se vendieron, se devolvieron; a quién, a qué precio, con qué comprobante y quién lo hizo."],
    ["Navigation", "Cada talla/color muestra cuántas hay en Larco y en el Almacén. Para mover prendas usa «Traslados entre sedes» (guía). La web vende de las dos sedes; la caja de Larco, de Larco."],
  ] },
  dashboard: { title: "Panel", steps: [
    ["LayoutDashboard", "Resumen de ventas, pedidos y stock bajo."],
    ["Menu", "En «Más» están la caja, los vendedores, comprobantes, reportes, usuarios y la configuración."],
    ["BookOpen", "El «Manual del equipo» explica todo paso a paso por función."],
  ] },
  products: { title: "Productos", steps: [
    ["Plus", "«Nuevo producto»: nombre, categoría, precio y, si está en oferta, el precio anterior."],
    ["Layers", "Agrega tallas (botones XS a XXL) y colores: cada combinación tiene su propio stock y su propio código de barras. El sistema no deja repetir códigos."],
    ["ImageIcon", "Sube fotos verticales (ideal 1080×1440) y asigna cada foto a su color. Puedes subir un video."],
    ["Eye", "Usa «Activo / Borrador» y «Mostrar en la web» para publicar u ocultar sin borrar."],
    ["Gift", "Para liquidar: en la lista toca «Pasar al Outlet» y escribe el precio final (luego puedes cambiarlo o «Sacar del Outlet»). También desde editar → «Outlet». Sale del catálogo y aparece solo en la sección Outlet (sin cupones ni puntos, envío a cargo de la clienta, sin cambios)."],
  ] },
  productEditor: { title: "Editar un producto", steps: [
    ["Pencil", "Cambia lo que necesites y toca «Guardar». El stock real no se pisa: las ventas hechas mientras editas se respetan."],
    ["ImageIcon", "Cada foto con su color: así, al pasar el mouse por un color, la clienta ve esa foto."],
  ] },
  banners: { title: "Banners", steps: [["ImageIcon", "La imagen grande de la portada. Medida 1080×1920 (vertical), menos de 500 KB. Actívalo o desactívalo sin borrarlo."]] },
  collections: { title: "Colecciones", steps: [["Layers", "Agrupa prendas (ej. «Cena de viernes»). Elige las prendas y una portada."]] },
  invoices: { title: "Comprobantes", steps: [
    ["Receipt", "Busca una venta para verla, reimprimirla (80 mm, 58 mm o A4) o enviarla. Reimprimir no crea otra venta."],
    ["Undo2", "Anular devuelve el stock y los puntos. Pide un motivo y queda registrado quién lo hizo."],
  ] },
  reports: { title: "Reportes", steps: [
    ["BarChart3", "Filtra por fechas, sede, canal y vendedora. Descarga a Excel para revisar o enviar al contador."],
    ["Banknote", "«Rentabilidad»: ventas, costo de lo vendido, margen y ganancia. Si falta el costo de alguna prenda dice «Incompleto» y cuáles faltan (se pone en Productos → editar)."],
    ["Receipt", "«Gastos»: registra alquiler, sueldos, luz, publicidad… No se borran: se anulan con motivo y queda quién lo hizo."],
  ] },
  users: { title: "Usuarios y permisos", steps: [
    ["User", "Cada persona con su propio usuario y contraseña. No compartan usuarios."],
    ["ShieldCheck", "Roles: Cajero(a) = caja y ventas. Vendedora Tienda = solo vende. Administración = todo. Almacén = stock."],
    ["X", "Para quitar el acceso, apaga «Acceso activo» (no borres: se conserva su historial)."],
  ] },
  promocodes: { title: "Códigos promocionales", steps: [["Gift", "Crea un código (ej. FLY10) con % o monto. Puede ser solo para el Club Fly. Desactívalo cuando termine la promoción."]] },
  complaints: { title: "Libro de Reclamaciones", steps: [["BookOpen", "Responde cada reclamo dentro del plazo legal (15 días hábiles). La respuesta queda guardada."]] },
  credits: { title: "Vales de compra", steps: [
    ["Ticket", "Un vale se crea al hacer una devolución eligiendo «Vale». Tiene un código (ej. V7K2QX) y un saldo."],
    ["Banknote", "Para usarlo: en Cobrar toca «Vale», escribe el código y «Ver saldo». Si no alcanza, cobra lo que falta con otro medio."],
    ["ShieldCheck", "El saldo se descuenta al guardar la venta; si se anula la venta, el saldo vuelve al vale."],
  ] },
  returns: { title: "Devolución o cambio", steps: [
    ["Search", "Escribe el número de la venta (está en el ticket, ej. B001-000123) y toca «Buscar»."],
    ["Undo2", "Marca con + las prendas que vuelven. Si se lleva otra (cambio de talla o color), búscala o escanéala."],
    ["Banknote", "El sistema dice cuánto devolver o cobrar. En efectivo queda solo en la caja abierta. Escribe el motivo."],
    ["ShieldCheck", "No se puede devolver más de lo vendido y reintentar no duplica. Una venta con devoluciones ya no se anula entera."],
  ] },
  customers: { title: "Clientas", steps: [
    ["User", "Busca a una clienta para ver sus compras, puntos y si acepta publicidad."],
    ["ShieldCheck", "Ofertas y campañas SOLO a quienes aceptaron (botón «Descargar las que tienen permiso»). Quien no respondió cuenta como «no»."],
    ["Pencil", "Si alguien lo pide en tienda o por WhatsApp, ábrela, escribe cómo lo pidió y toca «Acepta» o «Dar de baja». Queda anotado quién lo cambió."],
  ] },
  sellers: { title: "Códigos de vendedor", steps: [
    ["User", "Crea un código por vendedora (ej. MA01). Se sugiere solo con sus iniciales."],
    ["ShieldCheck", "El código solo dice quién vendió o movió la caja: no es contraseña ni da acceso al panel."],
    ["X", "Si alguien deja de trabajar, desactívalo. No se borra, para no perder sus ventas en los reportes."],
  ] },
};
const GUIDE_ICONS = { Ticket, Banknote, Plus, ShoppingCart, Minus, Receipt, Scan, ShoppingBag, User, Star, CreditCard, Check, BarChart3, Package, Navigation, Pencil, LayoutDashboard, Menu, ShieldCheck, X, Undo2, RotateCcw, BookOpen, Layers, ImageIcon, Eye, Gift, Search };

// Captura de una pantalla para las guías (si la imagen no existe, no se muestra nada)
const GuideImage = ({ src, alt }) => {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return <img src={src} alt={alt || ""} onError={() => setOk(false)} loading="lazy" style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.line}`, display: "block", background: C.paperDeep }} />;
};

const StaffHelp = ({ screen, onOpenManual }) => {
  const guide = STAFF_GUIDES[screen];
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [screen]); // la guía solo se abre al tocar el botón de Ayuda
  if (!guide) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} title="¿Cómo se hace? Ver los pasos de esta pantalla" className="staff-help-btn"
        style={{ position: "fixed", right: 18, bottom: 96, zIndex: 40, display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 999, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 6px 18px rgba(0,0,0,0.22)" }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: C.paper, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 13 }}>?</span><span className="help-label">Ayuda</span>
      </button>
      {open && (
        <div className="overlay-sheet" style={{ position: "fixed", inset: 0, zIndex: 75, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div onClick={() => setOpen(false)} style={{ position: "absolute", inset: 0, background: `${C.scrim}66` }} />
          <div className="sheet-panel help-panel" style={{ position: "relative", background: C.paper, borderRadius: "18px 18px 0 0", padding: "20px 20px 18px", width: "min(820px, 96vw)", maxWidth: "96vw", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexShrink: 0 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 800, color: C.ink }}>{guide.title}</div>
              <button onClick={() => setOpen(false)} aria-label="Cerrar ayuda" style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div className="help-steps" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, overflowY: "auto", minHeight: 0, flex: 1 }}>
              {guide.img && <div style={{ gridColumn: "1 / -1" }}><GuideImage src={guide.img} alt={guide.title} /></div>}
              {guide.steps.map(([icon, text], i) => {
                const Icon = GUIDE_ICONS[icon] || Check;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: C.paperDeep, borderRadius: 12, padding: "12px 14px" }}>
                    <span style={{ position: "relative", width: 36, height: 36, borderRadius: 10, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={17} color={C.paper} />
                      <span style={{ position: "absolute", top: -6, left: -6, width: 18, height: 18, borderRadius: "50%", background: C.paper, border: `1.5px solid ${C.ink}`, fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", color: C.ink }}>{i + 1}</span>
                    </span>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.ink, lineHeight: 1.5, paddingTop: 2 }}>{text}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.stone, margin: "12px 0 12px" }}>Consejo: en la computadora, deja el mouse quieto sobre un botón para ver qué hace.</div>
              <div style={{ display: "flex", gap: 8 }}>
                {onOpenManual && <button onClick={() => { setOpen(false); onOpenManual(); }} style={{ flex: 1, padding: "13px", borderRadius: 9, border: `1px solid ${C.ink}`, background: "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Ver el manual completo</button>}
                <div style={{ flex: 1 }}><PrimaryButton onClick={() => setOpen(false)}>Entendido</PrimaryButton></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};


// ------------------------------------------------------------------
// MANUAL DEL EQUIPO: qué hace cada persona, paso a paso y con capturas.
// Cada quien ve primero lo suyo; la dueña/Administración ve todo.
// ------------------------------------------------------------------
const MANUAL_SECTIONS = [
  { id: "tienda", roles: ["cajero", "vendedora_tienda", "administrador", "superadmin"], icon: "Store", title: "Vendedora / cajera: el día a día en la tienda", intro: "Una sola computadora con el usuario de la tienda (ej. «larco»). Cada vendedora se identifica tocando su nombre (su código, ej. MA01) cuando cobra, abre, mueve dinero o cierra la caja.", items: [
    { title: "1. Abrir la caja (al llegar)", img: "/guia/caja-cerrada.png", steps: ["Entra con el usuario de la tienda.", "Caja → toca tu nombre en «¿Quién abre la caja?».", "Cuenta el dinero inicial y toca el monto (S/ 50, 100…) o escríbelo.", "Toca «Abrir caja». Ya se puede vender."] },
    { title: "2. Vender", img: "/guia/venta.png", steps: ["Vender → escanea la etiqueta o toca la prenda.", "Elige talla y color. Revisa la venta a la derecha.", "Toca «Cobrar»."] },
    { title: "3. Cobrar", img: "/guia/cobro.png", steps: ["Elige el documento (DNI, carné, pasaporte o RUC) y escríbelo: si ya es clienta, se completa sola.", "Toca tu nombre en «¿Quién atendió?».", "Elige cómo paga (se puede combinar: parte Yape, parte efectivo).", "Efectivo: toca el billete que te dio y mira el vuelto.", "«Registrar venta»."] },
    { title: "4. Comprobante", img: "/guia/comprobante.png", steps: ["Elige el formato de tu impresora (80 mm, 58 mm o A4).", "«Imprimir» o «WhatsApp».", "Si hay que reimprimir después: Comprobantes (Administración). Reimprimir no crea otra venta."] },
    { title: "5. Pedidos de la web", img: "/guia/pedidos.png", steps: ["Cuando suena, mira «Pedidos».", "Si la clienta no pagó: «Cancelar: no pagó» (la prenda vuelve al stock).", "Cuando Administración valida el pago: prepara, cambia a «listo» y luego «entregado/enviado»."] },
    { title: "6. Meter o sacar dinero", img: "/guia/caja-abierta.png", steps: ["Caja → «Entrada» (ej. sencillo) o «Salida» (ej. taxi, bolsas).", "Toca quién lo hace, escribe el monto y el motivo.", "Nunca saques dinero sin registrarlo: si no, el arqueo no cuadra."] },
    { title: "7. Cambio de turno", img: "/guia/cambio-turno.png", steps: ["Caja → «Cambio de turno».", "Toca quién entrega, cuenta el efectivo y escríbelo.", "Escribe cuánto queda para el siguiente turno (si se retira dinero, queda anotado).", "Toca quién recibe la caja → «Hacer cambio de turno»."] },
    { title: "8. Cerrar la caja (al final del día)", img: "/guia/cierre.png", steps: ["Caja → «Cerrar caja» → toca quién cierra.", "Cuenta todo el efectivo (incluido el fondo) y escríbelo.", "Si sobra o falta, escribe el motivo.", "«Cerrar caja» → imprime el informe y guárdalo con el dinero.", "Cierra la sesión."] },
  ] },
  { id: "online", roles: ["vendedora_online", "administrador", "superadmin"], icon: "Smartphone", title: "Vendedora online", items: [
    { title: "Venta por WhatsApp o redes", steps: ["Venta Online → agrega las prendas.", "Datos de la clienta y forma de pago.", "Registrar: el stock se descuenta al instante.", "Pedidos Web: sigue el estado hasta entregado."] },
  ] },
  { id: "almacen", roles: ["almacen", "administrador", "superadmin"], icon: "Package", title: "Almacén", items: [
    { title: "Stock", steps: ["Stock → busca la prenda.", "Para un ingreso de mercadería, merma o corrección: cambia la cantidad y escribe el motivo.", "Queda registrado quién lo hizo y cuándo."] },
  ] },
  { id: "admin", roles: ["administrador", "superadmin"], icon: "ShieldCheck", title: "Dueña / Administración", items: [
    { title: "Productos y fotos", steps: ["Productos → «Nuevo»: nombre, precio, categoría, tallas y colores con su stock.", "Fotos verticales (1080×1440) asignadas a su color; puede ir un video.", "Borrador = no se ve en la web. «Mostrar en la web» para publicar."] },
    { title: "Validar pagos web", steps: ["Pedidos → revisa el N.° de operación con tu Yape/Plin/banco.", "Si llegó: «Validar pago recibido». La clienta suma puntos.", "Pedidos sin pago: se cancelan solos pasadas las horas que pongas arriba (24 por defecto)."] },
    { title: "Caja y arqueos", steps: ["Más → Caja: ve el turno abierto, «¿Quién cobró qué?» y el historial de cierres con sus diferencias.", "Una diferencia que se repite con la misma persona es una señal para revisar."] },
    { title: "Vendedoras y usuarios", steps: ["Más → Vendedores: un código por vendedora (MA01).", "Más → Usuarios: Cajero(a) para quien maneja la caja; Vendedora Tienda solo vende.", "Para quitar acceso: apaga «Acceso activo» (no borres).", "«Reiniciar verificación» solo sirve si alguien perdió el celular del código."] },
    { title: "Anular una venta", steps: ["Más → Comprobantes → la venta → Anular.", "Escribe el motivo. Devuelve stock y puntos y queda registrado."] },
    { title: "Reportes", steps: ["Más → Reportes: por fecha, sede, canal y vendedora. Descarga a Excel."] },
    { title: "Club Fly y promociones", steps: ["Programa de puntos: cuánto se gana y cuánto vale. Interruptor para pausar el club.", "Códigos promocionales (Super Admin): % o monto, solo Club si quieres."] },
    { title: "Configuración", steps: ["Datos de la empresa (RUC, dirección, régimen tributario): salen en el comprobante.", "Envíos: delivery en Trujillo, por departamento y por país.", "Tope de descuento manual de las vendedoras.", "Copia de seguridad (Super Admin): descárgala cada semana."] },
  ] },
  { id: "buenas", roles: null, icon: "Check", title: "Buenas prácticas", items: [
    { title: "Para que todo cuadre", steps: ["Cada vendedora toca su propio nombre: nunca el de otra.", "Todo dinero que entra o sale de la caja se registra con motivo.", "No compartas tu contraseña. Cierra la sesión al irte.", "Si algo no cuadra, avisa el mismo día: es más fácil encontrarlo."] },
  ] },
  { id: "problemas", roles: null, icon: "AlertCircle", title: "Problemas frecuentes", items: [
    { title: "«La caja está cerrada»", steps: ["Hay que abrirla en Caja. Solo Cajero(a) o Administración pueden abrirla."] },
    { title: "«Código no encontrado» / «Toca quién lo hace»", steps: ["Toca tu nombre en la lista. Si no apareces, pide a Administración que cree tu código."] },
    { title: "«Sin stock suficiente»", steps: ["Otra venta o un pedido web se llevó la última unidad. Revisa Stock."] },
    { title: "«El precio cambió»", steps: ["Recarga la página para ver el precio actual."] },
    { title: "La sesión se cerró sola", steps: ["Pasó mucho tiempo sin usar el panel o se cerró la página. Vuelve a entrar: la caja sigue abierta."] },
  ] },
];
const MANUAL_ICONS = { Store, Smartphone, Package, ShieldCheck, Check, AlertCircle };

const StaffManual = ({ role }) => {
  const isAdmin = role === "administrador" || role === "superadmin";
  const mine = MANUAL_SECTIONS.filter((x) => !x.roles || x.roles.includes(role));
  const [openId, setOpenId] = useState(mine[0]?.id);
  return (
    <div style={{ padding: "18px 18px 110px", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ink, fontWeight: 800, margin: "0 0 6px" }}>Manual del equipo</h1>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.stone, marginBottom: 16 }}>{isAdmin ? "Ves todas las funciones. Cada persona ve primero lo suyo." : `Lo que necesitas como ${ROLE_LABELS[role] || role}.`} En cada pantalla también tienes el botón «? Ayuda».</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {mine.map((sec) => {
          const Icon = MANUAL_ICONS[sec.icon] || BookOpen;
          const open = openId === sec.id;
          return (
            <div key={sec.id} style={{ border: `1px solid ${open ? C.ink : C.line}`, borderRadius: 14, overflow: "hidden", background: C.paper }}>
              <button onClick={() => setOpenId(open ? null : sec.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: open ? C.ink : C.paper, color: open ? C.paper : C.ink, border: "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, background: open ? "rgba(255,255,255,0.14)" : C.paperDeep, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={19} /></span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 800, flex: 1 }}>{sec.title}</span>
                <ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
              </button>
              {open && (
                <div style={{ padding: "14px 16px 18px" }}>
                  {sec.intro && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.inkSoft, lineHeight: 1.6, marginBottom: 12, background: C.paperDeep, borderRadius: 10, padding: "10px 12px" }}>{sec.intro}</div>}
                  <div className="manual-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                    {sec.items.map((it) => (
                      <div key={it.title} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 800, color: C.ink }}>{it.title}</div>
                        {it.img && <GuideImage src={it.img} alt={it.title} />}
                        <ol style={{ margin: 0, paddingLeft: 20, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
                          {it.steps.map((st, i) => <li key={i} style={{ marginBottom: 3 }}>{st}</li>)}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---- Qué pantallas puede abrir cada rol (una sola lista para el menú, los enlaces y la flecha atrás) ----
// Si alguien escribe a mano otra dirección (ej. #staff/reports siendo cajero), vuelve a su pantalla de inicio.
// La base de datos además rechaza cualquier dato que su rol no pueda ver o cambiar.
const STAFF_ALL_ROLES = ["superadmin", "administrador", "cajero", "vendedora_tienda", "vendedora_online", "almacen"];
const STAFF_ADMIN = ["superadmin", "administrador"];
const STAFF_STORE_SELLERS = ["superadmin", "administrador", "cajero", "vendedora_tienda"];
const SCREEN_ACCESS = {
  dashboard: STAFF_ADMIN, products: STAFF_ADMIN, productEditor: STAFF_ADMIN, banners: STAFF_ADMIN, bannerEditor: STAFF_ADMIN,
  collections: STAFF_ADMIN, collectionEditor: STAFF_ADMIN, invoices: STAFF_ADMIN, reports: STAFF_ADMIN, more: STAFF_ADMIN,
  complaints: STAFF_ADMIN, sellers: STAFF_ADMIN, purchases: STAFF_ADMIN, docapi: ["superadmin"], fotoscopia: ["superadmin"], activity: STAFF_ADMIN, diagnostico: STAFF_ADMIN, facturacion: STAFF_ADMIN, customers: STAFF_ADMIN, returns: ["superadmin", "administrador", "cajero"], credits: ["superadmin", "administrador", "cajero"], users: ["superadmin"], promocodes: ["superadmin"],
  caja: STAFF_STORE_SELLERS, pos: STAFF_STORE_SELLERS, onlinesales: ["superadmin", "administrador", "vendedora_online"],
  mysales: STAFF_ALL_ROLES, manual: STAFF_ALL_ROLES, stock: STAFF_ALL_ROLES, onlineorders: STAFF_ALL_ROLES,
  transfers: ["superadmin", "administrador", "almacen", "cajero", "vendedora_tienda"],
};
const canOpenScreen = (role, sc) => (SCREEN_ACCESS[sc] || []).includes(role);
// Pantalla con la que se abre el panel según el enlace: #caja → Caja; #staff/<pantalla> → esa pantalla (si su rol puede)
const staffScreenFromHash = (h = (typeof window !== "undefined" ? window.location.hash : "")) => (h === "#caja" ? "caja" : h.startsWith("#staff/") ? decodeURIComponent(h.slice(7)) : null);

const StaffApp = ({ catalog, updateCatalog, patchCatalog, refreshData, role, staffName, staffUsername, currentUserId, reserveNumber, onExit, initialScreen }) => {
  const homeScreen = (role === "administrador" || role === "superadmin") ? "dashboard" : role === "cajero" ? "caja" : role === "vendedora_tienda" ? "pos" : role === "almacen" ? "stock" : "onlinesales";
  // Cada pantalla de venta solo se abre con el rol que corresponde (aunque se cambie la dirección a mano)
  const canSellStore = ["superadmin", "administrador", "cajero", "vendedora_tienda"].includes(role);
  const isAdminRole = role === "administrador" || role === "superadmin";
  const canSellOnline = ["superadmin", "administrador", "vendedora_online"].includes(role);
  const safeScreen = (sc) => (sc && canOpenScreen(role, sc) ? sc : homeScreen);
  const [screen, setScreenState] = useState(() => safeScreen(initialScreen));
  const setScreenRaw = (sc) => setScreenState(safeScreen(sc));
  // Historial dentro del panel: la flecha atrás del navegador vuelve a la pantalla anterior del panel
  const setScreen = (sc0) => { const sc = safeScreen(sc0); setScreenState(sc); try { if (window.location.hash !== `#staff/${sc}`) window.history.pushState({ staff: sc }, "", `#staff/${sc}`); } catch (e) { /* sin historial */ } };
  useEffect(() => {
    try { window.history.replaceState({ staff: screen }, "", `#staff/${screen}`); } catch (e) { /* nada */ }
    const onPop = () => {
      // Atrás/adelante o una dirección escrita a mano (#caja, #staff/stock…): solo pantallas permitidas para su rol
      const target = safeScreen(staffScreenFromHash(window.location.hash));
      setScreenRaw(target);
      if (window.location.hash !== `#staff/${target}`) { try { window.history.replaceState({ staff: target }, "", `#staff/${target}`); } catch (e) { /* nada */ } }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { scrollAllTop(); requestAnimationFrame(() => scrollAllTop()); }, [screen]);
  const [editingProductId, setEditingProductId] = useState(undefined);
  const [returnSale, setReturnSale] = useState(null);
  const [editingBannerId, setEditingBannerId] = useState(undefined);
  const [editingCollectionId, setEditingCollectionId] = useState(undefined);

  // Entradas y salidas suman o restan en el servidor (si otra persona vendió, no se pierde esa venta).
  const registerMovement = async (product, variant, mv) => {
    const args = { p_variant: variant.id, p_type: mv.type, p_qty: mv.qty, p_note: mv.note || null, p_expected: mv.type === "ajuste" ? mv.expected : null };
    let { data, error } = await supabase.rpc("move_stock", mv.location ? { ...args, p_location: mv.location } : args);
    if (error?.code === "PGRST202" && mv.location) ({ data, error } = await supabase.rpc("move_stock", args)); // aún sin el SQL 19
    if (error?.code === "PGRST202") { // aún no se corrió el SQL 14
      ({ error } = await supabase.rpc("adjust_stock", { p_variant: variant.id, p_new_stock: mv.newStock, p_type: mv.type === "devolucion" ? "entrada" : mv.type === "regalo" ? "salida" : mv.type, p_note: mv.note || "" }));
      data = mv.newStock;
    }
    if (error) {
      const m = error.message || "";
      const now = (m.match(/:(\d+)/) || [])[1];
      alert(m.includes("STOCK_CAMBIO") ? `Mientras contabas, el stock cambió (alguien vendió o movió esta prenda). Ahora hay ${now}. Vuelve a contar y registra de nuevo.`
        : m.includes("STOCK_INSUFICIENTE") ? `No alcanza: ahora solo hay ${now} en stock.`
        : m.includes("SIN_PERMISO") ? "Tu usuario no puede mover stock. Pídeselo a un Administrador."
        : "No se pudo guardar el stock: " + m);
      refreshData && refreshData();
      return false;
    }
    const finalStock = Number(data);
    patchCatalog((c) => ({
      ...c,
      products: c.products.map((p) => p.id !== product.id ? p : { ...p, variants: p.variants.map((v) => v.id === variant.id ? { ...v, stock: Number.isFinite(finalStock) ? finalStock : mv.newStock } : v) }),
    }));
    refreshData && refreshData(); // trae cómo quedó cada lugar
    return true;
  };



  const saveCustomer = (cu) => updateCatalog((c) => {
    if (!cu.phone || c.customers.some((x) => x.phone === cu.phone)) return c;
    return { ...c, customers: [...c.customers, { id: genId("cust"), name: cu.name, phone: cu.phone, doc: cu.doc || "", email: cu.email || "", points: 0, createdAt: Date.now(), via: "tienda" }] };
  });
  const saleErrorText = (m) => m.includes("SIN_STOCK") ? `Sin stock suficiente de "${m.split("SIN_STOCK:")[1] || "una prenda"}". Revisa el stock.`
    : m.includes("PRECIO_CAMBIO") ? "El precio de una prenda cambió. Recarga la página e intenta de nuevo."
    : m.includes("PAGO_INCOMPLETO") ? "La suma de los pagos no coincide con el total."
    : m.includes("VALE_SIN_SALDO") ? `El vale no tiene saldo suficiente (le quedan S/ ${m.split("VALE_SIN_SALDO:")[1] || "0"}).`
    : m.includes("VALE_NO_EXISTE") ? "Ese código de vale no existe."
    : m.includes("VALE_VENCIDO") ? `Ese vale venció el ${m.split("VALE_VENCIDO:")[1] || ""}.`
    : m.includes("CAJA_CERRADA") ? "La caja de esta sede está cerrada. Ábrela en Caja para poder vender."
    : m.includes("VENDEDOR_INVALIDO") ? "El código de vendedor no es válido o está desactivado."
    : m.includes("CLUB_DESACTIVADO") ? "El Club Fly está en pausa: no se pueden usar puntos."
    : m.includes("DESCUENTO_EXCEDE") ? `El descuento manual supera el máximo permitido (${(m.split("DESCUENTO_EXCEDE:")[1] || "").trim()}%). Pide a Administración que lo autorice.`
    : m.includes("DESCUENTO_INVALIDO") ? "El descuento no cuadra con el código o los puntos. Vuelve a aplicarlo."
    : m.includes("PROMO_INVALIDA") ? "Ese código promocional ya no está activo."
    : m.includes("PUNTOS_INSUFICIENTES") ? "La clienta no tiene puntos suficientes."
    : m.includes("PUNTOS_INVALIDOS") ? "No se pudieron aplicar los puntos. Quítalos e intenta de nuevo."
    : m.includes("SIN_PERMISO") ? "Tu usuario no tiene permiso para vender. Vuelve a iniciar sesión."
    : "No se pudo registrar la venta. Revisa tu conexión e intenta de nuevo.";
  const completeSale = async (sale) => {
    const { data, error } = await supabase.rpc("pos_sale", { p_sale: sale });
    if (error || !data) { alert(saleErrorText(error?.message || "")); return null; }
    // Reintento de una venta que ya se había guardado: no se vuelve a descontar nada
    if (data.duplicate) { refreshData && refreshData(); return data; }
    // Reflejar al instante en pantalla (sin volver a guardar: ya lo hizo el servidor)
    patchCatalog((c) => ({
      ...c,
      products: c.products.map((p) => ({ ...p, variants: p.variants.map((v) => { const it = data.items.find((i) => i.variantId === v.id); return it ? { ...v, stock: Math.max(0, v.stock - it.qty) } : v; }) })),
      sales: [data, ...c.sales],
    }));
    refreshData && refreshData();
    if (data.earnedPoints > 0) alert(`Venta registrada. ${data.customerName} ganó ${data.earnedPoints} puntos Fly.`);
    return data;
  };

  // Anular y validar se hacen en el servidor: stock, puntos e historial quedan consistentes.
  const missingSql = (e) => e?.code === "PGRST202" ? "Falta correr el archivo 08-fase2a-parches.sql en Supabase." : "";
  const voidSale = async (saleId) => {
    if ((catalog.sales || []).some((x) => x.id === saleId && (x.returns || []).length)) { alert("Esta venta ya tiene devoluciones: usa «Devolución o cambio» para las prendas que faltan."); return; }
    const reason = prompt("Motivo de la anulación (obligatorio). Se devolverá el stock y se generará una nota de crédito interna:");
    if (!reason || !reason.trim()) return;
    const { data, error } = await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason.trim() });
    if (error || !data) { alert("No se pudo anular: " + (missingSql(error) || (error?.message?.includes("SIN_PERMISO") ? "no tienes permiso." : error?.message || ""))); return; }
    patchCatalog((c) => ({ ...c, sales: c.sales.map((s) => (s.id === saleId ? data : s)) }));
    refreshData && refreshData();
  };

  const validateOnlinePayment = async (saleId) => {
    const { data, error } = await supabase.rpc("validate_online_payment", { p_sale_id: saleId });
    if (error || !data) { alert("No se pudo validar el pago: " + (missingSql(error) || (error?.message?.includes("ANULADO") ? "el pedido está anulado." : error?.message || ""))); return; }
    patchCatalog((c) => ({ ...c, sales: c.sales.map((s) => (s.id === saleId ? data : s)) }));
    refreshData && refreshData();
  };

  // Pedido web que no se pagó: se anula y la prenda vuelve al stock (lo hace el servidor)
  const cancelUnpaid = async (saleId, reason) => {
    const { data, error } = await supabase.rpc("cancel_unpaid_order", { p_sale_id: saleId, p_reason: reason || "No pagó" });
    if (error || !data) { alert("No se pudo cancelar: " + (error?.code === "PGRST202" ? "falta correr el archivo 12-pedidos-sin-pago.sql en Supabase." : error?.message?.includes("SOLO_PEDIDOS_SIN_PAGO") ? "este pedido ya está pagado (usa Anular en Comprobantes)." : error?.message || "")); return; }
    patchCatalog((c) => ({ ...c, sales: c.sales.map((x) => (x.id === saleId ? data : x)) }));
    refreshData && refreshData();
  };
  const saveUnpaidHours = (h) => updateCatalog((c) => ({ ...c, settings: { ...c.settings, unpaidOrderHours: h } }));
  const saveCartHold = (m) => updateCatalog((c) => ({ ...c, settings: { ...c.settings, cartHoldMinutes: m } }));
  const savePromo = (record) => updateCatalog((c) => { const exists = c.promoCodes.some((p) => p.id === record.id); return { ...c, promoCodes: exists ? c.promoCodes.map((p) => (p.id === record.id ? record : p)) : [...c.promoCodes, record] }; });
  const deletePromo = (id) => { if (confirm("¿Eliminar este código?")) updateCatalog((c) => ({ ...c, promoCodes: c.promoCodes.filter((p) => p.id !== id) })); };
  const updateFulfillment = async (saleId, fulfillment, tracking = null, agency = null) => {
    const { data, error } = await supabase.rpc("set_order_status", { p_sale_id: saleId, p_fulfillment: fulfillment, p_tracking: tracking, p_agency: agency });
    if (error || !data) { alert("No se pudo actualizar el pedido: " + (error?.message || "")); return; }
    patchCatalog((c) => ({ ...c, sales: c.sales.map((x) => (x.id === saleId ? data : x)) }));
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
  const addThumbs = (made) => updateCatalog((c) => ({
    ...c,
    products: c.products.map((p) => ((p.images || []).some((m) => made[m.url] && !m.thumb) ? { ...p, images: p.images.map((m) => (made[m.url] && !m.thumb ? { ...m, thumb: made[m.url] } : m)) } : p)),
  }));
  const attachBulkImages = (matches) => {
    updateCatalog((c) => ({
      ...c,
      products: c.products.map((p) => {
        const add = matches.filter((m) => m.productId === p.id).map((m) => ({ id: genId("img"), url: m.url, colorName: m.colorName || null, ...(m.type === "video" ? { type: "video" } : {}), ...(m.thumb ? { thumb: m.thumb } : {}) }));
        return add.length ? { ...p, images: [...p.images, ...add] } : p;
      }),
    }));
  };
  const toggleProductActive = (id) => updateCatalog((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, status: p.status === "active" ? "borrador" : "active" } : p)) }));
  const toggleProductFeatured = (id) => updateCatalog((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, featured: !(p.featured !== false) } : p)) }));
  const patchProduct = (id, patch) => updateCatalog((c) => ({ ...c, products: c.products.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) }));
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
      <div className="app-content staff-main" style={{ flex: 1, overflowY: "auto", position: "relative", paddingBottom: 78 }}>
        {screen !== "productEditor" && screen !== "bannerEditor" && screen !== "collectionEditor" && <AdminTopBar title={`Fly · ${ROLE_LABELS[role] || role}`} onExit={onExit} onBack={screen !== homeScreen ? () => window.history.back() : null} onHome={screen !== homeScreen ? () => setScreen(homeScreen) : null} />}
        {screen === "productEditor" && <AdminTopBar title={editingProductId ? "Editar producto" : "Nuevo producto"} onBack={() => setScreen("products")} onExit={onExit} />}
        {screen === "bannerEditor" && <AdminTopBar title={editingBannerId ? "Editar banner" : "Nuevo banner"} onBack={() => setScreen("banners")} onExit={onExit} />}
        {screen === "collectionEditor" && <AdminTopBar title={editingCollectionId ? "Editar colección" : "Nueva colección"} onBack={() => setScreen("collections")} onExit={onExit} />}

        {canSellStore && screen === "pos" && <PosScreen catalog={catalog} staffName={staffName} onCompleteSale={completeSale} onReserveNumber={reserveNumber} onSaveCustomer={saveCustomer} channel="tienda" title="Punto de Venta" role={role} onGoCash={() => setScreen("caja")} />}
        {canSellOnline && screen === "onlinesales" && <PosScreen catalog={catalog} staffName={staffName} onCompleteSale={completeSale} onReserveNumber={reserveNumber} onSaveCustomer={saveCustomer} channel="online" title="Registrar Venta Online" role={role} />}
        {screen === "mysales" && <MySalesScreen sales={catalog.sales} staffName={staffName} />}
        {["superadmin", "administrador", "cajero", "vendedora_tienda"].includes(role) && screen === "caja" && <CashScreen catalog={catalog} role={role} onGoSell={canSellStore ? () => setScreen("pos") : null} onReturns={canOpenScreen(role, "returns") ? () => { setReturnSale(null); setScreen("returns"); } : null} onCredits={canOpenScreen(role, "credits") ? () => setScreen("credits") : null} />}
        {canOpenScreen(role, "credits") && screen === "credits" && <CreditsScreen role={role} settings={catalog.settings} onSaveMonths={STAFF_ADMIN.includes(role) ? (n) => updateCatalog((c) => ({ ...c, settings: { ...c.settings, creditMonths: n } })) : null} />}
        {canOpenScreen(role, "returns") && screen === "returns" && <ReturnsScreen key={returnSale?.id || "nueva"} catalog={catalog} initialSale={returnSale}
          onSaved={(data) => { patchCatalog((c) => ({ ...c, sales: c.sales.some((x) => x.id === data.id) ? c.sales.map((x) => (x.id === data.id ? data : x)) : c.sales })); refreshData && refreshData(); }} />}
        {isAdminRole && screen === "sellers" && <SellersScreen catalog={catalog} />}
        {isAdminRole && screen === "customers" && <CustomersScreen catalog={catalog} refreshData={refreshData} />}
        {screen === "manual" && <StaffManual role={role} />}
        {canOpenScreen(role, "docapi") && screen === "docapi" && <DocApiScreen />}
        {canOpenScreen(role, "fotoscopia") && screen === "fotoscopia" && <PhotoBackupScreen catalog={catalog} />}
        {canOpenScreen(role, "activity") && screen === "activity" && <ActivityScreen />}
        {canOpenScreen(role, "diagnostico") && screen === "diagnostico" && <DiagnosticScreen />}
        {canOpenScreen(role, "facturacion") && screen === "facturacion" && <EInvoiceScreen catalog={catalog} role={role} />}
        {canOpenScreen(role, "purchases") && screen === "purchases" && <PurchasesScreen catalog={catalog} refreshData={refreshData} />}
        {canOpenScreen(role, "transfers") && screen === "transfers" && <TransfersScreen catalog={catalog} role={role} refreshData={refreshData} />}
        {screen === "stock" && <StockScreen catalog={catalog} staffName={staffName} onRegisterMovement={registerMovement} onOpenTransfers={canOpenScreen(role, "transfers") ? () => setScreen("transfers") : null} canEdit={role === "administrador" || role === "superadmin" || role === "almacen"} />}
        {(role === "administrador" || role === "superadmin") && screen === "dashboard" && <AdminDashboard catalog={catalog} updateCatalog={updateCatalog} setAdminScreen={setScreen} role={role} />}
        {(role === "administrador" || role === "superadmin") && screen === "products" && <AdminProductList onPatchProduct={patchProduct} catalog={catalog} openEditor={(id) => { setEditingProductId(id); setScreen("productEditor"); }} deleteProduct={deleteProduct} onImport={importProducts} onBulkPhotos={attachBulkImages} onAddThumbs={addThumbs} onToggleActive={toggleProductActive} onToggleFeatured={toggleProductFeatured} onToggleOnline={toggleProductOnline} onDuplicate={duplicateProduct} />}
        {(role === "administrador" || role === "superadmin") && screen === "productEditor" && <AdminProductEditor product={catalog.products.find((p) => p.id === editingProductId) || null} collections={catalog.collections} allProducts={catalog.products} onSave={saveProduct} onCancel={() => setScreen("products")} />}
        {(role === "administrador" || role === "superadmin") && screen === "banners" && <AdminBannerList banners={catalog.banners} openEditor={(id) => { setEditingBannerId(id); setScreen("bannerEditor"); }} toggleActive={toggleBannerActive} deleteBanner={deleteBanner} />}
        {(role === "administrador" || role === "superadmin") && screen === "bannerEditor" && <AdminBannerEditor banner={catalog.banners.find((b) => b.id === editingBannerId) || null} onSave={saveBanner} onCancel={() => setScreen("banners")} />}
        {(role === "administrador" || role === "superadmin") && screen === "collections" && <AdminCollectionList collections={catalog.collections} openEditor={(id) => { setEditingCollectionId(id); setScreen("collectionEditor"); }} deleteCollection={deleteCollection} />}
        {(role === "administrador" || role === "superadmin") && screen === "collectionEditor" && <AdminCollectionEditor collection={catalog.collections.find((c) => c.id === editingCollectionId) || null} products={catalog.products} onSave={saveCollection} onCancel={() => setScreen("collections")} />}
        {(role === "administrador" || role === "superadmin") && screen === "invoices" && <AdminInvoicesScreen storesSettings={catalog.settings} sales={catalog.sales} onVoid={voidSale} onReturn={(sale) => { setReturnSale(sale); setScreen("returns"); }} />}
        {(role === "administrador" || role === "superadmin") && screen === "reports" && <AdminReportsScreen catalog={catalog} />}
        {(role === "administrador" || role === "superadmin") && screen === "more" && <AdminMoreScreen setScreen={setScreen} role={role} catalog={catalog} />}
        {role === "superadmin" && screen === "users" && <AdminUsersScreen currentUserId={currentUserId} />}
        {(role === "administrador" || role === "superadmin") && screen === "complaints" && <AdminComplaintsScreen staffName={staffName} />}
        {role === "superadmin" && screen === "promocodes" && <AdminPromoCodesScreen promoCodes={catalog.promoCodes} onSave={savePromo} onDelete={deletePromo} />}
        {(role === "administrador" || role === "superadmin" || role === "cajero" || role === "vendedora_tienda" || role === "vendedora_online" || role === "almacen") && screen === "onlineorders" && <OnlineOrdersScreen sales={catalog.sales} onUpdateFulfillment={updateFulfillment} onValidatePayment={validateOnlinePayment} canValidate={role === "administrador" || role === "superadmin"} settings={catalog.settings} onCancelUnpaid={role !== "almacen" ? cancelUnpaid : null} onSaveUnpaidHours={isAdminRole ? saveUnpaidHours : null} onSaveCartHold={isAdminRole ? saveCartHold : null} />}
      </div>
      {screen !== "manual" && <StaffHelp screen={screen} onOpenManual={() => setScreen("manual")} />}
      <AdminNav screen={screen} setScreen={setScreen} role={role} />
    </div>
  );
};

// ---- Privacidad en equipos compartidos ----
// Lo personal de la clienta (favoritos, vistos, Club, direcciones, medidas, búsquedas y la cesta) se borra
// solo tras 1 hora sin usar la tienda, o al cerrar sesión. Así, en un celular prestado o una PC pública,
// la siguiente persona no ve nada de la anterior.
const SHOPPER_IDLE_MINUTES = 60;
const LAST_ACTIVE_KEY = "flyboutique:actividad:v1";
const PERSONAL_KEYS = [WISHLIST_KEY, VIEWED_KEY, CLUB_KEY, SESSION_KEY, CART_KEY, ADDRESSES_KEY, MEASURES_KEY, RECENT_SEARCH_KEY];
const readLastActive = () => { try { return Number(localStorage.getItem(LAST_ACTIVE_KEY)) || 0; } catch (e) { return 0; } };
const markActive = () => { try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch (e) { /* sin guardado */ } };
const shopperIsIdle = () => Date.now() - readLastActive() > SHOPPER_IDLE_MINUTES * 60 * 1000;
const wipePersonalData = () => { PERSONAL_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }); markActive(); };

/* ==================================================================== */
/*  ============================  APP ROOT  ============================*/
/* ==================================================================== */
export default function FlyBoutiqueApp() {
  // Al abrir: si pasó más de 1 hora sin actividad (o es la primera vez con esta versión), se empieza limpio.
  const [startedStale] = useState(() => { const stale = shopperIsIdle(); if (stale) wipePersonalData(); else markActive(); return stale; });
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(false);
  SHOP_SETTINGS = catalog?.settings || {};
  const [screen, setScreen] = useState("home");
  const [activeCategory, setActiveCategory] = useState("Todo");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); return Array.isArray(c) ? c.filter((i) => i && i.cartId && i.productId && i.qty > 0).slice(0, 50) : []; } catch (e) { return []; }
  });
  useEffect(() => { try { if (cart.length) localStorage.setItem(CART_KEY, JSON.stringify(cart)); else localStorage.removeItem(CART_KEY); } catch (e) { /* sin guardado */ } }, [cart]);
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
    let raf = 0;
    const onScroll = () => {
      if (raf) return; // como máximo una vez por cuadro: el deslizar no se traba
      raf = requestAnimationFrame(() => { raf = 0; const y = window.scrollY || content?.scrollTop || 0; setShowBackToTop(y > 500); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    content?.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); content?.removeEventListener("scroll", onScroll); };
  }, [screen]);
  const scrollToTop = () => scrollAllTop(true);
  const [googleProfile, setGoogleProfile] = useState(null);
  const [infoSectionIndex, setInfoSectionIndex] = useState(0);
  useEffect(() => {
    (async () => {
      try { await window.storage.get(COOKIE_CONSENT_KEY, false); }
      catch (e) { setShowCookieConsent(true); /* nunca respondió, se le muestra */ }
    })();
  }, []);
  const [cookieChoice, setCookieChoice] = useState(null);
  useEffect(() => { (async () => { try { const r = await window.storage.get(COOKIE_CONSENT_KEY, false); if (r?.value) setCookieChoice(r.value); } catch (e) { /* sin respuesta aún */ } })(); }, []);
  const resolveCookieConsent = (choice) => {
    setCookieChoice(choice);
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
  // Idioma: solo la tienda cambia; caja y panel siempre en español
  const [lang, setLangState] = useState(getLang());
  const changeLang = (l) => { setLang(l); setLangState(l); track("idioma", { idioma: l }); };
  setStaffMode(mode !== "store");
  useEffect(() => { try { document.documentElement.lang = mode === "store" ? lang : "es"; } catch (e) { /* nada */ } }, [lang, mode]);
  // En el panel del staff, «Agregar a pantalla de inicio» instala otra app: «Fly Staff» (abre directo en el acceso del staff)
  // Si se entró por /caja, se ofrece «Fly Caja» (app aparte que abre directo en la caja).
  useEffect(() => {
    const staff = mode !== "store";
    let caja = false; try { caja = staff && sessionStorage.getItem("fly:app") === "caja"; } catch (e) { /* nada */ }
    const app = caja ? "caja" : staff ? "staff" : "";
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute("href", app ? `/manifest-${app}.webmanifest` : "/manifest.webmanifest");
    const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (title) title.setAttribute("content", caja ? "Fly Caja" : staff ? "Fly Staff" : "Fly");
    const icon = document.querySelector('link[rel="apple-touch-icon"]');
    if (icon) icon.setAttribute("href", app ? `/icons/${app}-apple-touch-icon.png` : "/icons/apple-touch-icon.png");
    // App instalada: se recuerda que es la de staff/caja, así al abrirla vuelve a su pantalla aunque el celular la abra en «/»
    // (ver index.html). Se olvida al tocar «Volver a la tienda».
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone && app) { try { localStorage.setItem("fly:homeApp", app); } catch (e) { /* sin almacenamiento */ } }
  }, [mode]);
  const [session, setSession] = useState(null); // { staffMember } — perfil de staff_profiles
  const sessionRef = useRef(null); sessionRef.current = session;
  const [clubPoints, setClubPoints] = useState(0);
  const isStaffRef = useRef(false);
  const toastTimer = useRef(null);

  useEffect(() => {
    loadInitialCatalog();
    (async () => { try { const res = await window.storage.get(WISHLIST_KEY, false); if (res?.value) setFavs(new Set(JSON.parse(res.value))); } catch (e) { /* no wishlist saved yet */ } })();
    (async () => { try { const res = await window.storage.get(CLUB_KEY, false); if (res?.value) setClubMember(JSON.parse(res.value)); } catch (e) { /* not registered yet */ } })();
    (async () => { try { const res = await window.storage.get(VIEWED_KEY, false); if (res?.value) setViewedIds(JSON.parse(res.value)); } catch (e) { /* sin historial aún */ } })();
  }, []);

  // Catálogo de muestra solo si la tienda todavía no tiene catálogo guardado (instalación nueva).
  // Si falla la conexión se muestra "Reintentar": así nunca se ven ni se guardan productos de muestra.
  async function loadInitialCatalog() {
    setCatalogError(false);
    try { const loaded = await loadCatalog(); setCatalog(loaded || seedCatalog()); }
    catch (e) { console.warn("No se pudo leer el catálogo de Supabase:", e); setCatalogError(true); }
  }

  // Solo el staff guarda en Supabase; lo que hace una clienta va por funciones del servidor.
  const updateCatalog = (updater) => setCatalog((prev) => { const next = updater(prev); if (isStaffRef.current) persistStaffChanges(next, prev); return next; });

  // ---- Panel del staff: se abre solo con la dirección /#staff ----
  useEffect(() => {
    const check = () => { const h = window.location.hash; if (h.startsWith("#staff") || h === "#caja") setMode((m) => (m === "store" ? "staffLogin" : m)); };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const clearStaffHash = () => { try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* sin history */ } };
  // Pedidos web ya conocidos: si llega uno nuevo mientras el panel está abierto, suena
  // y aparece una notificación con lo que hay que preparar.
  const knownOrders = useRef(null);
  const alertNewOrders = (sales) => {
    const web = (sales || []).filter((x) => x.channel === "online" && x.source === "web");
    if (knownOrders.current === null) { knownOrders.current = new Set(web.map((x) => x.id)); return; }
    const fresh = web.filter((x) => !knownOrders.current.has(x.id));
    fresh.forEach((x) => knownOrders.current.add(x.id));
    if (!fresh.length) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((t, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = [880, 1175, 1568][i]; g.gain.setValueAtTime(0.18, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.16); o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.17); });
    } catch (e) { /* sin sonido */ }
    fresh.forEach((x) => {
      const label = `${x.serie}-${String(x.numero).padStart(6, "0")}`;
      const what = (x.items || []).map((i) => `${i.name} (${i.size}/${i.colorName}) x${i.qty}`).join(", ");
      showToast(`Nuevo pedido web ${label}: ${x.customerName || "cliente"}`);
      try { if ("Notification" in window && Notification.permission === "granted") new Notification(`Nuevo pedido ${label} — ${money(x.total)}`, { body: `Preparar: ${what}`, icon: "/icon-192.png", tag: x.id }); } catch (e) { /* sin notificaciones */ }
    });
  };
  const refreshPrivate = async () => {
    try {
      const [priv, pub] = await Promise.all([loadPrivateData(), loadCatalog().catch(() => null)]);
      setCatalog((c) => (c ? { ...c, ...priv, ...(pub ? pickPublic(pub) : {}) } : c));
      alertNewOrders(priv.sales);
    }
    catch (e) { console.warn("No se pudieron cargar los datos privados:", e); }
  };
  const enterStaff = (profile) => {
    isStaffRef.current = true;
    STAFF_CAN_WRITE = profile.role === "superadmin" || profile.role === "administrador";
    knownOrders.current = null;
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) { /* sin notificaciones */ }
    setSession({ staffMember: profile });
    setMode("staff");
    refreshPrivate();
  };
  const exitStaff = async (reason) => {
    isStaffRef.current = false;
    STAFF_CAN_WRITE = false;
    try { await supabase.auth.signOut(); } catch (e) { /* sin conexión */ }
    clearStaffSessionMode();
    setSession(null);
    setCatalog((c) => (c ? { ...c, sales: [], customers: [], stockMovements: [], staff: [] } : c));
    // Vuelve a la pantalla de acceso del staff (para que entre la siguiente persona); desde ahí se puede ir a la tienda
    setMode("staffLogin");
    try { window.history.replaceState(null, "", "#staff"); } catch (e) { /* sin historial */ }
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
      if (Date.now() - last > idleMinutesFor(sessionRef.current?.staffMember?.role) * 60 * 1000) exitStaff("Sesión cerrada por inactividad");
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
  const [selectedColorPref, setSelectedColorPref] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogGroup, setCatalogGroup] = useState(null);
  const [outletCat, setOutletCat] = useState("Todo");
  const [outletQ, setOutletQ] = useState("");
  const goCatalog = (cat = "Todo", group = null, q = "") => { setSelectedProduct(null); setActiveCategory(cat); setCatalogGroup(group || (cat !== "Todo" ? groupOfCategory(cat) : null)); setSearchQuery(q); setScreen("category"); scrollAllTop(); };
  const navigateFromProduct = (target, cat) => { if (target === "home") { setSelectedProduct(null); setScreen("home"); } else goCatalog(cat); scrollAllTop(); };
  const openProduct = (product, colorName = null) => { trackView(product.id); setSelectedColorPref(typeof colorName === "string" ? colorName : null); setSelectedProduct(product); track("view_item", { currency: "PEN", value: product.price, items: [gaItem(product)] }); };
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
      return { ...c, reservations: [...others, { sessionId: cartSessionId, variantId, qty, expiresAt: Date.now() + cartHoldMinutes() * 60 * 1000 }] };
    });
  };
  const clearMyReservations = () => {
    if (cartSessionId) supabase.rpc("clear_reservations", { p_session: cartSessionId });
    setCatalog((c) => ({ ...c, reservations: (c.reservations || []).filter((r) => r.sessionId !== cartSessionId) }));
  };

  const addToCart = (product, size, color, qty) => {
    if (isOutlet(product) && !outletOn(catalog?.settings)) { showToast(t("El Outlet está cerrado por ahora")); return; }
    track("add_to_cart", { currency: "PEN", value: product.price * qty, items: [gaItem(product, { item_variant: `${size} / ${color?.n || ""}`, quantity: qty })] });
    const variant = product.variants.find((v) => v.size === size && v.colorName === color?.n);
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.size === size && i.color?.n === color?.n);
      const newQty = existing ? existing.qty + qty : qty;
      syncReservation(variant?.id, newQty);
      const heldUntil = Date.now() + cartHoldMinutes() * 60 * 1000;
      if (existing) return prev.map((i) => (i.cartId === existing.cartId ? { ...i, qty: newQty, heldUntil } : i));
      return [...prev, { cartId: genId("cart"), heldUntil, outlet: isOutlet(product), productId: product.id, variantId: variant?.id, name: product.name, price: product.price, image: imgThumb(colorPhotos(product, color?.n)[0]) || mainImageUrl(product), size, color, qty }];
    });
    // la ficha queda abierta (es una página): solo se avisa con el mensaje
    showToast(t("Agregado a tu cesta — te lo apartamos {n} minutos", { n: cartHoldMinutes() }));
  };
  const updateQty = (cartId, delta) => setCart((prev) => {
    const next = prev.map((i) => (i.cartId === cartId ? { ...i, qty: Math.max(1, i.qty + delta), heldUntil: Date.now() + cartHoldMinutes() * 60 * 1000 } : i)).filter((i) => i.qty > 0);
    const item = next.find((i) => i.cartId === cartId);
    syncReservation(item?.variantId, item?.qty || 0);
    return next;
  });
  // Volver a apartar (si venció el tiempo): el servidor solo aparta lo que siga libre.
  const renewHold = () => setCart((prev) => prev.map((i) => { syncReservation(i.variantId, i.qty); return { ...i, heldUntil: Date.now() + cartHoldMinutes() * 60 * 1000 }; }));
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
    if (error) { alert(error.message?.includes("FOTO") ? t("La foto es muy pesada. Prueba con otra.") : t("No se pudo publicar tu reseña. Intenta de nuevo.")); return; }
    setCatalog((c) => ({ ...c, reviews: { ...c.reviews, [productId]: [...(c.reviews[productId] || []), data] } }));
    showToast(t("Gracias, tu reseña ya está publicada"));
  };
  const confirmOnlineOrder = async ({ cart: orderCart, subtotal, shipping, discount, promoCode, total, deliveryMethod, deliveryAddress, customerName, customerPhone, paymentMethod, paymentRef, deliveryDetails, pointsUsed = 0, pointsDiscount = 0, clientRequestId = null }) => {
    // Primera revisión rápida en el navegador; la definitiva la hace el servidor (stock y precios reales).
    for (const item of orderCart) {
      const product = catalog.products.find((p) => p.id === item.productId);
      const variant = product?.variants.find((v) => v.id === item.variantId) || product?.variants.find((v) => v.size === item.size && v.colorName === item.color?.n);
      const realStock = variant ? variant.stock : 0;
      if (realStock < item.qty) {
        alert(t("Lo sentimos, «{p}» ({s}/{c}) ya no tiene suficiente stock (quedan {n}). Ajusta la cantidad en tu cesta antes de continuar.", { p: item.name, s: item.size, c: t(item.color?.n), n: realStock }));
        return null;
      }
    }
    const payload = {
      items: orderCart.map((i) => ({ productId: i.productId, variantId: i.variantId || null, name: i.name, size: i.size, colorName: i.color?.n, qty: i.qty, unitPrice: i.price })),
      subtotal, discount, promoCode, shipping, total, paymentMethod, customerName, customerPhone, deliveryMethod, deliveryAddress,
      paymentRef: paymentRef || "", deliveryDetails: deliveryDetails || null,
      pointsUsed: pointsUsed || 0, pointsDiscount: pointsDiscount || 0,
      ...(clientRequestId ? { clientRequestId } : {}),
    };
    // El servidor asigna el número, revisa stock, precios, descuentos y envío, recalcula el total,
    // aparta el stock al instante (nadie más puede comprar esa unidad) y marca el pago como "por validar".
    const { data, error } = await supabase.rpc("place_order", { p_sale: payload, p_session: cartSessionId || "" });
    if (error) {
      const m = error.message || "";
      if (m.includes("OUTLET_CERRADO")) alert(t("«{p}» es del Outlet, que está cerrado por ahora. Quítala de tu cesta para continuar.", { p: m.split("OUTLET_CERRADO:")[1] || t("Una prenda") }));
      else if (m.includes("SIN_STOCK")) alert(t("Lo sentimos, «{p}» ya no tiene stock suficiente. Ajusta tu cesta.", { p: m.split("SIN_STOCK:")[1] || t("una prenda") }));
      else if (m.includes("PRECIO_CAMBIO")) alert(t("El precio de una prenda cambió. Recarga la página para ver el precio actualizado."));
      else if (m.includes("TOTAL_CAMBIO")) alert(t("El total de tu pedido cambió (precio, descuento o envío). Recarga la página e intenta de nuevo."));
      else if (m.includes("PROMO_SOLO_CLUB")) alert(t("Ese código es solo para el Club Fly. Quítalo o regístrate en el Club Fly."));
      else if (m.includes("PROMO_INVALIDA")) alert(t("Ese código promocional ya no está activo. Quítalo e intenta de nuevo."));
      else if (m.includes("CLUB_DESACTIVADO")) alert(t("El Club Fly está en pausa: por ahora no se pueden usar puntos. Desactiva \"usar puntos\" para seguir."));
      else if (m.includes("PUNTOS_SOLO_GOOGLE")) alert(t("Para usar tus puntos en la web, confirma tu cuenta en Club Fly (Google o código al correo). Desactiva \"usar puntos\" para seguir sin ellos."));
      else if (m.includes("PUNTOS")) alert(t("No pudimos aplicar tus puntos (no alcanzan o cambiaron). Desactiva \"usar puntos\" e intenta de nuevo."));
      else alert(t("No se pudo registrar tu pedido. Revisa tu conexión e intenta de nuevo."));
      return null;
    }
    track("purchase", { transaction_id: `${data.serie}-${data.numero}`, currency: "PEN", value: total, shipping, coupon: promoCode || undefined, payment_type: paymentMethod,
      items: orderCart.map((i) => ({ item_id: i.productId, item_name: i.name, item_variant: `${i.size} / ${i.color?.n || ""}`, price: i.price, quantity: i.qty })) });
    setCatalog((c) => ({ ...c, reservations: (c.reservations || []).filter((r) => r.sessionId !== cartSessionId) }));
    setCart([]);
    // Los puntos usados ya se descontaron: se actualiza el saldo en pantalla
    if (pointsUsed > 0 && clubMember?.phone) supabase.rpc("customer_points", { p_phone: clubMember.phone }).then(({ data: pts }) => setClubPoints(Number(pts) || 0)).catch(() => {});
    if (clubMember?.google && !clubMember.phone && customerPhone) {
      const member = { ...clubMember, phone: customerPhone };
      setClubMember(member);
      try { window.storage.set(CLUB_KEY, JSON.stringify(member), false); } catch (e) { /* storage unavailable */ }
    }
    return data;
  };

  const registerClub = async (data) => {
    const args = { p_name: data.name, p_phone: data.phone, p_email: data.email || "", p_captcha: data.captcha || null };
    let { data: c, error } = await supabase.rpc("register_customer", { ...args, p_marketing: !!data.marketing });
    // Si aún no se corrió el SQL 20, se registra como antes (sin guardar el permiso)
    if (error?.code === "PGRST202") ({ data: c, error } = await supabase.rpc("register_customer", args));
    if (error || !c) {
      const m = error?.message || "";
      // El servidor dice por qué falló la verificación (ej. invalid-input-secret): se muestra para poder corregirlo
      const why = m.includes("CAPTCHA_INVALIDO:") ? m.split("CAPTCHA_INVALIDO:")[1].trim() : "";
      alert(m.includes("CAPTCHA") ? `${t("No pudimos confirmar la verificación. Intenta de nuevo.")}${why ? `\n(${t("Código para soporte")}: ${why})` : ""}` : m.includes("CORREO") ? t("Revisa tu correo, no se ve válido.") : t("No se pudo completar el registro. Revisa tus datos e intenta de nuevo."));
      return false;
    }
    const member = { name: c.name, phone: c.phone, email: c.email || "" };
    setClubMember(member);
    setClubPoints(Number(c.points) || 0);
    try { window.storage.set(CLUB_KEY, JSON.stringify(member), false); } catch (e) { /* storage unavailable */ }
    showToast(c.existing ? t("¡Hola de nuevo, {n}!", { n: member.name.split(" ")[0] }) : t("¡Te damos la bienvenida al Club Fly, {n}!", { n: member.name.split(" ")[0] }));
    if (!c.existing) track("sign_up", { method: "formulario" });
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
      if (error) alert(t("No se pudo iniciar con Google: ") + error.message);
    } catch (e) { alert(t("No se pudo iniciar con Google: ") + e.message); }
  };
  // Solo cuenta como "sesión de Google" si de verdad entró con Google. Una sesión del
  // staff (usuario@staff.flyboutique.pe) que quedó abierta en el navegador no se usa aquí.
  const googleUser = (u) => {
    if (!u || String(u.email || "").endsWith("@" + STAFF_EMAIL_DOMAIN)) return null;
    const viaGoogle = u.app_metadata?.provider === "google" || (u.app_metadata?.providers || []).includes("google") || (u.identities || []).some((i) => i.provider === "google");
    const viaCode = u.app_metadata?.provider === "email"; // entró con el código que le llegó al correo (el servidor lo confirma)
    return viaGoogle || viaCode ? { name: u.user_metadata?.full_name || u.user_metadata?.name || "", email: u.email || "", via: viaGoogle ? "google" : "correo" } : null;
  };
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const g = googleUser(data?.session?.user);
      if (g && startedStale) { supabase.auth.signOut({ scope: "local" }).catch(() => {}); return; } // sesión vieja de otra persona
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
    // Si tenía una cuenta solo con datos y ahora confirmó con Google o código, se pasa a la cuenta confirmada.
    if (clubMember?.google && clubMember.email === googleProfile.email && clubMember.phone) return;
    supabase.rpc("register_google_customer").then(({ data: c, error }) => {
      if (error || !c) return; // si falla, queda el formulario normal
      const member = { name: c.name, phone: c.phone || "", email: c.email, google: true };
      const isNew = !clubMember;
      setClubMember(member);
      setClubPoints(Number(c.points) || 0);
      try { window.storage.set(CLUB_KEY, JSON.stringify(member), false); } catch (e) { /* storage unavailable */ }
      if (isNew && !c.existing) track("sign_up", { method: "google" });
      if (isNew) showToast(c.existing ? t("¡Hola de nuevo, {n}!", { n: member.name.split(" ")[0] }) : t("¡Te damos la bienvenida al Club Fly, {n}!", { n: member.name.split(" ")[0] }));
    });
  }, [googleProfile?.email]);

  const redeemReward = async (reward) => {
    if (!clubMember || points < reward.cost) return;
    const { data, error } = await supabase.rpc("redeem_points", { p_phone: clubMember.phone, p_cost: reward.cost });
    if (error) { showToast(t("No tienes puntos suficientes")); return; }
    setClubPoints(Number(data) || 0);
    showToast(t("Canjeaste: {r}", { r: t(reward.n) }));
  };
  // Al cerrar sesión se borra todo lo de esa persona en este equipo (útil en una computadora compartida):
  // vistos, favoritos, cesta, direcciones, medidas y búsquedas.
  const logoutClub = (message = t("Cerraste sesión. Borramos tu actividad de este equipo.")) => {
    if (clubMember?.google || googleProfile) { try { supabase.auth.signOut(); } catch (e) { /* sin conexión */ } setGoogleProfile(null); }
    setClubMember(null);
    if (cart.length) { clearMyReservations(); setCart([]); }
    wipePersonalData();
    const fresh = genId("sess");
    try { localStorage.setItem(SESSION_KEY, fresh); } catch (e) { /* sin guardado */ }
    setCartSessionId(fresh);
    setFavs(new Set()); setViewedIds([]);
    showToast(message);
  };
  // 1 hora sin tocar la tienda → se cierra la sesión de la clienta y se borra su actividad de este equipo.
  const logoutRef = useRef(logoutClub); logoutRef.current = logoutClub;
  const hasPersonalRef = useRef(false); hasPersonalRef.current = !!(clubMember || googleProfile || favs.size || viewedIds.length || cart.length);
  useEffect(() => {
    if (mode !== "store") return undefined;
    let last = 0;
    const touch = () => { const t = Date.now(); if (t - last > 30000) { last = t; markActive(); } };
    const check = () => { if (shopperIsIdle() && hasPersonalRef.current) logoutRef.current(t("Por tu privacidad cerramos tu sesión tras 1 hora sin actividad.")); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, touch, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 60000);
    return () => {
      ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.removeEventListener(ev, touch, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible); clearInterval(timer);
    };
  }, [mode]);

  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.qty, 0), [cart]);

  useEffect(() => {
    if ((cookieChoice === "all" || cookieChoice === "stats") && catalog?.settings && (catalog.settings.gaId || catalog.settings.clarityId)) {
      loadAnalytics({ gaId: (catalog.settings.gaId || "").trim(), clarityId: (catalog.settings.clarityId || "").trim() });
    }
  }, [cookieChoice, catalog?.settings?.gaId, catalog?.settings?.clarityId]);
  const SCREEN_TITLES = { track: "Seguir mi pedido", outlet: "Outlet", complaints: "Libro de Reclamaciones", home: "Inicio", category: "Catálogo", viewed: "Visto", cart: "Cesta", profile: "Cuenta", loyalty: "Club Fly", orders: "Mis pedidos", info: "Información", favorites: "Favoritos", addresses: "Direcciones", payments: "Métodos de pago" };
  // Al cambiar de sección se cierra la ficha abierta y se vuelve arriba
  useEffect(() => { setSelectedProduct(null); scrollAllTop(); requestAnimationFrame(() => scrollAllTop()); }, [screen, infoSectionIndex]);
  useEffect(() => { if (selectedProduct) { scrollAllTop(); requestAnimationFrame(() => scrollAllTop()); } }, [selectedProduct?.id]);
  // ---- Historial del navegador: atrás y adelante funcionan dentro de la tienda ----
  const restoringRef = useRef(false);
  const catalogRef = useRef(null); catalogRef.current = catalog;
  const deepLinkDone = useRef(false);
  // Direcciones normales (sin #) para que Google indexe cada prenda y WhatsApp muestre su foto:
  //   /p/<id> · /catalogo/<categoría>?q=… · /outlet · /cart … Los enlaces viejos con #/ se convierten solos.
  const routePath = () => (selectedProduct ? `/p/${encodeURIComponent(selectedProduct.id)}` : screen === "home" ? "/" : screen === "category" ? `/catalogo${activeCategory !== "Todo" ? "/" + encodeURIComponent(activeCategory) : ""}${searchQuery ? "?q=" + encodeURIComponent(searchQuery) : ""}` : `/${screen}`);
  const currentRoute = () => window.location.pathname + window.location.search;
  useEffect(() => {
    if (mode !== "store" || !catalog || !deepLinkDone.current) return; // primero se respeta el enlace con el que entró
    const h = routePath();
    if (restoringRef.current) { restoringRef.current = false; return; }
    if (currentRoute() === h && !window.location.hash) return;
    try { window.history.pushState(null, "", h); } catch (e) { /* sin historial */ }
  }, [screen, selectedProduct?.id, activeCategory, searchQuery, mode, !!catalog]);
  useEffect(() => {
    const apply = () => {
      if (mode !== "store") return;
      const h = window.location.hash || "";
      let route = currentRoute();
      if (h.startsWith("#/")) { route = h.slice(1) || "/"; try { window.history.replaceState(null, "", route); } catch (e) { /* nada */ } } // enlace viejo con #
      restoringRef.current = true;
      const [path, query] = route.slice(1).split("?");
      const parts = path.split("/").filter(Boolean);
      if (parts[0] === "p" && parts[1]) { const p = catalogRef.current?.products.find((x) => x.id === decodeURIComponent(parts[1])); if (p && webVisible(p)) { setSelectedProduct(p); return; } }
      setSelectedProduct(null);
      if (parts[0] === "catalogo") { setActiveCategory(parts[1] ? decodeURIComponent(parts[1]) : "Todo"); setSearchQuery(query && query.startsWith("q=") ? decodeURIComponent(query.slice(2)) : ""); setScreen("category"); return; }
      setScreen(parts[0] && SCREEN_TITLES[parts[0]] ? parts[0] : "home"); // dirección desconocida → inicio
    };
    window.addEventListener("popstate", apply);
    // enlace directo (compartido por WhatsApp, Google, Instagram…): se abre una sola vez al cargar
    if (catalog && !deepLinkDone.current) { deepLinkDone.current = true; const h0 = window.location.hash || ""; if ((h0.startsWith("#/") && h0 !== "#/") || (window.location.pathname !== "/" && !h0.startsWith("#staff") && h0 !== "#caja")) apply(); else if (h0 === "#/") { try { window.history.replaceState(null, "", "/"); } catch (e) { /* nada */ } } }
    return () => window.removeEventListener("popstate", apply);
  }, [!!catalog, mode]);
  // Título de la pestaña y descripción según lo que se ve (Google también los lee)
  useEffect(() => {
    if (mode !== "store") return;
    const p = selectedProduct;
    document.title = p ? `${pName(p)} · Fly Boutique Perú` : screen === "home" ? t("Fly Boutique Perú · Moda femenina") : screen === "category" && activeCategory !== "Todo" ? `${t(activeCategory)} · Fly Boutique Perú` : `${t(SCREEN_TITLES[screen] || "Tienda")} · Fly Boutique Perú`;
    const m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute("content", p ? (p.description || `${p.name} · S/ ${Number(p.price).toFixed(2)}`).slice(0, 160) : "Fly Boutique Perú: moda femenina elegante. Compra online con envío a todo el Perú o recoge en tienda.");
  }, [mode, screen, selectedProduct?.id, activeCategory, lang]);
  const openInfo = (i) => { setInfoSectionIndex(i); setScreen("info"); };
  useEffect(() => {
    if (mode !== "store") return;
    track("page_view", { page_title: SCREEN_TITLES[screen] || screen, page_location: `${window.location.origin}/${screen === "home" ? "" : screen}` });
    if (screen === "cart" && cart.length) {
      track("begin_checkout", { currency: "PEN", value: cart.reduce((a, i) => a + i.price * i.qty, 0), items: cart.map((i) => ({ item_id: i.productId, item_name: i.name, price: i.price, quantity: i.qty })) });
    }
  }, [screen, mode]);

  // Al salir de la app se pausan los videos; al volver, Safari a veces deja «congelado» el desplazamiento o la pantalla
  // en blanco: se fuerza a redibujar los contenedores que se desplazan (sin perder la posición).
  useEffect(() => {
    const wake = () => {
      document.querySelectorAll(".app-content").forEach((el) => {
        const top = el.scrollTop; el.style.overflowY = "hidden"; void el.offsetHeight; el.style.overflowY = ""; el.scrollTop = top;
      });
      window.dispatchEvent(new Event("resize"));
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") { document.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch (e) { /* nada */ } }); return; }
      requestAnimationFrame(wake);
    };
    const onShow = (e) => { if (e.persisted) requestAnimationFrame(wake); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onShow);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pageshow", onShow); };
  }, []);

  // ---- Instalar la tienda como app en el celular ----
  const [installEvt, setInstallEvt] = useState(null);
  const isStandalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => { setInstallEvt(null); showToast(t("¡Listo! Fly ya está en tu pantalla de inicio")); track("app_instalada"); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  // Al pasar de la tienda al staff cambia el manifiesto: el aviso guardado era de la otra app, se descarta
  // (el navegador vuelve a ofrecer la instalación con el manifiesto nuevo).
  useEffect(() => {
    let caja = false; try { caja = sessionStorage.getItem("fly:app") === "caja"; } catch (e) { /* nada */ }
    const app = mode === "store" ? "" : caja ? "caja" : "staff";
    if (window.__flyBootApp !== undefined && window.__flyBootApp !== app) setInstallEvt(null);
  }, [mode]);
  const staffAppName = () => { try { return sessionStorage.getItem("fly:app") === "caja" ? "Fly Caja" : "Fly Staff"; } catch (e) { return "Fly Staff"; } };
  // Aviso automático de instalación (una vez cada cierto tiempo por app; nunca dentro de la app ya instalada)
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const isAppleTouch = isIOS || isIPad;
  const isIOSSafari = isAppleTouch && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV|TikTok|Line\//i.test(ua);
  const [installSheet, setInstallSheet] = useState(null); // null | "store" | "staff" | "caja"
  const sheetApp = mode === "staffLogin" || mode === "staff" ? (staffAppName() === "Fly Caja" ? "caja" : "staff") : mode === "store" ? "store" : null;
  useEffect(() => {
    if (isStandalone || !catalog || !sheetApp) { setInstallSheet(null); return; }
    const key = `fly:installAsk:${sheetApp}`;
    let last = 0; try { last = Number(localStorage.getItem(key) || 0); } catch (e) { /* nada */ }
    const days = sheetApp === "store" ? 30 : 3;
    if (Date.now() - last < days * 86400000) return;
    const can = !!installEvt || isAppleTouch;
    if (!can) return;
    if (sheetApp === "store") {
      // En la tienda: solo en celular, después de mirar un rato (no al llegar) y sin tapar la compra
      const coarse = window.matchMedia?.("(pointer: coarse)").matches;
      if (!coarse || showCookieConsent || selectedProduct || !["home", "category", "outlet"].includes(screen)) return;
      const tm = setTimeout(() => setInstallSheet("store"), 40000);
      return () => clearTimeout(tm);
    }
    const tm = setTimeout(() => setInstallSheet(sheetApp), 900);
    return () => clearTimeout(tm);
  }, [sheetApp, installEvt, catalog, showCookieConsent, selectedProduct, screen]);
  const closeInstallSheet = () => { try { localStorage.setItem(`fly:installAsk:${installSheet}`, String(Date.now())); } catch (e) { /* nada */ } setInstallSheet(null); };
  const [installHint] = useState(() => { try { const h = sessionStorage.getItem("fly:installHint"); sessionStorage.removeItem("fly:installHint"); return !!h; } catch (e) { return false; } });
  const installStaffApp = async () => {
    const name = staffAppName();
    // Si la página se cargó como tienda (se entró al staff sin recargar), el celular instalaría con la dirección de la tienda:
    // se recarga en /staff o /caja y se vuelve a tocar «Instalar».
    const key = name === "Fly Caja" ? "caja" : "staff";
    if (window.__flyBootApp !== undefined && window.__flyBootApp !== key) { try { sessionStorage.setItem("fly:installHint", "1"); } catch (e) { /* nada */ } window.location.assign(`/${key}`); return; }
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* cancelado */ } setInstallEvt(null); return; }
    if (isIOS) alert(`Para instalar «${name}» en el iPhone:\n\n1. Abre flyboutique.vercel.app/${key} en Safari.\n2. Toca Compartir (el cuadrado con flecha hacia arriba).\n3. Elige «Agregar a pantalla de inicio» y toca «Agregar».`);
    else alert(`Para instalar «${name}»:\n\n1. Abre flyboutique.vercel.app/${key} en Chrome.\n2. Toca los tres puntitos (arriba a la derecha).\n3. Elige «Instalar app» o «Agregar a pantalla de inicio».`);
  };
  const installApp = async () => {
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* cancelado */ } setInstallEvt(null); return; }
    if (isIOS) alert(t("Para instalar Fly en tu iPhone:\n\n1. Toca el botón Compartir (el cuadrado con flecha hacia arriba, abajo en Safari).\n2. Elige \"Agregar a pantalla de inicio\".\n3. Toca \"Agregar\"."));
    else alert(t("Para instalar Fly: abre el menú del navegador (los tres puntitos) y elige \"Instalar app\" o \"Agregar a pantalla de inicio\"."));
  };

  // Sin "marco de teléfono": la app ocupa toda la pantalla desde el primer instante. Antes el marco negro (y el
  // fondo gris) se veía un momento al abrir la app instalada, hasta que el celular terminaba de medir la pantalla.
  const frameStyle = { width: "100%", background: C.paper, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" };

  return (
    <div className="app-page" style={{ width: "100%", minHeight: "100vh", background: C.paper, display: "flex", justifyContent: "center", boxSizing: "border-box", fontFamily: FONT_BODY }}>
      <style>{`
        /* Las fuentes se cargan en index.html (<link>): un @import aquí hacía que Safari no aplicara NINGÚN estilo de este bloque hasta descargarlas */
        * { box-sizing: border-box; }
        html, body { height: 100%; overflow: hidden; margin: 0; }
        #root { height: 100%; }
        .app-content::-webkit-scrollbar, .hscroll::-webkit-scrollbar { display: none; }
        .app-content { scrollbar-width: none; }
        /* Alto real de la pantalla: en iPhone 100vh es más alto que lo visible (la barra de Safari) y la página podía quedar descuadrada al volver */
        .app-frame { height: 100vh; height: 100dvh; }
        /* Las tarjetas que no se ven no se dibujan: menos memoria en celulares (evita que Safari deje la página en blanco) */
        .product-grid > *, .pos-tiles > * { content-visibility: auto; contain-intrinsic-size: auto 340px; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .install-sheet > div { animation: sheetUp .35s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes sheetUp { from { transform: translateY(110%); opacity: 0; } }
        .install-arrow { animation: arrowBob 1.1s ease-in-out infinite; }
        @keyframes arrowBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
        @media (prefers-reduced-motion: reduce) { .install-sheet > div, .install-arrow { animation: none; } }
        /* Fotos y videos: brillo gris mientras cargan, aparición suave al llegar */
        @keyframes shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
        @keyframes imgIn { from { opacity: 0; } }
        .fimg:not(.is-loaded), .fvid:not(.is-loaded) { background: linear-gradient(100deg, ${C.paperDeep} 30%, ${C.line} 50%, ${C.paperDeep} 70%) !important; background-size: 200% 100% !important; animation: shimmer 1.4s linear infinite; }
        .fimg.is-loaded { animation: imgIn .45s ease; }
        .fvid.is-loaded video { animation: imgIn .6s ease; }
        /* Portada: acercamiento lento del banner visible (efecto «Ken Burns») y botón que late suave */
        @keyframes heroZoom { from { transform: scale(1); } to { transform: scale(1.06); } }
        .hero-zoom { animation: heroZoom 7s ease-out forwards; }
        @keyframes ctaGlow { 0%, 70%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); } 80% { box-shadow: 0 0 0 0 rgba(255,255,255,.55); } 95% { box-shadow: 0 0 0 10px rgba(255,255,255,0); } }
        .cta-glow { animation: ctaGlow 3.2s ease-out 1.2s 3; }
        /* Botón listo para comprar: un destello que lo recorre y un latido suave */
        @keyframes btnShine { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(260%) skewX(-20deg); } }
        @keyframes btnPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
        .btn-ready { position: relative; overflow: hidden; animation: btnPulse .55s ease 2; }
        .btn-ready::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: btnShine 1.1s ease .15s 1 both; pointer-events: none; }
        /* Falta la talla: las tallas palpitan para mostrar dónde tocar */
        @keyframes nudge { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-5px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
        @keyframes ring { 0% { box-shadow: 0 0 0 0 ${C.ink}55; } 100% { box-shadow: 0 0 0 9px ${C.ink}00; } }
        .size-nudge { animation: nudge .5s ease; }
        .size-nudge > button:not(:disabled) { animation: ring .9s ease-out 2; }
        /* Inicio: las secciones aparecen subiendo al bajar, y sus prendas entran una tras otra */
        @media (prefers-reduced-motion: no-preference) {
          .reveal { opacity: 0; transform: translateY(26px); transition: opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1); }
          .reveal.is-in { opacity: 1; transform: none; }
          .reveal.is-in .pcard { animation: cardIn .6s cubic-bezier(.2,.7,.2,1) both; }
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `.reveal.is-in .pcard:nth-child(${i}) { animation-delay: ${(i - 1) * 70}ms; }`).join(" ")}
        }
        @keyframes cardIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        /* Favorito: el corazón late; regalo del anuncio que se mueve; flecha que invita a tocar */
        @keyframes heartPop { 0% { transform: scale(1); } 30% { transform: scale(1.45); } 60% { transform: scale(.9); } 100% { transform: scale(1); } }
        .heart-pop { animation: heartPop .45s ease; }
        @keyframes wiggle { 0%, 84%, 100% { transform: rotate(0); } 88% { transform: rotate(-12deg); } 92% { transform: rotate(10deg); } 96% { transform: rotate(-6deg); } }
        .gift-wiggle { animation: wiggle 2.6s ease .6s 3; }
        @keyframes nudgeX { 0%, 70%, 100% { transform: translateX(0); } 85% { transform: translateX(5px); } }
        .nudge-x { animation: nudgeX 2.4s ease 4; }
        /* Más (panel): tarjetas con ícono que entran una tras otra y responden al tocar */
        .dash-tile { animation: cardIn .45s cubic-bezier(.2,.7,.2,1) both; transition: transform .15s ease, box-shadow .2s ease; }
        .dash-tile:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,.07); }
        .more-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
        /* Texto largo dentro de ventanas: justificado (como la página de información) */
        .sheet-panel p, .cookie-text,
        :is(.sheet-panel, .fold-body, .help-panel) :is([style*="line-height: 1.5"], [style*="line-height: 1.6"], [style*="line-height: 1.7"], [style*="line-height: 1.8"]):not([style*="text-align"]):not(:has(input, button, select, textarea)) { text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
        .fold-chev { transition: transform .25s ease; flex-shrink: 0; }
        .fold-card.is-open .fold-chev { transform: rotate(180deg); }
        .fold-body { animation: groupIn .28s ease both; }
        @media (prefers-reduced-motion: reduce) { .fold-body { animation: none; } .fold-chev { transition: none; } }
        .more-group { border: 1px solid ${C.line}; border-radius: 14px; margin-bottom: 10px; background: ${C.paper}; overflow: hidden; }
        .more-group.is-open { border-color: ${C.ink}; }
        .more-group-btn { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px; background: none; border: none; cursor: pointer; min-height: 60px; }
        .more-group-ico { width: 36px; height: 36px; border-radius: 10px; background: ${C.paperDeep}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .more-group.is-open .more-group-ico { background: ${C.ink}; }
        .more-group.is-open .more-group-ico svg { color: ${C.paper}; stroke: ${C.paper}; }
        .more-group-chev { transition: transform .25s ease; flex-shrink: 0; }
        .more-group.is-open .more-group-chev { transform: rotate(180deg); }
        .more-group-body { padding: 0 12px 12px; animation: groupIn .28s ease both; }
        @keyframes groupIn { from { opacity: 0; transform: translateY(-6px); } }
        @media (prefers-reduced-motion: reduce) { .more-group-body { animation: none; } .more-group-chev { transition: none; } }
        @media (min-width: 760px) { .more-grid { grid-template-columns: 1fr 1fr; } }
        .more-head { font-family: ${FONT_BODY}; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: ${C.stone}; margin: 0 0 8px; }
        .more-tile { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid ${C.line}; background: ${C.paper}; cursor: pointer; animation: cardIn .45s cubic-bezier(.2,.7,.2,1) both; transition: transform .15s ease, box-shadow .2s ease, border-color .2s ease; }
        .more-tile:hover { border-color: ${C.ink}; box-shadow: 0 6px 18px rgba(0,0,0,.08); transform: translateY(-1px); }
        .more-tile:hover .more-chev { transform: translateX(3px); }
        .more-chev { transition: transform .2s ease; flex-shrink: 0; }
        .more-ico { position: relative; width: 42px; height: 42px; border-radius: 12px; background: ${C.ink}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform .2s ease; }
        .more-tile:hover .more-ico, .more-tile:active .more-ico { transform: rotate(-6deg) scale(1.06); }
        .more-badge { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: ${C.accent}; color: #fff; font-family: ${FONT_BODY}; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; animation: bump .5s ease 2; }
        .more-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 999px; border: 1px solid ${C.line}; background: ${C.paperDeep}; font-family: ${FONT_BODY}; font-size: 12.5px; color: ${C.ink}; cursor: pointer; }
        /* Caja: tarjeta negra del turno, pasos para abrir y grupos de botones */
        .cash-hero { background: ${C.ink}; color: ${C.paper}; border-radius: 16px; padding: 16px 18px; margin-bottom: 12px; animation: cardIn .45s ease both; }
        @keyframes livePulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.7); } 100% { box-shadow: 0 0 0 9px rgba(255,255,255,0); } }
        .cash-live { width: 9px; height: 9px; border-radius: 50%; background: #fff; animation: livePulse 1.6s ease-out infinite; flex-shrink: 0; }
        .cash-pill { font-family: ${FONT_BODY}; font-size: 12px; padding: 6px 10px; border-radius: 999px; background: rgba(255,255,255,.12); }
        .cash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .cash-step { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid ${C.line}; }
        .cash-step-n { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid ${C.ink}; display: flex; align-items: center; justify-content: center; font-family: ${FONT_BODY}; font-size: 13px; font-weight: 700; color: ${C.ink}; flex-shrink: 0; transition: background .25s ease, color .25s ease; }
        .cash-step.is-done .cash-step-n { background: ${C.ink}; color: ${C.paper}; animation: bump .4s ease; }
        /* Caja: botones grandes que entran uno tras otro; «Vender» late suave para guiar */
        .big-action { animation: cardIn .45s cubic-bezier(.2,.7,.2,1) both; transition: transform .15s ease, box-shadow .2s ease; }
        .big-action:nth-child(2) { animation-delay: 40ms; } .big-action:nth-child(3) { animation-delay: 80ms; } .big-action:nth-child(4) { animation-delay: 120ms; }
        .big-action:nth-child(5) { animation-delay: 160ms; } .big-action:nth-child(6) { animation-delay: 200ms; } .big-action:nth-child(7) { animation-delay: 240ms; }
        .big-action:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,.10); }
        .big-ico { transition: transform .2s ease; }
        .big-action:hover .big-ico, .big-action:active .big-ico { transform: rotate(-6deg) scale(1.08); }
        @keyframes mainGlow { 0%, 70%, 100% { box-shadow: 0 0 0 0 rgba(17,17,17,0); } 85% { box-shadow: 0 0 0 7px rgba(17,17,17,.12); } }
        .big-main { animation: cardIn .45s cubic-bezier(.2,.7,.2,1) both, mainGlow 3s ease 1s 3; }
        /* Cesta: el número salta cuando se añade algo */
        @keyframes bump { 0% { transform: scale(1); } 35% { transform: scale(1.5); } 100% { transform: scale(1); } }
        .badge-bump { animation: bump .45s ease; }
        /* Las tarjetas fuera de pantalla no se dibujan hasta acercarse: inicio y catálogo más fluidos en equipos antiguos */
        .admin-topbar .tb-short { display: none; }
        @media (max-width: 420px) { .admin-topbar .tb-label { display: none; } .admin-topbar .tb-short { display: inline; } .admin-topbar button[aria-label] { padding: 8px 10px !important; } }
        .pcard { content-visibility: auto; contain-intrinsic-block-size: auto 460px; }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }
        @media print { @page { margin: 8mm; } body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; } .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; } }
        @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes popIn { from { transform: scale(.97); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes galleryIn { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: scale(1); } }
        @keyframes slideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes toastIn { from { transform: translate(-50%, -10px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        button { font-family: inherit; }
        /* Pantallas táctiles (caja en PC táctil, tablet o celular): sin retraso ni zoom por doble toque, sin selección de texto al tocar */
        button, a, [role="button"], select, label { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
        button { -webkit-user-select: none; user-select: none; transition: transform .12s ease, opacity .12s ease; }
        button:active:not(:disabled) { transform: scale(.96); }
        /* Caja: mientras hay prendas en la venta, el botón Ayuda se oculta para no tapar «Cobrar»; en celular es solo «?» */
        body:has(.pos-busy) .staff-help-btn { display: none !important; }
        @media (max-width: 899px) { .staff-help-btn .help-label { display: none; } .staff-help-btn { padding: 9px !important; } }
        .tap-round { width: 36px; height: 36px; border-radius: 50%; border: 1px solid ${C.line}; background: ${C.paper}; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; color: ${C.ink}; flex-shrink: 0; }
        .tap-round.tap-plain { border-color: transparent; background: transparent; }
        @media (pointer: coarse), (any-pointer: coarse) {
          /* También en PC con pantalla táctil (aunque tenga mouse). En iPhone/iPad, letra de 16 px en los campos: así no se agranda la pantalla al tocar uno */
          input, select, textarea { font-size: 16px !important; }
          .tap-round { width: 42px; height: 42px; }
        }
        input:focus, button:focus-visible, select:focus, textarea:focus { outline: 2px solid ${C.ink}; outline-offset: 2px; }

        /* ---------- Celular: la app ocupa TODA la pantalla ---------- */
        /* En celular y tablet. Antes se dibujaba un "marco de teléfono" dentro del propio teléfono (con bordes
           negros y fondo gris), por eso se veía pequeña y cuadrada. */
        @media (max-width: 899px) {
          .app-page { padding: 0 !important; background: ${C.paper} !important; }
          .app-frame { max-width: none !important; height: 100vh !important; height: 100dvh !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
          .pdp-slide { max-height: 76vh; }
        }
        @media (min-width: 600px) and (max-width: 899px) {
          .overlay-sheet { justify-content: center !important; align-items: center !important; }
          .sheet-panel { width: 560px; max-width: 92vw; border-radius: 16px !important; max-height: 86vh !important; }
          .cookie-box { padding: 22px 32px calc(22px + env(safe-area-inset-bottom)) !important; }
          .cookie-box .cookie-title { font-size: 17px !important; }
          .cookie-box .cookie-text { font-size: 13.5px !important; }
          .cookie-box .cookie-rt { font-size: 13.5px !important; }
          .cookie-box .cookie-rd { font-size: 12.5px !important; }
          .cookie-box .cookie-btn { font-size: 13.5px !important; padding: 14px !important; }
          .product-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        .back-top { bottom: 92px !important; }
        .pdp-thumbs { display: none; }
        .app-nav .nav-only-desktop { display: none !important; }
        .app-nav .nav-lang { display: none !important; }
        .page-narrow { width: 100%; }
        @media (max-width: 899px) {
          .pdp-crumb-name { display: none; }
          .pdp-open .app-nav { display: none !important; }
          .pdp-open .app-content { padding-bottom: 0 !important; }
          .viewer-body { flex-direction: column-reverse; }
          .viewer-thumbs { flex-direction: row !important; width: 100% !important; overflow-x: auto; }
        }
        .pdp-arrow { display: none !important; }
        .help-panel { max-height: 94vh !important; }
        @media (min-width: 700px) { .help-steps { grid-template-columns: 1fr 1fr !important; } .manual-grid { grid-template-columns: 1fr 1fr !important; } }
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
          html { overflow-x: hidden !important; overflow-y: auto !important; }
          body { overflow: visible !important; }
          .app-page { overflow-x: clip; }
          .app-nav .nav-drop-wrap { flex: none !important; }
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
            background: ${C.paper} !important; border-top: none !important; border-bottom: none !important;
            justify-content: flex-start !important; gap: 6px !important; padding: 10px 20px !important;
          }
          .app-nav::before { content: ""; position: absolute; top: 0; bottom: 0; left: -100vmax; right: -100vmax; background: ${C.paper}; border-bottom: 1px solid ${C.line}; z-index: -1; }
          .app-nav .nav-brand { display: flex !important; margin-right: 22px; transition: transform .2s ease; }
          .app-nav .nav-item.nav-only-mobile { display: none !important; }
          .app-nav .nav-item.nav-only-desktop { display: flex !important; }
          .app-nav .nav-lang { display: flex !important; margin-left: 8px; }
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
            justify-content: flex-start !important; gap: 6px !important; padding: 12px max(20px, calc((100% - 1100px) / 2 + 20px)) !important;
          }
          .staff-nav .nav-item { flex-direction: row !important; flex: none !important; gap: 8px !important; padding: 10px 14px !important; border-radius: 999px !important; }
          .staff-nav .nav-item:hover, .staff-nav .nav-item.is-active { background: ${C.paperDeep} !important; }
          .staff-nav .nav-label { font-size: 13px !important; }
          .admin-topbar { position: static !important; margin: 16px max(20px, calc((100% - 1100px) / 2 + 20px)) 0; border-radius: 12px; }
          /* Pantallas del staff centradas en PC (antes quedaban pegadas a la izquierda) */
          .staff-main > div:not(.admin-topbar):not(.overlay-sheet):not([style*="position: fixed"]) { max-width: 1100px; margin-left: auto !important; margin-right: auto !important; }
          .pos-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
          .pos-right { position: sticky; top: 76px; border: 1px solid ${C.line}; border-radius: 14px; padding: 14px; background: ${C.paper}; max-height: calc(100vh - 100px); overflow-y: auto; }
          .pos-tiles { grid-template-columns: repeat(4, 1fr) !important; }
          .report-cards { grid-template-columns: repeat(4, 1fr) !important; }
          .nuevos-row { display: grid !important; grid-template-columns: repeat(4, 1fr); overflow: visible !important; }
          .nuevos-row > div { width: auto !important; }
          .checkout-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 36px; align-items: start; }
          .checkout-right { position: sticky; top: 70px; }
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
          /* Ficha de producto en PC: página propia (como Zalando) */
          .pdp-topbar { top: 113px !important; }
          /* Foto y datos juntos y centrados (como Zalando): la columna de fotos mide lo que mide la foto */
          .pdp-wrap { display: grid !important; grid-template-columns: auto minmax(340px, 480px); justify-content: center; gap: 56px; padding: 18px 28px 40px; align-items: start; max-width: 1320px !important; }
          .pdp-info { padding: 0 !important; }
          .pdp-gal.has-thumbs { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 12px; }
          .pdp-gal .pdp-thumbs { display: flex !important; flex-direction: column; order: -1; margin-top: 0 !important; max-height: calc(100vh - 230px); overflow-y: auto; flex-wrap: nowrap !important; }
          .pdp-gal .pdp-thumbs button { width: 72px !important; height: 92px !important; flex-shrink: 0; }
          /* Foto vertical 3:4 (como Zalando). Antes tomaba el alto de la pantalla y en laptop quedaba casi cuadrada */
          .pdp-slide { aspect-ratio: 3 / 4 !important; height: auto !important; border-radius: 12px; }
          .pdp-gallery .pdp-gal-main, .pdp-gallery > .pdp-slide { width: clamp(340px, min(calc((100vh - 190px) * 0.75), calc(100vw - 620px)), 640px); }
          .pdp-buybar { display: none !important; }
          .pdp-inline-buy { display: block !important; }
          .pdp-arrow { display: flex !important; }

          /* Menú: resumen de Cuenta y Cesta al pasar el mouse */
          .nav-drop-wrap.nav-drop-closed .nav-dropdown { display: none !important; }
          .nav-drop-wrap:not(.nav-drop-closed):hover .nav-dropdown {
            display: block !important; position: absolute; top: 100%; right: 0; z-index: 60; margin-top: 8px;
            background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 14px; box-shadow: 0 16px 40px rgba(0,0,0,0.14);
            animation: fadeIn .15s ease;
          }
          .nav-drop-wrap:hover .nav-dropdown::before { content: ""; position: absolute; left: 0; right: 0; top: -12px; height: 12px; }
          .nav-drop-link:hover { text-decoration: underline; }
          /* Buscador: se abre como panel encima de la página */
          .search-scrim { background: rgba(0,0,0,0.35) !important; }
          .search-panel { flex: none !important; width: min(760px, 92vw); margin: 96px auto 0; max-height: calc(100vh - 140px); border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.25); }
          .search-grid { grid-template-columns: repeat(6, 1fr) !important; }
          /* Aviso de cookies en PC: franja a lo ancho de la página (con sus márgenes), texto a la izquierda y botones a la derecha */
          .cookie-box { left: max(32px, calc((100vw - 1240px) / 2)) !important; right: max(32px, calc((100vw - 1240px) / 2)) !important; bottom: 24px !important; width: auto; border-radius: 18px; padding: 24px 32px !important;
            box-shadow: 0 24px 60px rgba(0,0,0,0.28); display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 40px; align-items: center; }
          .cookie-box .cookie-main { grid-column: 1; grid-row: 1; }
          .cookie-box .cookie-btns { grid-column: 2; grid-row: 1; flex-wrap: nowrap !important; }
          .cookie-box .cookie-config { grid-column: 1 / -1; grid-row: 2; margin: 14px 0 0 !important; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 28px; }
          .cookie-box .cookie-config > div { border-top: 1px solid rgba(255,255,255,0.12); }
          .cookie-box .cookie-title { font-size: 19px !important; margin-bottom: 8px !important; }
          .cookie-box .cookie-title svg { width: 20px; height: 20px; }
          .cookie-box .cookie-text { font-size: 14.5px !important; line-height: 1.6 !important; margin-bottom: 0 !important; }
          .cookie-box .cookie-rt { font-size: 14.5px !important; }
          .cookie-box .cookie-rd { font-size: 13px !important; }
          .cookie-box .cookie-btn { font-size: 14px !important; padding: 14px 22px !important; flex: none !important; white-space: nowrap; }
          .install-card { display: none !important; }
          .page-narrow { max-width: 760px; margin: 0 auto; }
        }
      `}</style>

      <div className={`app-frame${mode === "store" && selectedProduct ? " pdp-open" : ""}`} style={frameStyle}>
        {!catalog ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, background: C.paper }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 52, fontWeight: 900, color: C.ink, letterSpacing: "0.04em" }}>FLY</div>
            {catalogError ? (
              <>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.stone, textAlign: "center", maxWidth: 260 }}>{t("No pudimos cargar la tienda. Revisa tu conexión e intenta de nuevo.")}</div>
                <button onClick={loadInitialCatalog} style={{ padding: "11px 22px", borderRadius: 9, border: "none", background: C.ink, color: C.paper, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("Reintentar")}</button>
              </>
            ) : (
              <div className="spin" style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.line}`, borderTopColor: C.ink }} />
            )}
          </div>
        ) : mode === "staffLogin" ? (
          <>
          <StaffAccess onDone={enterStaff} onCancel={() => { try { localStorage.removeItem("fly:homeApp"); } catch (e) { /* nada */ } setMode("store"); clearStaffHash(); }} installName={isStandalone ? null : staffAppName()} onInstall={installStaffApp} installHint={installHint} />
            {installSheet && installSheet !== "store" && <InstallSheet app={installSheet} canPrompt={!!installEvt} ios={isAppleTouch} iosSafari={isIOSSafari} ipad={isIPad} onInstall={() => { closeInstallSheet(); installStaffApp(); }} onClose={closeInstallSheet} />}
          </>
        ) : mode === "staff" && session ? (
          <>
          <StaffApp catalog={catalog} updateCatalog={updateCatalog} patchCatalog={setCatalog} refreshData={refreshPrivate} role={session.staffMember.role} staffName={session.staffMember.name} staffUsername={session.staffMember.username}
            currentUserId={session.staffMember.user_id} reserveNumber={reserveNumber} onExit={() => exitStaff("Sesión cerrada")} initialScreen={staffScreenFromHash()} />
          {installSheet && installSheet !== "store" && <InstallSheet app={installSheet} canPrompt={!!installEvt} ios={isAppleTouch} iosSafari={isIOSSafari} ipad={isIPad} onInstall={() => { closeInstallSheet(); installStaffApp(); }} onClose={closeInstallSheet} />}
          </>
        ) : (
          <>
            <div className="app-content" style={{ flex: 1, overflowY: "auto", position: "relative", paddingBottom: 78 }}>
              <Header lang={lang} onLang={changeLang} onSearch={() => setSearchOpen(true)} onHome={() => { setSelectedProduct(null); setScreen("home"); scrollAllTop(true); }} />
              {selectedProduct && <ProductSheet product={selectedProduct} initialColor={selectedColorPref} onClose={() => { if (window.history.length > 1) window.history.back(); else setSelectedProduct(null); }} onAdd={addToCart} fav={favs.has(selectedProduct.id)} onToggleFav={toggleFav}
                reviews={catalog.reviews} onAddReview={addReview} collections={catalog.collections} allProducts={catalog.products} onOpenProduct={openProduct} catalog={catalog} cartSessionId={cartSessionId} onNavigate={navigateFromProduct} favs={favs} />}
              {!selectedProduct && <>
              {screen === "home" && <HomeScreen catalog={catalog} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} setScreen={setScreen} setActiveCategory={setActiveCategory} points={points} notifyMe={() => showToast(t("Te avisaremos primero ✓"))} viewedIds={viewedIds} onQuickAdd={addToCart} cartSessionId={cartSessionId} onOpenInfo={(i) => { setInfoSectionIndex(i); setScreen("info"); }} />}
              {screen === "home" && !selectedProduct && !clubMember && clubOn(catalog?.settings) && <ClubInvite onJoin={() => setScreen("loyalty")} />}
              {screen === "info" && <InfoScreen sectionIndex={infoSectionIndex} setScreen={setScreen} />}
              {screen === "outlet" && <CategoryScreen key="outlet" outlet catalog={catalog} activeCategory={outletCat} setActiveCategory={setOutletCat} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} onQuickAdd={addToCart} cartSessionId={cartSessionId} searchQuery={outletQ} setSearchQuery={setOutletQ} group={null} setGroup={() => {}} />}
              {screen === "category" && <CategoryScreen onOutlet={outletOn(catalog.settings) && catalog.products.some((p) => p.showOnline !== false && isOutlet(p) && !productSoldOut(p)) ? () => setScreen("outlet") : null} catalog={catalog} activeCategory={activeCategory} setActiveCategory={setActiveCategory} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} onQuickAdd={addToCart} cartSessionId={cartSessionId} searchQuery={searchQuery} setSearchQuery={setSearchQuery} group={catalogGroup} setGroup={setCatalogGroup} />}
              {screen === "viewed" && <ViewedScreen catalog={catalog} viewedIds={viewedIds} onOpen={openProduct} favs={favs} onToggleFav={toggleFav} onQuickAdd={addToCart} cartSessionId={cartSessionId} onRemoveViewed={removeFromViewed} setScreen={setScreen} />}
              {screen === "cart" && <CartScreen cart={cart} onRenewHold={renewHold} updateQty={updateQty} removeItem={removeItem} setScreen={setScreen} culqiPublicKey={catalog.settings?.culqiPublicKey} payAccounts={catalog.settings}
                promoCodes={catalog.promoCodes} clubMember={clubMember} onConfirmOrder={confirmOnlineOrder} points={points} />}
              {screen === "loyalty" && <LoyaltyScreen points={points} onRedeem={redeemReward} clubMember={clubMember} onRegister={registerClub} onLogoutClub={() => logoutClub()} onGoogleSignIn={signInWithGoogle} googlePrefill={googleProfile} turnstileSiteKey={(catalog.settings?.turnstileSiteKey || "").trim() || TURNSTILE_SITE_KEY} settings={catalog.settings} />}
              {screen === "profile" && <ProfileScreen points={points} favCount={favs.size} clubMember={clubMember} onLogoutClub={() => logoutClub()} setScreen={setScreen} catalog={catalog} showInstall={!isStandalone} onInstall={installApp} onCookiePrefs={() => setShowCookieConsent(true)} />}
              {screen === "orders" && <OrdersScreen catalog={catalog} clubMember={clubMember} setScreen={setScreen} />}
              {screen === "favorites" && <FavoritesScreen catalog={catalog} favs={favs} onOpen={openProduct} onToggleFav={toggleFav} onQuickAdd={addToCart} cartSessionId={cartSessionId} setScreen={setScreen} />}
              {screen === "addresses" && <AddressesScreen setScreen={setScreen} />}
              {screen === "payments" && <PaymentMethodsScreen setScreen={setScreen} />}
              {screen === "complaints" && <ComplaintsScreen settings={catalog.settings} setScreen={setScreen} />}
              {screen === "track" && <TrackOrderScreen settings={catalog.settings} setScreen={setScreen} />}
              </>}
              {screen === "home" && !selectedProduct && <InfoFooter socials={catalog.settings?.socials} onOpenInfo={openInfo} onCookiePrefs={() => setShowCookieConsent(true)} onComplaints={() => setScreen("complaints")} onTrack={() => setScreen("track")} />}
            </div>
            <div className="app-ticker" style={{ display: "none" }}><Marquee /></div>
            <BottomNav lang={lang} onLang={changeLang} favCount={favs.size} screen={selectedProduct ? "" : screen} setScreen={(sc) => { setSelectedProduct(null); if (sc === "category") goCatalog(); else setScreen(sc); }} cartCount={cartCount} onSearch={() => setSearchOpen(true)} cart={cart} clubMember={clubMember} points={points} onLogoutClub={() => logoutClub()}
              hasOutlet={outletOn(catalog.settings) && catalog.products.some((p) => p.showOnline !== false && isOutlet(p))} products={catalog.products.filter((p) => p.showOnline !== false && !isOutlet(p))} onOpenProduct={openProduct} onSearchQuery={(q) => goCatalog("Todo", null, q)} onCategory={(cat, group) => goCatalog(cat, group)} />
            {searchOpen && <SearchOverlay products={catalog.products.filter((p) => p.showOnline !== false && !isOutlet(p))} onClose={() => setSearchOpen(false)} onOpenProduct={(p) => { openProduct(p); setSearchOpen(false); }} onSearchAll={(term) => goCatalog(CATEGORY_OPTIONS.includes(term) ? term : "Todo", null, CATEGORY_OPTIONS.includes(term) ? "" : term)} />}
            {toast && <Toast message={toast} />}
            {installSheet === "store" && <InstallSheet app="store" tr={t} canPrompt={!!installEvt} ios={isAppleTouch} iosSafari={isIOSSafari} ipad={isIPad} onInstall={() => { closeInstallSheet(); installApp(); }} onClose={closeInstallSheet} />}
            {showCookieConsent && <CookieConsent current={cookieChoice} onSave={resolveCookieConsent} onOpenPolicy={() => { setShowCookieConsent(false); openInfo(FOOTER_SECTIONS.findIndex((x) => x.title.startsWith("Seguridad"))); }} />}
            {showBackToTop && (
              <button className="back-top" onClick={scrollToTop} aria-label={t("Volver arriba")} style={{ position: "fixed", bottom: 28, right: 28, zIndex: 55, width: 44, height: 44, borderRadius: "50%", background: C.ink, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(0,0,0,0.25)" }}>
                <ChevronUp size={20} color={C.white} />
              </button>
            )}
          </>
        )}
        <UpdateBanner staff={mode !== "store"} />
      </div>
    </div>
  );
}
