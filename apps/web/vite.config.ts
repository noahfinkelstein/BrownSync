import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Chunking (Phase 3 perf): the handoff §2 budget is 450 KB gz for the app
 * bundle EXCLUDING map libs, so the map stack is split into dedicated
 * `maplib-*` chunks that `scripts/bundle-budget.mjs` attributes to the
 * exempt group. Function-form `manualChunks` assigns by module id only —
 * unlike `advancedChunks` groups (which default to dragging each captured
 * module's dependency subtree along), it cannot pull shared deps like React
 * out of the app group and silently flatter the budget.
 */
const MAPLIB_GL = /node_modules[\\/].*(?:maplibre-gl|react-map-gl|pmtiles)[\\/]/;
const MAPLIB_DECK = /node_modules[\\/].*@(?:deck\.gl|luma\.gl|math\.gl|probe\.gl|loaders\.gl)[\\/]/;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // The dep optimizer does not emit maplibre-gl's web-worker chunk
    // (maplibre-gl-worker.mjs 404s in dev, and the map never boots).
    // Serving maplibre-gl from source sidesteps it; prod builds are
    // unaffected either way.
    exclude: ["maplibre-gl"],
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks: (id: string) => {
          if (MAPLIB_GL.test(id)) return "maplib-gl";
          if (MAPLIB_DECK.test(id)) return "maplib-deck";
          return undefined;
        },
      },
    },
    // The maplib chunks are known-large (GL runtime); the enforced budget for
    // everything else lives in scripts/bundle-budget.mjs, not this warning.
    chunkSizeWarningLimit: 1500,
  },
});
