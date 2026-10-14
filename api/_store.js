// Utilidades del servidor (Vercel): lee el catálogo PÚBLICO de Supabase con la llave pública (la misma que usa la web).
export const SITE_NAME = "Fly Boutique Perú";
export async function loadPublicCatalog() {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/store_data?id=eq.main&select=data`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.data || null;
}
// Prendas que se pueden ver en la web (mismas reglas que la tienda)
export const webProducts = (data) => (data?.products || []).filter((p) => p && p.status === "active" && p.showOnline !== false && (!p.outlet || data?.settings?.outletEnabled !== false));
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const originOf = (req) => `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
