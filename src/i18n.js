// Idioma de la tienda (ES / EN). Solo la parte de clientes: caja y panel del staff quedan en español.
// t("Texto en español") devuelve el texto en inglés si está traducido; si no, deja el español (nunca queda vacío).
// Variables: t("Te faltan {n} puntos", { n: 20 }).
import EN, { COLOR_WORDS_EN, COLOR_MODS_EN } from "./i18n-en.js";

const LANG_KEY = "flyboutique:idioma:v1";
let lang = "es";
try {
  const saved = localStorage.getItem(LANG_KEY);
  lang = saved === "en" || saved === "es" ? saved : (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "es";
} catch (e) { /* sin almacenamiento: español */ }

const missing = new Set();
// En el panel del staff y la caja todo queda en español, aunque el celular esté en inglés
let staffMode = false;
export const setStaffMode = (on) => { staffMode = !!on; };
export const getLang = () => (staffMode ? "es" : lang);
export const setLang = (l) => {
  lang = l === "en" ? "en" : "es";
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* nada */ }
  try { document.documentElement.lang = lang; } catch (e) { /* nada */ }
};
// Nombres de color que no están en el diccionario: se traducen palabra por palabra solo si todas son colores
// («Azul Claro» → «Light Blue», «Verde Oliva» → «Olive Green», «Rosa Palo» → «Dusty Pink»). Los nombres ya en inglés quedan igual.
const colorEn = (s) => {
  if (typeof s !== "string" || s.length > 40) return null;
  const words = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().split(/[\s/-]+/).filter(Boolean);
  if (!words.length || words.length > 4) return null;
  const mods = [], cols = [];
  for (const w of words) {
    if (COLOR_MODS_EN[w]) mods.push(COLOR_MODS_EN[w]);
    else if (COLOR_WORDS_EN[w]) cols.push(COLOR_WORDS_EN[w]);
    else return null;
  }
  if (!cols.length) return null;
  return [...mods, ...cols.reverse()].join(" ");
};
export const t = (s, vars) => {
  if (s == null) return s;
  let out = s;
  if (lang === "en" && !staffMode) {
    if (EN[s] != null) out = EN[s];
    else if (colorEn(s)) out = colorEn(s);
    else if (!missing.has(s)) { missing.add(s); if (import.meta.env && import.meta.env.DEV) console.warn("[i18n] falta traducción:", s); }
  }
  if (vars) out = String(out).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
};
// Para pruebas: lista de textos sin traducir vistos en pantalla
if (typeof window !== "undefined") window.__flyMissingEN = missing;
