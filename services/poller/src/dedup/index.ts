import { connect, recordSourceRun, type Sql } from "../db";
import {
  type DedupAssignment,
  type DedupMember,
  type DedupPair,
  resolveAssignments,
} from "./cluster";

export * from "./cluster";

/**
 * Cross-source dedup job — detects the same real-world event ingested from
 * different feeds (livewhale / athletics_ics / bdh / future sources) and marks
 * duplicates per the contract's canonical/duplicate resolution:
 *
 *   DATA_CONTRACT §1: `canonical_id uuid references events(id)` — non-null
 *   means "this row is a duplicate of canonical_id". §3: the read API returns
 *   only canonical rows, with duplicates' sources as mergedSources. Nothing is
 *   ever deleted (§2 "never hard-delete" governs here too).
 *
 * Detection = candidate BLOCKING in SQL, then pg_trgm title similarity:
 * - time-window block: start_ts within `timeWindowMinutes` of each other;
 * - place block: same resolved place_id, or EFFECTIVE coordinates within
 *   `coordRadiusMeters` — a row's effective coords are its feed coords when
 *   present, else its resolved place's gazetteer centroid (athletics home
 *   rows carry place_id but NO feed coords, LiveWhale rows carry coords but
 *   NO place_id — the gazetteer fallback is what lets that pair block at
 *   all) — or at least one side is unlocated (no place_id AND no coords —
 *   bdh, away games) so place evidence cannot rule the pair out;
 * - decision: similarity(title, title) >= `titleSimilarityThreshold`. The
 *   threshold is contract §2's trigram threshold (0.55, "never guess below
 *   threshold") applied to titles.
 *
 * Only current canonical rows (canonical_id IS NULL) are candidates — a row
 * already marked duplicate stays with its cluster; re-running is idempotent.
 * Cross-source only: same-source duplicates are prevented upstream by the
 * (source, source_id) upsert key, and enforced again during clustering —
 * clusterPairs never places two rows of one source in the same cluster, so
 * an unlocated bridge row cannot transitively fuse two occurrences of a
 * pre-expanded series (see cluster.ts).
 */

export type DedupConfig = {
  /** Blocking: |a.start_ts - b.start_ts| must be within this many minutes. */
  timeWindowMinutes: number;
  /** Blocking: coordinate pairs within this many meters count as same place. */
  coordRadiusMeters: number;
  /** Decision: pg_trgm similarity(a.title, b.title) floor (contract §2). */
  titleSimilarityThreshold: number;
  /** Canonical preference after confidence — richer feeds first. */
  sourcePriority: readonly string[];
};

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  timeWindowMinutes: 60,
  coordRadiusMeters: 250,
  titleSimilarityThreshold: 0.55,
  // livewhale carries coords/urls/org links; athletics_ics is structured but
  // venue-only; cab/clubs/manual are hand-curated or term data; bdh is a
  // coordless news buzz layer — last resort as canonical.
  sourcePriority: ["livewhale", "athletics_ics", "cab", "clubs", "manual", "bdh"],
};

/**
 * The heavy lifting happens in Postgres: one self-join over canonical rows
 * with the blocking predicates in the join condition and the pg_trgm decision
 * in WHERE. `b.id > a.id` emits each unordered pair exactly once. All tunables
 * are bound parameters ($1 minutes, $2 meters, $3 similarity floor).
 */
export function buildCandidatePairsQuery(cfg: DedupConfig): {
  text: string;
  params: [number, number, number];
} {
  const text = `
with canonical as (
  select
    e.id, e.source, e.title, e.start_ts, e.place_id,
    -- Effective coords: feed coords when the source provides a full pair,
    -- else the gazetteer centroid of the resolved place (contract §5 —
    -- athletics home venues resolve place_id and carry no coords).
    case when e.lat is not null and e.lng is not null then e.lat else p.lat end as lat,
    case when e.lat is not null and e.lng is not null then e.lng else p.lng end as lng,
    e.confidence, e.first_seen_at
  from events e
  left join places p on p.id = e.place_id
  where e.canonical_id is null
)
select
  a.id            as a_id,
  a.source        as a_source,
  a.confidence    as a_confidence,
  a.first_seen_at as a_first_seen_at,
  b.id            as b_id,
  b.source        as b_source,
  b.confidence    as b_confidence,
  b.first_seen_at as b_first_seen_at,
  similarity(a.title, b.title) as title_similarity
from canonical a
join canonical b
  on b.id > a.id
 and b.source <> a.source
 and b.start_ts >= a.start_ts - make_interval(mins => $1::int)
 and b.start_ts <= a.start_ts + make_interval(mins => $1::int)
 and (
      (a.place_id is not null and a.place_id = b.place_id)
   or (a.lat is not null and a.lng is not null
       and b.lat is not null and b.lng is not null
       and ST_DWithin(
             ST_SetSRID(ST_MakePoint(a.lng, a.lat), 4326)::geography,
             ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography,
             $2::float8))
   or (a.place_id is null and a.lat is null)
   or (b.place_id is null and b.lat is null)
 )
where similarity(a.title, b.title) >= $3::real
order by a.id, b.id
`.trim();
  return {
    text,
    params: [cfg.timeWindowMinutes, cfg.coordRadiusMeters, cfg.titleSimilarityThreshold],
  };
}

type CandidatePairRow = {
  a_id: string;
  a_source: string;
  a_confidence: number;
  a_first_seen_at: Date;
  b_id: string;
  b_source: string;
  b_confidence: number;
  b_first_seen_at: Date;
  title_similarity: number;
};

export type DedupRunSummary = {
  candidatePairs: number;
  marked: number;
  /** Pre-existing duplicates re-pointed when their canonical got re-marked. */
  flattened: number;
};

/**
 * Safety net for chains: if an earlier run left D -> A and this run marks
 * A -> C, D must follow to C (canonical_id must always point at a row whose
 * own canonical_id is null — §3 depends on it). Assignments from
 * resolveAssignments are already flat, so one pass covers a run's own writes;
 * the loop bound covers pathological pre-existing states.
 */
async function flattenChains(sql: Sql): Promise<number> {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const result = await sql`
      update events e
      set canonical_id = c.canonical_id
      from events c
      where e.canonical_id = c.id
        and c.canonical_id is not null
        and c.canonical_id <> c.id
        and c.canonical_id <> e.id
    `;
    total += result.count;
    if (result.count === 0) break;
  }
  return total;
}

export async function runDedup(
  sql: Sql,
  cfg: DedupConfig = DEFAULT_DEDUP_CONFIG,
  opts: { dryRun?: boolean } = {},
): Promise<{ summary: DedupRunSummary; assignments: DedupAssignment[] }> {
  const query = buildCandidatePairsQuery(cfg);
  const rows = (await sql.unsafe(query.text, query.params)) as unknown as CandidatePairRow[];

  const membersById = new Map<string, DedupMember>();
  const pairs: DedupPair[] = [];
  for (const r of rows) {
    membersById.set(r.a_id, {
      id: r.a_id,
      source: r.a_source,
      confidence: r.a_confidence,
      firstSeenAt: r.a_first_seen_at.toISOString(),
    });
    membersById.set(r.b_id, {
      id: r.b_id,
      source: r.b_source,
      confidence: r.b_confidence,
      firstSeenAt: r.b_first_seen_at.toISOString(),
    });
    pairs.push({ aId: r.a_id, bId: r.b_id, similarity: r.title_similarity });
  }

  const assignments = resolveAssignments(membersById, pairs, cfg.sourcePriority);

  if (opts.dryRun) {
    return {
      summary: { candidatePairs: pairs.length, marked: assignments.length, flattened: 0 },
      assignments,
    };
  }

  // Apply grouped by canonical. `canonical_id is null` re-checks the premise
  // row-by-row so a concurrent marker can never produce a chain via this path.
  const byCanonical = new Map<string, string[]>();
  for (const a of assignments) {
    const bucket = byCanonical.get(a.canonicalId);
    if (bucket) bucket.push(a.duplicateId);
    else byCanonical.set(a.canonicalId, [a.duplicateId]);
  }
  let marked = 0;
  for (const [canonicalId, duplicateIds] of byCanonical) {
    const result = await sql`
      update events
      set canonical_id = ${canonicalId}
      where id = any(${sql.array(duplicateIds)}::uuid[])
        and canonical_id is null
        and id <> ${canonicalId}
    `;
    marked += result.count;
  }

  const flattened = await flattenChains(sql);
  return { summary: { candidatePairs: pairs.length, marked, flattened }, assignments };
}

export type DedupJobResult = {
  source: "dedup";
  status: "ok" | "error";
  marked: number;
  error: string | null;
};

/**
 * CLI entry (`pnpm poll dedup [--dry-run]`). Unlike the feed pollers' dry-run,
 * dedup's --dry-run still needs DATABASE_URL — candidates live in the DB —
 * but writes nothing (no canonical_id updates, no source_runs row) and prints
 * the planned assignments as NDJSON on stdout.
 */
export async function runDedupJob(
  opts: { dryRun: boolean },
  cfg: DedupConfig = DEFAULT_DEDUP_CONFIG,
): Promise<DedupJobResult> {
  const startedAt = new Date().toISOString();
  let sql: Sql | null = null;
  try {
    sql = connect();
    const { summary, assignments } = await runDedup(sql, cfg, opts);
    if (opts.dryRun) {
      for (const a of assignments) console.log(JSON.stringify(a));
    } else {
      await recordSourceRun(sql, {
        source: "dedup",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "ok",
        items_upserted: summary.marked,
        error: null,
      });
    }
    console.error(
      `[dedup] ${summary.candidatePairs} candidate pairs → ${summary.marked} rows ` +
        `${opts.dryRun ? "would be " : ""}marked duplicate` +
        (summary.flattened > 0 ? ` (${summary.flattened} chained re-pointed)` : ""),
    );
    return { source: "dedup", status: "ok", marked: summary.marked, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[dedup] error: ${error}`);
    if (!opts.dryRun && sql) {
      try {
        await recordSourceRun(sql, {
          source: "dedup",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          status: "error",
          items_upserted: 0,
          error,
        });
      } catch (recordErr) {
        const msg = recordErr instanceof Error ? recordErr.message : String(recordErr);
        console.error(`[source_runs] could not record failure: ${msg}`);
      }
    }
    return { source: "dedup", status: "error", marked: 0, error };
  } finally {
    await sql?.end();
  }
}
