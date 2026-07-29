import { setWorkerUrl } from "maplibre-gl";
// Vite bundles the worker entry as a real worker chunk (dev: module worker
// endpoint; build: emitted asset) and hands back its URL.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

let configured = false;

/**
 * Point MapLibre at a bundler-emitted worker. Without this, maplibre v6
 * derives the worker URL from `import.meta.url`: under Vite dev that serves
 * an ESM-transformed file the classic-worker fallback can't parse, and under
 * `vite build` the file is never emitted at all — either way the map never
 * fires `load`. Idempotent; call before constructing any map.
 */
export function configureMaplibreWorker(): void {
  if (configured) return;
  setWorkerUrl(maplibreWorkerUrl);
  configured = true;
}
