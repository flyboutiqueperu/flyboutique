import "./storage-shim.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
// Atajos fáciles de escribir: /staff y /caja abren el panel (mismo que /#staff y /#caja)
{
  const m = window.location.pathname.toLowerCase().replace(/\/+$/, "").match(/^\/(staff|caja)(\/[a-z]+)?$/);
  if (m) window.history.replaceState(null, "", m[1] === "caja" ? "/#caja" : `/#staff${m[2] || ""}`);
}
// Si se publicó una versión nueva mientras la app estaba abierta, algunos archivos viejos ya no existen:
// se recarga una sola vez para traer la versión nueva (en vez de quedarse con una pantalla rota).
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("fly:recargado") || 0);
    if (Date.now() - last > 60000) { e.preventDefault(); sessionStorage.setItem("fly:recargado", String(Date.now())); window.location.reload(); }
  } catch (err) { /* sin almacenamiento: no se recarga */ }
});
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
// Permite instalar la tienda como app (Android / iPhone / PC). No guarda copias: siempre carga lo último.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
