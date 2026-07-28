import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // The dep optimizer does not emit maplibre-gl's web-worker chunk
    // (maplibre-gl-worker.mjs 404s in dev, and the map never boots).
    // Serving maplibre-gl from source sidesteps it; prod builds are
    // unaffected either way.
    exclude: ["maplibre-gl"],
  },
});
