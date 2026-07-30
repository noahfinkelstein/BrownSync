import type { SeedEvent } from "@brownsync/contract";
import type { Shard, WindowFetch } from "./livewhale/shard";
import type { Source } from "./sources";
import type { DateWindow } from "./sweep";

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
  /**
   * OPTIONAL sharded fetch. A source that sets this is fetched as a series of
   * bounded windows instead of one unbounded request, which is the only way to
   * get past a server-side row cap and therefore the only way such a source can
   * ever honestly report `ok` (see livewhale/shard.ts).
   *
   * Sources WITHOUT it keep today's single-fetch path byte for byte — that is
   * the point of it being optional. `windowEndpoint` must be present too: the
   * module owns its URL shape, the runner owns where bodies come from (live
   * HTTP, or a recorded replay plan under --fixture).
   */
  fetchPlan?: (fetchWindow: WindowFetch) => Promise<Shard[]>;
  /** URL for one bounded window. Required whenever `fetchPlan` is set. */
  windowEndpoint?: (window: DateWindow) => string;
};
