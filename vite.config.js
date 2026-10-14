import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// React y Supabase van en su propio archivo: casi nunca cambian, así el celular los guarda y no los vuelve a bajar en cada actualización.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/@supabase")) return "supabase";
          if (id.includes("node_modules/lucide-react")) return "iconos";
          return undefined;
        },
      },
    },
  },
});
