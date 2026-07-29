import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * §6.1 WCAG AA enforcement for the design system itself — the component
 * mirror of apps/web/test/a11y-contrast.test.ts. `--text-faint` (#566070)
 * lands ≈3.0:1 on bg-base and ≈2.7:1 on bg-overlay: below AA 4.5:1 for text
 * of EVERY size in the §6.2 scale, and below even the 3:1 non-text bar on
 * raised/overlay surfaces. It is therefore banned as a text/icon COLOR in
 * shipped components (Phase 3 pass: TimelineRow sub, DataTable headers,
 * EmptyState body/icon, StatusDot detail, Kbd, Chip count, SearchInput
 * placeholder/glyph/clear, SegmentedControl inactive labels all moved to
 * --text-secondary). The token itself stays: hairline borders, tick marks,
 * and other aria-hidden geometry (border-*, bg-*, focus-within:border-*)
 * remain legitimate, as does the dev gallery (dev/ shows tokens qua tokens).
 */
describe("--text-faint is not a text color in shipped components", () => {
  it("regression scan: no text-painting text-faint utility in packages/ui/src", () => {
    const srcRoot = dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const text = readFileSync(path, "utf8");
        // Text-painting utilities only; border-text-faint / bg-* stay legal.
        if (/(?:^|[^-\w])text-text-faint|placeholder:text-text-faint/.test(text)) {
          offenders.push(path.slice(srcRoot.length + 1));
        }
        // Inline style fallbacks that would paint TEXT faint (color: var(--text-faint)).
        if (/color:\s*["']?var\(--text-faint\)/.test(text)) {
          offenders.push(`${path.slice(srcRoot.length + 1)} (inline style)`);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
