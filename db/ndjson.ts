/**
 * Shared NDJSON reading for the seed loader (seed.ts) and the offline seed QA
 * sweep (seed-check.ts): both must load artifacts through the exact same
 * contract validation, so a file the QA sweep passes is by construction a
 * file the loader accepts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

/**
 * Read + validate one NDJSON file, every line against `schema`. Returns null
 * when the file does not exist (seed not produced yet — ingestion runs on its
 * own clock); throws with `<basename>:<line>` context on the first malformed
 * or contract-violating line — half-valid seeds never load.
 */
export async function readNdjsonFile<S extends z.ZodType>(
  filePath: string,
  schema: S,
): Promise<z.infer<S>[] | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const label = path.basename(filePath);
  const rows: z.infer<S>[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (e) {
      throw new Error(`${label}:${i + 1}: not valid JSON — ${(e as Error).message}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`${label}:${i + 1}: contract violation — ${parsed.error.message}`);
    }
    rows.push(parsed.data);
  }
  return rows;
}
