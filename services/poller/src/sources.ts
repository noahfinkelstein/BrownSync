/**
 * Structured-feed sources owned by this package (handoff §1). Python
 * scrapers (CAB, clubs, OSM gazetteer) are the Codex workstream in ingest/.
 */
export const SOURCES = ["livewhale", "athletics", "bdh"] as const;
export type Source = (typeof SOURCES)[number];

export function isSource(v: string): v is Source {
  return (SOURCES as readonly string[]).includes(v);
}
