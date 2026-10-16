import "./storage-shim.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
// Atajos fáciles de escribir: /staff y /caja abren el panel (mismo que /#staff y /#caja)
{
  const m = window.location.pathname.toLowerCase().replace(/\/+$/, "").match(/^\/(staff|caja)(\/[a-z]+)?$/);
  if (m) window.history.replaceState(null, "", m[1] === "caja" ? "/#caja" : `/#staff${m[2] || ""}`);
  // Dos apps instalables: la tienda «Fly» y «Fly Staff» (caja y panel: cada usuario ve lo que su rol permite).
  // /caja abre la misma app «Fly Staff» directo en la caja. Antes existía «Fly Caja» aparte: ya no se ofrece.
  try {
    const h = window.location.hash;
    sessionStorage.removeItem("fly:app");
    if (h === "#caja" || h.startsWith("#staff")) {
      document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/manifest-staff.webmanifest");
      document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", "Fly Staff");
      document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", "/icons/staff-apple-touch-icon.png");
    }
  } catch (e) { /* sin almacenamiento: se usa el manifiesto normal */ }
}
// Si se publicó una versión nueva mientras la app estaba abierta, algunos archivos viejos ya no existen:
// se recarga una sola vez para traer la versión nueva (en vez de quedarse con una pantalla rota).
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("fly:recargado") || 0);
    if (Date.now() - last > 60000) { e.preventDefault(); sessionStorage.setItem("fly:recargado", String(Date.now())); window.location.reload(); }
  } catch (err) { /* sin almacenamiento: no se recarga */ }
});
// Diagnóstico del equipo (Más → Diagnóstico del equipo): guarda aquí, en este equipo, los últimos problemas
// (errores, ratos en que la página se trabó, recargas forzadas de Safari por falta de memoria). No se envía a ningún lado.
const DIAG_KEY = "fly:diagnostico";
const flyLog = (tipo, detalle) => {
  try {
    const list = JSON.parse(localStorage.getItem(DIAG_KEY) || "[]");
    list.unshift({ at: Date.now(), tipo, detalle: String(detalle || "").slice(0, 300), ruta: location.pathname + location.hash });
    localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(0, 30)));
  } catch (e) { /* sin almacenamiento */ }
};
window.__flyLog = flyLog;
window.addEventListener("error", (e) => flyLog("error", `${e.message || e.error || "error"} ${e.filename ? `(${String(e.filename).split("/").pop()}:${e.lineno})` : ""}`));
window.addEventListener("unhandledrejection", (e) => flyLog("error", `Promesa: ${e.reason?.message || e.reason || ""}`));
try {
  // Si la pestaña se cerró sin salir normalmente (Safari la descargó por memoria), se anota al volver a abrir
  if (sessionStorage.getItem("fly:abierta") === "1") flyLog("recarga", "El navegador volvió a cargar la página sola (posible falta de memoria o se cerró en segundo plano)");
  sessionStorage.setItem("fly:abierta", "1");
  window.addEventListener("pagehide", () => { try { sessionStorage.removeItem("fly:abierta"); } catch (e) { /* nada */ } });
  window.addEventListener("pageshow", () => { try { sessionStorage.setItem("fly:abierta", "1"); } catch (e) { /* nada */ } });
} catch (e) { /* sin almacenamiento */ }
// Detector de «se trabó»: si con la página a la vista pasan más de 4 s sin que el reloj avance, se anota
{
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (document.visibilityState === "visible" && now - last > 4000) flyLog("trabada", `La página no respondió durante ${Math.round((now - last) / 1000)} s`);
    last = now;
  }, 1000);
  document.addEventListener("visibilitychange", () => { last = Date.now(); });
}
// Red de seguridad: si una pantalla falla, se muestra un aviso con «Volver a intentar» en vez de quedar en blanco.
// «Volver a intentar» no recarga la página, así la cesta y lo escrito se conservan.
class Guard extends React.Component {
  constructor(props) { super(props); this.state = { err: null, n: 0 }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Fly: error de pantalla", err, info?.componentStack); flyLog("pantalla", `${err?.message || err} ${String(info?.componentStack || "").split("\n").slice(1, 3).join(" ").trim()}`); }
  render() {
    if (!this.state.err) return <React.Fragment key={this.state.n}>{this.props.children}</React.Fragment>;
    const en = document.documentElement.lang === "en";
    const btn = { padding: "13px 20px", borderRadius: 9, fontFamily: "Jost, sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" };
    return (
      <div role="alert" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center", fontFamily: "Jost, sans-serif", background: "#fff", color: "#111" }}>
        <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 900, fontSize: 30 }}>FLY</div>
        <div style={{ fontSize: 16, maxWidth: 340 }}>{en ? "Something didn't load properly." : "Algo no cargó bien."}</div>
        <button onClick={() => this.setState((s) => ({ err: null, n: s.n + 1 }))} style={{ ...btn, background: "#111", color: "#fff", border: "none" }}>{en ? "Try again" : "Volver a intentar"}</button>
        <button onClick={() => window.location.reload()} style={{ ...btn, background: "transparent", color: "#111", border: "1px solid #111" }}>{en ? "Reload page" : "Recargar la página"}</button>
      </div>
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Guard><App /></Guard></React.StrictMode>
);
// Permite instalar la tienda como app (Android / iPhone / PC). No guarda copias: siempre carga lo último.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
