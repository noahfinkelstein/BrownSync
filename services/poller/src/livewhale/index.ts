import {
  fetchShards,
  LIVEWHALE_MAX,
  LIVEWHALE_URL,
  livewhaleWindowUrl,
  normalizeLivewhaleFeed,
} from "@brownsync/sources/livewhale/index";
import type { SourceModule } from "../types";
import { loadOrgGroups } from "./orgs";

// Endpoint constants + window URL builder moved to packages/sources
// (the Worker dispatcher fetches the same URLs); re-exported for stable paths.
export * from "@brownsync/sources/livewhale/endpoint";
export * from "./categories";
export * from "./normalize";
export * from "./orgs";
export * from "./schema";
export * from "./shard";

export const livewhaleModule: SourceModule = {
  source: "livewhale",
  cliName: "livewhale",
  endpoint: LIVEWHALE_URL,
  // The fixture for a sharded source is a REPLAY PLAN, not a single response:
  // see fixtures/livewhale-shards.json.
  defaultFixture: "livewhale-shards.json",
  sweep: true,
  requestedMax: LIVEWHALE_MAX,
  normalize: (rawText) => normalizeLivewhaleFeed(rawText, loadOrgGroups()),
  windowEndpoint: livewhaleWindowUrl,
  fetchPlan: (fetchWindow) =>
    fetchShards(fetchWindow, (rawText) => normalizeLivewhaleFeed(rawText, loadOrgGroups())),
};
