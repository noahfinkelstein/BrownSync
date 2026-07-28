import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { OrgLivewhaleGroupsSchema } from "@brownsync/contract";
import { SEEDS_DIR } from "../paths";
import { groupKey } from "./categories";
import type { OrgByGroup } from "./normalize";

const ORG_GROUPS_FILE = path.join(SEEDS_DIR, "organization_livewhale_groups.json");

/**
 * The ingestion lane emits db/seeds/organization_livewhale_groups.json
 * ({ schema_version: 1, generated_at, mappings: [{ organization_id,
 * livewhale_group, match_method, score }] }) linking org ids to LiveWhale
 * publisher groups. Build a normalized group → org lookup so events can be
 * attributed to an org by their `group` field; when two mappings claim the
 * same group, the higher score wins. READ-ONLY: this package never writes
 * into db/seeds. Missing file → empty map (org_id stays null until the
 * ingestion lane lands); a present-but-malformed file throws so schema drift
 * fails the run loudly instead of silently dropping attribution.
 */
export function loadOrgGroups(file: string = ORG_GROUPS_FILE): OrgByGroup {
  if (!existsSync(file)) return new Map();
  const sidecar = OrgLivewhaleGroupsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const byGroup = new Map<string, string>();
  const bestScore = new Map<string, number>();
  for (const { organization_id, livewhale_group, score } of sidecar.mappings) {
    const key = groupKey(livewhale_group);
    const best = bestScore.get(key);
    if (best === undefined || score > best) {
      byGroup.set(key, organization_id);
      bestScore.set(key, score);
    }
  }
  return byGroup;
}
