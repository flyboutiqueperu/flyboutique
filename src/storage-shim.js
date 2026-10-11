if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const raw = localStorage.getItem(key);
      if (raw === null) throw new Error(`Clave no encontrada: ${key}`);
      return { key, value: raw };
    },
    async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
    async delete(key) { localStorage.removeItem(key); return { key, deleted: true }; },
    async list(prefix) {
      const keys = Object.keys(localStorage).filter((k) => !prefix || k.startsWith(prefix));
      return { keys, prefix };
    },
  };
}
