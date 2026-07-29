import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

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

/**
 * Social scrapers require ABSOLUTE og:image / twitter:image URLs. Site-
 * relative tags stay in index.html (dev/preview work without config); at
 * `vite build`, when `VITE_CANONICAL_ORIGIN` is set (env or .env file, e.g.
 * `https://brownsync.pages.dev` — origin only, no trailing slash), this
 * prefixes every root-relative og:image / twitter:image content URL.
 * Exported for the unit test (test/og-canonical.test.ts).
 */
export function absolutizeOgImages(html: string, origin: string | undefined): string {
  const base = origin?.trim().replace(/\/+$/, "");
  if (!base) return html;
  return html.replace(
    /(<meta[^>]*(?:property="og:image"|name="twitter:image")[^>]*content=")(\/[^"]*)(")/g,
    (_match, pre: string, path: string, post: string) => `${pre}${base}${path}${post}`,
  );
}

function canonicalOgPlugin(origin: string | undefined): Plugin {
  return {
    name: "brownsync:canonical-og",
    apply: "build",
    transformIndexHtml(html) {
      return absolutizeOgImages(html, origin);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), canonicalOgPlugin(env.VITE_CANONICAL_ORIGIN)],
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
  };
});
