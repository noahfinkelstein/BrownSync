import type { SeedEvent } from "@brownsync/contract";
import type { Source } from "./sources";

/** One structured feed: where to fetch it and how to turn the raw text into contract rows. */
export type SourceModule = {
  /** `events.source` value (contract §1): 'livewhale' | 'athletics_ics' | 'bdh'. */
  source: string;
  /** CLI name (`pnpm poll <cliName>`). */
  cliName: Source;
  endpoint: string;
  /** Default fixture filename under fixtures/ for `--fixture` replay. */
  defaultFixture: string;
  /**
   * Whether the cancellation sweep (contract §2) applies. True for full-window
   * feeds (LiveWhale, athletics); false for BDH — the RSS feed is a rolling
   * top-N of articles, not a full window, so absence never means cancellation.
   */
  sweep: boolean;
  /**
   * Row count requested from the source (`?max=N`), when the endpoint takes
   * one. A fetch returning >= this many rows is treated as truncated (see
   * sweep.ts): the sweep is clamped and the run recorded as partial.
   */
  requestedMax?: number;
  /** Raw response text → validated contract seed-event rows. Throws on malformed feeds. */
  normalize: (rawText: string) => SeedEvent[];
};
