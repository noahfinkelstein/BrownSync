import { OrgDetailOutSchema, OrgOutSchema } from "@brownsync/contract";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getJson, retryUnlessNotFound } from "./search";

/** Org data hooks (lane H) — contract §3. */

const OrgsEnvelope = z.object({ orgs: z.array(OrgOutSchema) });

/** GET /api/orgs — all organizations, name-sorted. */
export function useOrgs() {
  return useQuery({
    queryKey: ["orgs"],
    queryFn: () => getJson("/api/orgs", OrgsEnvelope),
    staleTime: 5 * 60_000,
    retry: retryUnlessNotFound,
    select: (d) => d.orgs,
  });
}

/** GET /api/orgs/:id — one org with `upcoming` and `past` events expanded. */
export function useOrg(id: string) {
  return useQuery({
    queryKey: ["org", id],
    queryFn: () => getJson(`/api/orgs/${encodeURIComponent(id)}`, OrgDetailOutSchema),
    enabled: id !== "",
    retry: retryUnlessNotFound,
  });
}
