import type { OrgLivewhaleGroups } from "@brownsync/contract";
import { groupKey } from "./categories";
import type { OrgByGroup } from "./normalize";

/**
 * Sidecar → normalized group → org lookup, pure so both runtimes share it.
 * The ingestion lane emits db/seeds/organization_livewhale_groups.json
 * ({ schema_version: 1, generated_at, mappings: [{ organization_id,
 * livewhale_group, match_method, score }] }) linking org ids to LiveWhale
 * publisher groups; events are attributed to an org by their `group` field.
 * When two mappings claim the same group, the higher score wins.
 *
 * READING the sidecar is runtime-specific and stays out of here: the Node CLI
 * loads it from db/seeds with fs (services/poller/src/livewhale/orgs.ts), the
 * Worker bundles the JSON at build time (apps/api/src/schedule/).
 */
export function orgGroupsFromSidecar(sidecar: OrgLivewhaleGroups): OrgByGroup {
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
