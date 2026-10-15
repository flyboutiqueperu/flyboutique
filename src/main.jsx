import "./storage-shim.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
// Atajos fáciles de escribir: /staff y /caja abren el panel (mismo que /#staff y /#caja)
{
  const m = window.location.pathname.toLowerCase().replace(/\/+$/, "").match(/^\/(staff|caja)(\/[a-z]+)?$/);
  if (m) window.history.replaceState(null, "", m[1] === "caja" ? "/#caja" : `/#staff${m[2] || ""}`);
  // Tres apps instalables: la tienda «Fly», «Fly Staff» (panel) y «Fly Caja» (solo caja). Se elige el manifiesto
  // antes de dibujar la página, así «Instalar app» desde /caja instala «Fly Caja» y desde /staff instala «Fly Staff».
  try {
    const h = window.location.hash;
    if (h === "#caja") sessionStorage.setItem("fly:app", "caja");
    else if (h.startsWith("#staff")) sessionStorage.removeItem("fly:app");
    const app = sessionStorage.getItem("fly:app") === "caja" && (h === "#caja" || h.startsWith("#staff")) ? "caja" : h === "#caja" || h.startsWith("#staff") ? "staff" : null;
    if (app) {
      document.querySelector('link[rel="manifest"]')?.setAttribute("href", `/manifest-${app}.webmanifest`);
      document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", app === "caja" ? "Fly Caja" : "Fly Staff");
      document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", `/icons/${app}-apple-touch-icon.png`);
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
// Red de seguridad: si una pantalla falla, se muestra un aviso con «Volver a intentar» en vez de quedar en blanco.
// «Volver a intentar» no recarga la página, así la cesta y lo escrito se conservan.
class Guard extends React.Component {
  constructor(props) { super(props); this.state = { err: null, n: 0 }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Fly: error de pantalla", err, info?.componentStack); }
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
