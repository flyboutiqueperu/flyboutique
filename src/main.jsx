import "./storage-shim.js";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
// Permite instalar la tienda como app (Android / iPhone / PC). No guarda copias: siempre carga lo último.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
