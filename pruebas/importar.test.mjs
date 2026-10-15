// Prueba del lector del Excel de TumiSoft. Uso: node pruebas/importar.test.mjs
import { parseTumiSoft, splitName, matchPhoto, isTumiSoft } from "../src/importar-tumisoft.js";
const H = ["#", "NOMBRE", "PRECIO DE VENTA", "PRECIO DE COSTO", "UND. MEDIDA", "C. INTERNO", "C. BARRAS", "ACTUALIZACIÓN", "ESTADO", "GRUPO DE UM", "CATEGORIAS", "LISTA 0"];
const rows = [
  [1, "90S LOW RISE JEANS AZUL 34", 149, 0, "NIU", "90LRJA34", "90LRJA340003691366", "19/Sep/2026 08:13:25", "Activo", "", "PANTALONES", 149],
  [2, "90S LOW RISE JEANS CELESTE 28", 149, 0, "NIU", "9LRJC28", "9LRJC280003690856", "", "Activo", "", "PANTALONES", 149],
  [3, "90S LOW RISE JEANS CELESTE 30", 149, 0, "NIU", "9LRJC30", "9LRJC300003690857", "", "Activo", "", "PANTALONES", 149],
  [6, "90S LOW RISE JEANS GRIS 34", 149, 0, "NIU", "LRJEG34", "LRJEG3480003690403", "", "Activo", "", "PANTALONES", 149],
  [7, "90S LOW RISE JEANS IVORY 34", 149, 0, "NIU", "9SLRI34", "9SLRI340003691744", "", "Activo", "", "PANTALONES", 149],
  [13, "ACCESORIO GRIEGA BRAZO", 20, 0, "NIU", "ACGRIDO", "ACGRIDO003691984", "", "Activo", "", "ACCESORIOS", 20],
  [15, "ACTIVE TOP BEIGE M", 45, 0, "NIU", "ACTOBEM", "ACTOBEM000036219", "", "Activo", "", "TEEN LIFE", 45],
  [16, "ACTIVE TOP BEIGE S", 45, 0, "NIU", "ACTOBES", "ACTOBES000036217", "", "Activo", "", "TEEN LIFE", 45],
  [18, "ACTIVE TOP NEGRO M", 45, 0, "NIU", "ACTONEM", "ACTONEM000036218", "", "Activo", "", "TEEN LIFE", 45],
  [20, "ADHESIVE PADS BEIGE A", 39, 0, "NIU", "ADPABEA", "ADPABEA000367120", "", "Activo", "", "TEEN LIFE", 39],
  [23, "ALDANA DRESS NEGRO M", 149, 0, "NIU", "ALDRNEM", "ALDRNEMO03692231", "", "Activo", "", "VESTIDOS", 149],
  [25, "ALDANA DRESS PERLA L", 149, 0, "NIU", "ALDRPEL", "ALDRPELO03692238", "", "Activo", "", "VESTIDOS", 149],
  [27, "ALDANA DRESS VINO M", 149, 0, "NIU", "ALDRVIM", "ALDRVIMO03692234", "", "Activo", "", "VESTIDOS", 149],
  [28, "ALMIRA TOP ACERO STANDARD", 59, 0, "NIU", "AMTOACT", "AMTOACT2924379", "", "Activo", "", "TOPS", 59],
  [33, "ALMIRA TOP TOPO STANDARD", 59, 0, "NIU", "ALTOTPT", "ALTOTPT2924452", "", "Activo", "", "TOPS", 59],
  [35, "ALMOND CROISSANT LIP GLOSS VS", 65, 0, "NIU", "ALCROVS", "ALCROVS03692332", "", "Activo", "", "ACCESORIOS", 65],
  [36, "ALYSA TOP BURGUNDY M", "71,2", 0, "NIU", "ALTOBUM", "ALTOBUM000369162", "", "Activo", "", "TOPS", "71,2"],
  [39, "AMIRA DRESS NEGRO STANDARD", 139, 0, "NIU", "AMDRNET", "AMDRNETO03692268", "", "Activo", "", "VESTIDOS", 139],
].map((r) => Object.fromEntries(H.map((h, i) => [h, r[i]])));
let ok = true; const check = (t, v) => { console.log(v ? "OK " : "FALLA", t); if (!v) ok = false; };
check("reconoce el formato TumiSoft", isTumiSoft(H));
check("separa «90S LOW RISE JEANS AZUL 34»", JSON.stringify(splitName("90S LOW RISE JEANS AZUL 34")) === JSON.stringify({ base: "90S LOW RISE JEANS", color: "AZUL", size: "34" }));
check("separa «ALMIRA TOP ACERO STANDARD» (talla única)", JSON.stringify(splitName("ALMIRA TOP ACERO STANDARD")) === JSON.stringify({ base: "ALMIRA TOP", color: "ACERO", size: "Única" }));
check("sin color ni talla: «ACCESORIO GRIEGA BRAZO»", JSON.stringify(splitName("ACCESORIO GRIEGA BRAZO")) === JSON.stringify({ base: "ACCESORIO GRIEGA BRAZO", color: null, size: null }));
let n = 0; const genId = (p) => `${p}_${++n}`;
const r = parseTumiSoft(rows, [], { genId });
const names = r.products.map((p) => p.name);
console.log("  prendas:", names.join(" | "));
check("agrupa en prendas (no una por fila)", r.products.length === 9);
const jeans = r.products.find((p) => p.name === "90S Low Rise Jeans");
check("jeans: 5 combinaciones con colores Azul/Celeste/Gris/Ivory y tallas", jeans && jeans.variants.length === 5 && ["Azul", "Celeste", "Gris", "Ivory"].every((c) => jeans.variants.some((v) => v.colorName === c)));
check("guarda código interno (sku) y de barras", jeans.variants[0].sku === "90LRJA34" && jeans.variants[0].barcode === "90LRJA340003691366");
check("precio con coma 71,2 → 71.2", r.products.find((p) => p.name === "Alysa Top").price === 71.2);
check("categorías mapeadas", r.products.find((p) => p.name === "Aldana Dress").category === "Vestidos" && r.products.find((p) => p.name === "Active Top").category === "Teen Life");
check("tono de color para Negro", r.products.find((p) => p.name === "Aldana Dress").variants.find((v) => v.colorName === "Negro").colorHex === "#111111");
check("stock 0 en combinaciones nuevas (el stock se carga aparte)", r.products.every((p) => p.variants.every((v) => v.stock === 0)));
// Segunda importación: actualiza en vez de duplicar, conserva stock y fotos
jeans.variants[0].stock = 7; jeans.images = [{ id: "i1", url: "x.jpg", colorName: "Azul" }];
const r2 = parseTumiSoft(rows.map((x) => (x.NOMBRE === "90S LOW RISE JEANS AZUL 34" ? { ...x, "PRECIO DE VENTA": 159 } : x)), r.products, { genId });
const j2 = r2.products.find((p) => p.slug === jeans.slug);
check("re-importar: no duplica y conserva id, stock y fotos", r2.products.length === 9 && j2.id === jeans.id && j2.variants[0].stock === 7 && j2.images.length === 1 && r2.summary.actualizadas === 9 && r2.summary.nuevas === 0);
// Archivo de stock: código + stock
const r3 = parseTumiSoft([{ NOMBRE: "90S LOW RISE JEANS AZUL 34", "C. INTERNO": "90LRJA34", STOCK: 12 }], r.products, { genId });
check("archivo con columna STOCK actualiza el stock de esa combinación", r3.products[0].variants.find((v) => v.sku === "90LRJA34").stock === 12 && r3.summary.conStock === 1);
// Fotos
const ps = r.products;
const f = (name) => { const m = matchPhoto(name, ps); return m ? `${m.product.name}|${m.colorName}|${m.order}` : "—"; };
check("foto por código interno «9LRJC28.jpg» → Jeans Celeste", f("9LRJC28.jpg") === "90S Low Rise Jeans|Celeste|0");
check("foto por código con orden «9LRJC28-2.jpg»", f("9LRJC28-2.jpg") === "90S Low Rise Jeans|Celeste|2");
check("foto por código de barras", f("ALDRNEMO03692231.jpg") === "Aldana Dress|Negro|0");
check("foto por nombre y color «ALDANA DRESS PERLA 1.jpg»", f("ALDANA DRESS PERLA 1.jpg") === "Aldana Dress|Perla|1");
check("foto por nombre, color y talla «Aldana Dress Vino M (3).jpeg»", f("Aldana Dress Vino M 3.jpeg") === "Aldana Dress|Vino|3");
check("foto sin coincidencia", f("foto-cualquiera.jpg") === "—");
console.log(ok ? "TODO OK" : "HAY FALLAS"); process.exit(ok ? 0 : 1);
