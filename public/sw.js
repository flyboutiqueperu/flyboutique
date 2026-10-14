// Fly Boutique — service worker mínimo: permite instalar la web como app en el celular.
// No guarda copias de la tienda (así siempre se ve la versión más reciente, precios y stock reales).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* todo va directo a internet */ });
