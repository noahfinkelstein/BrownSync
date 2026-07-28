import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Standalone gallery: `pnpm --filter @brownsync/ui dev`. Becomes /dev/ui in Phase 2. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist/gallery",
    emptyOutDir: true,
  },
});
