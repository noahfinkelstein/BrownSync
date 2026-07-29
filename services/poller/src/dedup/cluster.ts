/**
 * Pure clustering + canonical-selection logic for the cross-source dedup job.
 * No I/O — the SQL layer (index.ts) finds candidate pairs; this module turns
 * pairs into `canonical_id` assignments. Unit-tested offline in
 * test/dedup.test.ts.
 *
 * Resolution semantics (DATA_CONTRACT.md §1 `events.canonical_id` + §3):
 * duplicates are MARKED, never deleted — each duplicate row's canonical_id
 * points at the cluster's canonical row, and the read API then exposes only
 * canonical rows with the duplicates' sources aggregated as mergedSources.
 */

export type DedupMember = {
  /** events.id (uuid). */
  id: string;
  /** events.source — 'livewhale' | 'athletics_ics' | 'bdh' | ... */
  source: string;
  /** events.confidence (contract §1: 1.0 structured feed, <1.0 extracted). */
  confidence: number;
  /** events.first_seen_at as ISO text — earlier sightings win ties. */
  firstSeenAt: string;
};

/** One blocked-and-similar candidate pair (unordered; SQL emits each once). */
export type DedupPair = { aId: string; bId: string };

export type DedupAssignment = { duplicateId: string; canonicalId: string };

/**
 * Canonical pick within a cluster, most-trustworthy first:
 * 1. higher `confidence` (a structured feed beats an extracted event);
 * 2. earlier position in `sourcePriority` (richer feeds first — livewhale
 *    carries coords/urls/orgs; bdh is a coordless buzz layer). Sources not
 *    listed rank after all listed ones, equally;
 * 3. earlier `first_seen_at` (the row the system has known longest is the
 *    stable anchor — re-runs keep picking it);
 * 4. smaller `id` (total order — determinism no matter the input order).
 */
export function compareCanonicalPreference(
  a: DedupMember,
  b: DedupMember,
  sourcePriority: readonly string[],
): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  const rank = (s: string): number => {
    const i = sourcePriority.indexOf(s);
    return i === -1 ? sourcePriority.length : i;
  };
  const byRank = rank(a.source) - rank(b.source);
  if (byRank !== 0) return byRank;
  const byFirstSeen = Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt);
  if (byFirstSeen !== 0) return byFirstSeen;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function pickCanonical(
  members: readonly DedupMember[],
  sourcePriority: readonly string[],
): DedupMember {
  const first = members[0];
  if (first === undefined) throw new Error("pickCanonical: empty cluster");
  let best = first;
  for (const m of members) {
    if (compareCanonicalPreference(m, best, sourcePriority) < 0) best = m;
  }
  return best;
}

/** Union-find over pair edges → connected components (clusters of size >= 2). */
export function clusterPairs(pairs: readonly DedupPair[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (true) {
      const p = parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      if (next === undefined) break;
      cur = next;
    }
    return root;
  };
  for (const { aId, bId } of pairs) {
    if (aId === bId) continue; // self-pairs prove nothing
    if (!parent.has(aId)) parent.set(aId, aId);
    if (!parent.has(bId)) parent.set(bId, bId);
    const ra = find(aId);
    const rb = find(bId);
    if (ra !== rb) parent.set(ra, rb);
  }
  const byRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(id);
    else byRoot.set(root, [id]);
  }
  return [...byRoot.values()].filter((c) => c.length >= 2).map((c) => c.sort());
}

/**
 * Pairs → flat assignments: every non-canonical cluster member points DIRECTLY
 * at the cluster's canonical (never at another duplicate), so applying the
 * assignments can never create canonical_id chains.
 */
export function resolveAssignments(
  membersById: ReadonlyMap<string, DedupMember>,
  pairs: readonly DedupPair[],
  sourcePriority: readonly string[],
): DedupAssignment[] {
  const assignments: DedupAssignment[] = [];
  for (const cluster of clusterPairs(pairs)) {
    const members = cluster.map((id) => {
      const m = membersById.get(id);
      if (m === undefined) throw new Error(`resolveAssignments: no metadata for event ${id}`);
      return m;
    });
    const canonical = pickCanonical(members, sourcePriority);
    for (const m of members) {
      if (m.id !== canonical.id) assignments.push({ duplicateId: m.id, canonicalId: canonical.id });
    }
  }
  return assignments.sort((x, y) => (x.duplicateId < y.duplicateId ? -1 : 1));
}
