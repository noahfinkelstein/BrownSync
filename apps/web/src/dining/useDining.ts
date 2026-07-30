import { useQuery } from "@tanstack/react-query";
import { DAILY_ARTIFACT_QUERY_OPTIONS } from "../data/artifacts";
import type { DiningDocument } from "./model";

export const DINING_DATA_URL = "/data/dining-menus.json";

/**
 * The daily dining artifact.
 *
 * A static asset, not an API route: Brown OIT's service bus sends no CORS
 * header, so the browser cannot reach it directly, and proxying it per visitor
 * would turn one polite daily request into thousands (gate G4). The Python
 * `dining` job fetches it once a day and publishes this file.
 *
 * The shared daily-artifact policy keeps a mounted tab current while bounding
 * focus/interval checks to one request per hour.
 */
export function useDining() {
  return useQuery({
    queryKey: ["dining"] as const,
    queryFn: async (): Promise<DiningDocument> => {
      const response = await fetch(DINING_DATA_URL);
      if (!response.ok) {
        throw new Error(`dining menus: ${response.status}`);
      }
      return (await response.json()) as DiningDocument;
    },
    ...DAILY_ARTIFACT_QUERY_OPTIONS,
  });
}
