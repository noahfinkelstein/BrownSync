import { addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";

let registered = false;

/**
 * Register the `pmtiles://` protocol with MapLibre so style sources like
 * `pmtiles:///tiles/providence.pmtiles` resolve via HTTP range requests.
 * Idempotent — safe to call from every module that renders a map.
 */
export function registerPmtilesProtocol(): void {
  if (registered) return;
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
  registered = true;
}
