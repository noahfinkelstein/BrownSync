import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { OrgLivewhaleGroupsSchema } from "@brownsync/contract";
import { type OrgByGroup, orgGroupsFromSidecar } from "@brownsync/sources/livewhale/index";
import { SEEDS_DIR } from "../paths";

const ORG_GROUPS_FILE = path.join(SEEDS_DIR, "organization_livewhale_groups.json");

/**
 * fs half of the sidecar load — the group → org lookup itself is built by the
 * runtime-portable `orgGroupsFromSidecar` (packages/sources), which the Worker
 * dispatcher shares by bundling the same JSON at build time. READ-ONLY: this
 * package never writes into db/seeds. Missing file → empty map (org_id stays
 * null until the ingestion lane lands); a present-but-malformed file throws so
 * schema drift fails the run loudly instead of silently dropping attribution.
 */
export function loadOrgGroups(file: string = ORG_GROUPS_FILE): OrgByGroup {
  if (!existsSync(file)) return new Map();
  return orgGroupsFromSidecar(
    OrgLivewhaleGroupsSchema.parse(JSON.parse(readFileSync(file, "utf8"))),
  );
}
