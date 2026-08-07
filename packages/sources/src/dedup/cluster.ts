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
export type DedupPair = {
  aId: string;
  bId: string;
  /** pg_trgm title similarity — stronger pairs union first (see clusterPairs). */
  similarity?: number;
};

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

/**
 * Union-find over pair edges → connected components (clusters of size >= 2).
 *
 * When `sourceById` is provided the union is SOURCE-DISJOINT: a union that
 * would put two rows of the same source into one component is skipped. Two
 * same-source rows are by definition two different real events (the
 * (source, source_id) upsert key dedupes within a source), so a cluster
 * containing both would mark a real event as a duplicate. This is exactly the
 * transitive-bridge hazard: an unlocated row (bdh, away games) blocks against
 * everything in its time window, so it can pair with BOTH occurrences of a
 * pre-expanded LiveWhale series — the bridge may join one occurrence, never
 * fuse the two. Edges are processed strongest-similarity first (ties broken
 * by id) so the bridge lands with its best match, deterministically. Ids
 * missing from `sourceById` are treated as sourceless and never conflict.
 */
export function clusterPairs(
  pairs: readonly DedupPair[],
  sourceById?: ReadonlyMap<string, string>,
): string[][] {
  const parent = new Map<string, string>();
  /** Root → set of member sources (only tracked when constraining). */
  const rootSources = sourceById ? new Map<string, Set<string>>() : null;
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
  const add = (id: string): void => {
    if (parent.has(id)) return;
    parent.set(id, id);
    if (rootSources) {
      const source = sourceById?.get(id);
      rootSources.set(id, source === undefined ? new Set() : new Set([source]));
    }
  };
  const ordered = [...pairs].sort(
    (p, q) =>
      (q.similarity ?? 0) - (p.similarity ?? 0) ||
      (p.aId < q.aId ? -1 : p.aId > q.aId ? 1 : 0) ||
      (p.bId < q.bId ? -1 : p.bId > q.bId ? 1 : 0),
  );
  for (const { aId, bId } of ordered) {
    if (aId === bId) continue; // self-pairs prove nothing
    add(aId);
    add(bId);
    const ra = find(aId);
    const rb = find(bId);
    if (ra === rb) continue;
    if (rootSources) {
      const sa = rootSources.get(ra) ?? new Set<string>();
      const sb = rootSources.get(rb) ?? new Set<string>();
      const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
      let conflict = false;
      for (const s of small) {
        if (large.has(s)) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue; // union would repeat a source — evidence is ambiguous
      for (const s of small) large.add(s);
      rootSources.delete(ra);
      rootSources.set(rb, large);
    }
    parent.set(ra, rb);
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
 * assignments can never create canonical_id chains. Clustering is
 * source-disjoint (see clusterPairs), so no assignment can ever mark one
 * same-source row a duplicate of another, directly or via a bridge.
 */
export function resolveAssignments(
  membersById: ReadonlyMap<string, DedupMember>,
  pairs: readonly DedupPair[],
  sourcePriority: readonly string[],
): DedupAssignment[] {
  const sourceById = new Map<string, string>();
  for (const [id, m] of membersById) sourceById.set(id, m.source);
  const assignments: DedupAssignment[] = [];
  for (const cluster of clusterPairs(pairs, sourceById)) {
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
