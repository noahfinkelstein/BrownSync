import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

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
  };
});
