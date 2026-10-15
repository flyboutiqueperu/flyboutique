// Copia de seguridad de las FOTOS y VIDEOS (la copia JSON del panel no los incluye).
// Junta todo lo que usa el catálogo (productos, banners, colecciones), lo descarga y arma uno o varios ZIP
// (partes de ~300 MB para que el celular o la PC no se queden sin memoria), con un índice para saber a qué producto va cada archivo.
import { Zip, ZipPassThrough, strToU8 } from "fflate";

const safe = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "sin-nombre";
const extOf = (url, type) => {
  const m = String(url || "").split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  if (/png/.test(type)) return "png"; if (/webp/.test(type)) return "webp"; if (/mp4/.test(type)) return "mp4"; if (/gif/.test(type)) return "gif";
  return "jpg";
};
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Lista de archivos a guardar (sin repetidos). Las miniaturas no se guardan: se vuelven a crear con «Optimizar fotos».
export const collectMedia = (catalog) => {
  const out = []; const seen = new Map();
  // Si dos productos usan la misma foto se descarga una vez, pero el índice la anota para ambos
  const add = (url, path, info) => {
    if (!url || typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    if (seen.has(url)) { seen.get(url).also.push(info); return; }
    const it = { url, path, ...info, also: [] }; seen.set(url, it); out.push(it);
  };
  (catalog?.products || []).forEach((p) => {
    const dir = `productos/${safe(p.name)}__${safe(p.id)}`;
    (p.images || []).forEach((im, i) => add(im?.url, `${dir}/${String(i + 1).padStart(2, "0")}${im?.colorName ? "-" + safe(im.colorName) : ""}${im?.type === "video" ? "-video" : ""}`,
      { kind: im?.type === "video" ? "video de producto" : "foto de producto", productId: p.id, product: p.name, color: im?.colorName || "" }));
  });
  (catalog?.banners || []).forEach((b) => {
    add(b.image, `banners/${safe(b.id)}-${safe(b.title)}-imagen`, { kind: "banner", product: b.title || "" });
    add(b.videoUrl, `banners/${safe(b.id)}-${safe(b.title)}-video`, { kind: "video de banner", product: b.title || "" });
  });
  (catalog?.collections || []).forEach((c) => add(c.cover, `colecciones/${safe(c.id)}-${safe(c.name)}`, { kind: "portada de colección", product: c.name || "" }));
  return out;
};

const saveBlob = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};

// onProgress({ done, total, bytes, part, failed }); signal: AbortSignal para cancelar
export async function downloadMediaBackup(catalog, { onProgress, signal, partBytes = 300 * 1024 * 1024, save = saveBlob } = {}) {
  const items = collectMedia(catalog);
  const date = new Date().toISOString().slice(0, 10);
  const rows = [["tipo", "producto_id", "nombre", "color", "archivo_en_zip", "parte", "url_original", "estado"]];
  let part = 1, partSize = 0, done = 0, bytes = 0, failed = 0;
  let chunks = [], zip = null, finished = null;
  const open = () => {
    chunks = []; partSize = 0;
    finished = new Promise((resolve, reject) => {
      zip = new Zip((err, data, final) => { if (err) { reject(err); return; } chunks.push(data); if (final) resolve(); });
    });
  };
  const addFile = (name, data) => { const f = new ZipPassThrough(name); zip.add(f); f.push(data, true); };
  const close = async (isLast) => {
    addFile("LEEME.txt", strToU8(`Copia de fotos y videos de Fly Boutique · ${date} · parte ${part}${isLast ? " (última)" : ""}\n\nCada carpeta de «productos» es un producto (nombre__id). El archivo indice.csv (en la última parte) dice a qué producto y color va cada foto y su dirección original en Supabase.\nGuarda todas las partes juntas en un lugar seguro (por ejemplo Google Drive).\n`));
    if (isLast) addFile("indice.csv", strToU8("﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")));
    zip.end(); await finished;
    save(new Blob(chunks, { type: "application/zip" }), `fly-fotos-${date}-parte${part}.zip`);
    chunks = [];
  };
  open();
  const queue = items.slice();
  const fetchOne = async (it) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) { const e = new Error("cancelado"); e.name = "AbortError"; throw e; }
      try {
        const r = await fetch(it.url, { signal, cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return { buf: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
      } catch (e) { if (e.name === "AbortError") throw e; if (attempt === 1) return { error: e.message || String(e) }; }
    }
  };
  // 4 descargas a la vez; la escritura al ZIP va de una en una (candado simple)
  let lock = Promise.resolve();
  const serialWorker = async () => {
    while (queue.length) {
      const it = queue.shift();
      const res = await fetchOne(it);
      lock = lock.then(async () => {
        if (res.error) { failed++; rows.push([it.kind, it.productId || "", it.product, it.color || "", "", "", it.url, "NO SE PUDO DESCARGAR: " + res.error]); }
        else {
          if (partSize > 0 && partSize + res.buf.length > partBytes) { await close(false); part++; open(); }
          const name = `${it.path}.${extOf(it.url, res.type)}`;
          addFile(name, res.buf); partSize += res.buf.length; bytes += res.buf.length;
          rows.push([it.kind, it.productId || "", it.product, it.color || "", name, part, it.url, "ok"]);
          it.also.forEach((x) => rows.push([x.kind, x.productId || "", x.product, x.color || "", name, part, it.url, "ok (misma foto que otro producto)"]));
        }
        done++; onProgress && onProgress({ done, total: items.length, bytes, part, failed });
      });
      await lock;
    }
  };
  await Promise.all([serialWorker(), serialWorker(), serialWorker(), serialWorker()]);
  await lock;
  await close(true);
  return { total: items.length, done, bytes, parts: part, failed, failedList: rows.filter((r) => String(r[7]).startsWith("NO SE")).map((r) => r[6]) };
}
