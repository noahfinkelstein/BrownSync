import { describe, expect, it } from "vitest";
import {
  buildCandidatePairsQuery,
  clusterPairs,
  DEFAULT_DEDUP_CONFIG,
  type DedupMember,
  pickCanonical,
  resolveAssignments,
} from "../src/dedup";

/** Offline tests: SQL building + candidate/cluster logic. No DB, no network. */

function member(partial: Partial<DedupMember> & { id: string }): DedupMember {
  return {
    source: "livewhale",
    confidence: 1,
    firstSeenAt: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

function membersMap(...members: DedupMember[]): Map<string, DedupMember> {
  return new Map(members.map((m) => [m.id, m]));
}

describe("buildCandidatePairsQuery", () => {
  const { text, params } = buildCandidatePairsQuery(DEFAULT_DEDUP_CONFIG);

  it("binds all tunables as parameters, none inlined", () => {
    expect(params).toEqual([60, 250, 0.55]);
    expect(text).toContain("$1::int");
    expect(text).toContain("$2::float8");
    expect(text).toContain("$3::real");
    // No literal thresholds baked into the SQL text.
    expect(text).not.toContain("0.55");
    expect(text).not.toContain("250");
  });

  it("considers only canonical rows and only cross-source pairs, each once", () => {
    expect(text).toContain("where e.canonical_id is null");
    expect(text).toContain("b.source <> a.source");
    expect(text).toContain("b.id > a.id");
  });

  it("blocks on time window and place/coords, decides on pg_trgm similarity", () => {
    expect(text).toContain("make_interval(mins => $1::int)");
    expect(text).toContain("a.place_id = b.place_id");
    expect(text).toContain("ST_DWithin");
    expect(text).toContain("::geography");
    expect(text).toMatch(/similarity\(a\.title, b\.title\) >= \$3::real/);
    // Unlocated rows (no place, no coords) cannot be ruled out by place.
    expect(text).toContain("a.place_id is null and a.lat is null");
    expect(text).toContain("b.place_id is null and b.lat is null");
  });

  it("resolves gazetteer coordinates so place-only rows can coord-block", () => {
    // Athletics home rows carry place_id but NO feed coords (normalize.ts
    // hardcodes lat/lng null); LiveWhale rows carry coords but NO place_id.
    // The coord arm can only ever fire for that pair if place-only rows fall
    // back to the gazetteer centroid.
    expect(text).toContain("left join places");
    expect(text).toMatch(
      /case when e\.lat is not null and e\.lng is not null then e\.lat else p\.lat end/,
    );
    expect(text).toMatch(
      /case when e\.lat is not null and e\.lng is not null then e\.lng else p\.lng end/,
    );
  });

  it("threads custom config through the params", () => {
    const custom = buildCandidatePairsQuery({
      ...DEFAULT_DEDUP_CONFIG,
      timeWindowMinutes: 15,
      coordRadiusMeters: 50,
      titleSimilarityThreshold: 0.8,
    });
    expect(custom.params).toEqual([15, 50, 0.8]);
    expect(custom.text).toBe(text); // config never alters the SQL shape
  });
});

describe("clusterPairs", () => {
  it("returns connected components of size >= 2, sorted for determinism", () => {
    const clusters = clusterPairs([
      { aId: "b", bId: "a" },
      { aId: "c", bId: "b" }, // transitively joins {a,b,c}
      { aId: "x", bId: "y" },
    ]);
    expect(clusters).toContainEqual(["a", "b", "c"]);
    expect(clusters).toContainEqual(["x", "y"]);
    expect(clusters).toHaveLength(2);
  });

  it("ignores self-pairs and tolerates repeated pairs", () => {
    const clusters = clusterPairs([
      { aId: "a", bId: "a" },
      { aId: "a", bId: "b" },
      { aId: "a", bId: "b" },
    ]);
    expect(clusters).toEqual([["a", "b"]]);
  });

  it("is empty for no pairs", () => {
    expect(clusterPairs([])).toEqual([]);
  });

  describe("source-disjoint constraint (same-source rows are distinct events)", () => {
    const sources = new Map([
      ["lwA", "livewhale"],
      ["lwB", "livewhale"],
      ["bdh", "bdh"],
    ]);

    it("never lets a bridge row transitively merge two same-source rows", () => {
      // The production shape: an unlocated bdh row blocks against BOTH
      // occurrences of a LiveWhale pre-expanded series (hourly tours).
      const clusters = clusterPairs(
        [
          { aId: "lwA", bId: "bdh" },
          { aId: "lwB", bId: "bdh" },
        ],
        sources,
      );
      expect(clusters).toEqual([["bdh", "lwA"]]); // lwB stays out — its union would repeat 'livewhale'
    });

    it("prefers the strongest pair when a bridge could join either side", () => {
      const clusters = clusterPairs(
        [
          { aId: "lwA", bId: "bdh", similarity: 0.6 },
          { aId: "lwB", bId: "bdh", similarity: 0.9 },
        ],
        sources,
      );
      expect(clusters).toEqual([["bdh", "lwB"]]);
    });

    it("refuses direct same-source pairs outright (defense in depth vs SQL)", () => {
      expect(clusterPairs([{ aId: "lwA", bId: "lwB" }], sources)).toEqual([]);
    });

    it("still merges freely across distinct sources", () => {
      const map = new Map([
        ["lw", "livewhale"],
        ["ics", "athletics_ics"],
        ["bdh", "bdh"],
      ]);
      const clusters = clusterPairs(
        [
          { aId: "lw", bId: "ics" },
          { aId: "ics", bId: "bdh" },
        ],
        map,
      );
      expect(clusters).toEqual([["bdh", "ics", "lw"]]);
    });
  });
});

describe("pickCanonical", () => {
  const priority = DEFAULT_DEDUP_CONFIG.sourcePriority;

  it("prefers higher confidence over source priority", () => {
    const lw = member({ id: "a", source: "livewhale", confidence: 0.6 });
    const ics = member({ id: "b", source: "athletics_ics", confidence: 1 });
    expect(pickCanonical([lw, ics], priority).id).toBe("b");
  });

  it("breaks confidence ties by source priority (livewhale > athletics_ics > bdh)", () => {
    const bdh = member({ id: "a", source: "bdh" });
    const ics = member({ id: "b", source: "athletics_ics" });
    const lw = member({ id: "c", source: "livewhale" });
    expect(pickCanonical([bdh, ics, lw], priority).id).toBe("c");
    expect(pickCanonical([bdh, ics], priority).id).toBe("b");
  });

  it("ranks unknown sources after every listed source", () => {
    const mystery = member({ id: "a", source: "somefeed" });
    const bdh = member({ id: "b", source: "bdh" });
    expect(pickCanonical([mystery, bdh], priority).id).toBe("b");
  });

  it("breaks source ties by earliest first_seen_at, then smallest id", () => {
    const older = member({ id: "z", firstSeenAt: "2026-09-01T00:00:00Z" });
    const newer = member({ id: "a", firstSeenAt: "2026-09-02T00:00:00Z" });
    expect(pickCanonical([newer, older], priority).id).toBe("z");
    const twinA = member({ id: "a" });
    const twinB = member({ id: "b" });
    expect(pickCanonical([twinB, twinA], priority).id).toBe("a");
  });

  it("throws on an empty cluster", () => {
    expect(() => pickCanonical([], priority)).toThrow(/empty cluster/);
  });
});

describe("resolveAssignments", () => {
  const priority = DEFAULT_DEDUP_CONFIG.sourcePriority;

  it("points every duplicate directly at the cluster canonical — no chains", () => {
    const lw = member({ id: "lw", source: "livewhale" });
    const ics = member({ id: "ics", source: "athletics_ics" });
    const bdh = member({ id: "bdh", source: "bdh" });
    const assignments = resolveAssignments(
      membersMap(lw, ics, bdh),
      [
        { aId: "lw", bId: "ics" },
        { aId: "ics", bId: "bdh" }, // bdh only linked via ics — must still point at lw
      ],
      priority,
    );
    expect(assignments).toEqual([
      { duplicateId: "bdh", canonicalId: "lw" },
      { duplicateId: "ics", canonicalId: "lw" },
    ]);
    const duplicateIds = new Set(assignments.map((a) => a.duplicateId));
    for (const a of assignments) expect(duplicateIds.has(a.canonicalId)).toBe(false);
  });

  it("keeps independent clusters independent", () => {
    const a1 = member({ id: "a1", source: "livewhale" });
    const a2 = member({ id: "a2", source: "bdh" });
    const b1 = member({ id: "b1", source: "athletics_ics" });
    const b2 = member({ id: "b2", source: "bdh" });
    const assignments = resolveAssignments(
      membersMap(a1, a2, b1, b2),
      [
        { aId: "a1", bId: "a2" },
        { aId: "b1", bId: "b2" },
      ],
      priority,
    );
    expect(assignments).toEqual([
      { duplicateId: "a2", canonicalId: "a1" },
      { duplicateId: "b2", canonicalId: "b1" },
    ]);
  });

  it("never assigns a same-source duplicate — bridged twins keep one row canonical", () => {
    // Finding repro: two occurrences of a LiveWhale series + one unlocated
    // bdh bridge. The old behavior merged all three and marked lwB a
    // duplicate of lwA — vanishing a REAL second occurrence from the API.
    const lwA = member({ id: "lwA", source: "livewhale" });
    const lwB = member({ id: "lwB", source: "livewhale" });
    const bdh = member({ id: "bdh", source: "bdh" });
    const assignments = resolveAssignments(
      membersMap(lwA, lwB, bdh),
      [
        { aId: "lwA", bId: "bdh" },
        { aId: "lwB", bId: "bdh" },
      ],
      priority,
    );
    expect(assignments).toEqual([{ duplicateId: "bdh", canonicalId: "lwA" }]);
  });

  it("keeps both same-source rows canonical when a shared cross-source twin exists", () => {
    // {ATH-a, ATH-b, LW}: LW can absorb at most ONE athletics row.
    const athA = member({ id: "athA", source: "athletics_ics" });
    const athB = member({ id: "athB", source: "athletics_ics" });
    const lw = member({ id: "lw", source: "livewhale" });
    const assignments = resolveAssignments(
      membersMap(athA, athB, lw),
      [
        { aId: "athA", bId: "lw" },
        { aId: "athB", bId: "lw" },
      ],
      priority,
    );
    expect(assignments).toEqual([{ duplicateId: "athA", canonicalId: "lw" }]);
  });

  it("throws when pair metadata is missing (SQL and clustering out of sync)", () => {
    expect(() =>
      resolveAssignments(membersMap(member({ id: "a" })), [{ aId: "a", bId: "ghost" }], priority),
    ).toThrow(/no metadata/);
  });

  it("returns nothing for no pairs", () => {
    expect(resolveAssignments(new Map(), [], priority)).toEqual([]);
  });
});
