// Prueba del módulo de copia de fotos (sin navegador). Uso: node pruebas/fotos-copia.test.mjs
import http from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import { collectMedia, downloadMediaBackup } from "../src/fotos-copia.js";
const srv = http.createServer((q, r) => {
  if (q.url.includes("roto")) { r.writeHead(404); return r.end(); }
  const kb = Number((q.url.match(/kb=(\d+)/) || [])[1] || 10);
  r.writeHead(200, { "content-type": q.url.includes(".mp4") ? "video/mp4" : "image/jpeg" }); r.end(Buffer.alloc(kb * 1024, 7));
}).listen(4370);
const U = (n, kb) => `http://localhost:4370/${n}?kb=${kb}`;
const catalog = {
  products: [
    { id: "p1", name: "Vestido Lino Ñandú", images: [{ url: U("a.jpg", 300), thumb: U("a-mini.jpg", 5) }, { url: U("b.jpg", 300), colorName: "Rojo" }, { url: U("c.mp4", 400), type: "video" }] },
    { id: "p2", name: "Blusa Seda", images: [{ url: U("a.jpg", 300) }, { url: U("roto.jpg", 1) }] },
  ],
  banners: [{ id: "b1", title: "Nueva colección", image: U("ban.png", 200), videoUrl: U("ban.mp4", 500) }],
  collections: [{ id: "c1", name: "Oficina", cover: U("cov.webp", 50) }, { id: "c2", name: "Sin foto", cover: "" }],
};
const items = collectMedia(catalog);
console.log("1) Archivos a guardar (sin repetidos ni miniaturas):", items.length, "→", items.map((i) => i.path).join(" | "));
const parts = []; const progress = [];
const r = await downloadMediaBackup(catalog, { partBytes: 700 * 1024, save: async (blob, name) => parts.push({ name, buf: new Uint8Array(await blob.arrayBuffer()) }), onProgress: (p) => progress.push(p.done) });
await new Promise((ok) => setTimeout(ok, 300));
console.log("2) Resultado:", JSON.stringify({ total: r.total, done: r.done, failed: r.failed, parts: r.parts, MB: (r.bytes / 1048576).toFixed(2) }));
let files = 0, indice = null;
for (const p of parts) { const z = unzipSync(p.buf); const names = Object.keys(z); files += names.filter((n) => !/LEEME|indice/.test(n)).length; console.log(`   ${p.name}: ${(p.buf.length / 1024).toFixed(0)} KB →`, names.join(", ")); if (z["indice.csv"]) indice = strFromU8(z["indice.csv"]); }
console.log("3) Partes de máx ~700 KB:", parts.length, "| archivos dentro:", files, "| el video de 500 KB entra completo:", parts.some((p) => Object.keys(unzipSync(p.buf)).some((n) => n.includes("banners/b1") && n.endsWith(".mp4"))));
console.log("4) Índice (solo en la última parte):", indice ? indice.split("\n").length - 1 + " filas" : "FALTA", "| foto compartida anotada en Blusa Seda:", /Blusa Seda.*misma foto/.test(indice || ""), "| foto rota anotada:", /NO SE PUDO DESCARGAR: HTTP 404/.test(indice || ""), "| tildes y ñ limpias en carpeta:", /productos\/Vestido-Lino-Nandu__p1\//.test(indice || ""));
console.log("5) Avance llega al total:", progress[progress.length - 1] === items.length);
const ac = new AbortController(); setTimeout(() => ac.abort(), 5);
try { await downloadMediaBackup(catalog, { signal: ac.signal, save: () => {} }); console.log("6) Cancelar: FALLO (no se canceló)"); } catch (e) { console.log("6) Cancelar detiene la copia:", e.name === "AbortError"); }
srv.close();
