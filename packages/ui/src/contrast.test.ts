import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * §6.1 WCAG AA enforcement for the design system itself — the component mirror
 * of apps/web/test/a11y-contrast.test.ts, which owns the arithmetic. This file
 * owns the *source scans*: the failures here are classes that compile fine,
 * render fine, and are simply illegible.
 */

const SRC_ROOT = dirname(fileURLToPath(import.meta.url));

/** Every shipped .ts/.tsx under src/, minus the suites themselves. */
function shippedSources(): { path: string; rel: string; text: string }[] {
  const found: { path: string; rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      found.push({ path, rel: path.slice(SRC_ROOT.length + 1), text: readFileSync(path, "utf8") });
    }
  };
  walk(SRC_ROOT);
  return found;
}

/**
 * `--text-faint` (#8C8078) lands 3.84:1 on bg-base, 3.56:1 on bg-raised and
 * 3.26:1 on bg-overlay: below AA 4.5:1 for text of EVERY size in the §6.2
 * scale, and below even the 3:1 non-text bar on overlay. It is therefore banned
 * as a text/icon COLOR in shipped components (TimelineRow sub, DataTable cells,
 * EmptyState body/icon, StatusDot detail, Kbd, Chip count, SearchInput
 * placeholder/glyph/clear, SegmentedControl inactive labels all sit on
 * --text-secondary). The token itself stays, and the light theme leans on it
 * HARDER than the dark one did: --line is a 1.4:1 whisper against white, so
 * faint is the only hairline strong enough to carry structure (the DataTable
 * header rule, Scrubber geometry). Usage as a BORDER or a BACKGROUND stays
 * legitimate, as does the dev gallery (dev/ shows tokens qua tokens).
 */
describe("--text-faint is not a text color in shipped components", () => {
  it("regression scan: no text-painting text-faint utility in packages/ui/src", () => {
    const offenders: string[] = [];
    for (const { rel, text } of shippedSources()) {
      // Text-painting utilities only; border-text-faint / bg-* stay legal.
      if (/(?:^|[^-\w])text-text-faint|placeholder:text-text-faint/.test(text)) {
        offenders.push(rel);
      }
      // Inline style fallbacks that would paint TEXT faint (color: var(--text-faint)).
      if (/color:\s*["']?var\(--text-faint\)/.test(text)) {
        offenders.push(`${rel} (inline style)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The status ramp is a DOT ramp. Re-derived for white it sits at 3.8 – 4.6:1:
 * fine for StatusDot's 6px disc (WCAG 1.4.11 wants 3:1), and under AA for text
 * on any surface except `--bg-base` — where `--status-error` scrapes past by
 * 0.003:1, which is a coincidence, not a guarantee. Concretely: a 12px
 * `text-status-error` line inside a Panel (`--bg-raised`) is 4.17:1, and inside
 * a card (`--bg-overlay`) 3.83:1.
 *
 * StatusDot paints the ramp through inline `background`, never `color`, so this
 * scan is green today; it exists so that the next person who needs red error
 * copy reaches for `--text-primary` or `--accent` beside a dot instead of
 * reaching for the dot's own color.
 */
describe("the status ramp never paints text in shipped components", () => {
  it("regression scan: no text-status-* utility in packages/ui/src", () => {
    const offenders: string[] = [];
    for (const { rel, text } of shippedSources()) {
      if (/(?:^|[^-\w])text-status-(?:ok|stale|error)\b/.test(text)) offenders.push(rel);
      if (/color:\s*["']?var\(--status-(?:ok|stale|error)\)/.test(text)) {
        offenders.push(`${rel} (inline style)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually finds a violation when one exists", () => {
    // A scan whose regex silently stopped matching passes forever. Prove the
    // pattern fires on the exact string it is meant to catch.
    expect(
      /(?:^|[^-\w])text-status-(?:ok|stale|error)\b/.test('className="text-status-error"'),
    ).toBe(true);
    // ...and does not fire on the legal neighbours it must tolerate.
    expect(/(?:^|[^-\w])text-status-(?:ok|stale|error)\b/.test('className="bg-status-error"')).toBe(
      false,
    );
  });
});

/**
 * Alpha steps are a dark-theme idiom. `bg-x/60` composites toward the PAGE, so
 * on a near-black background every fade darkened (read: receded, correctly) and
 * on paper every fade lightens — a hover that washes out, a press that gets
 * brighter than its rest state, a skeleton that disappears mid-pulse.
 *
 * Solid tokens and explicit `color-mix(… , var(--text-primary))` steps replaced
 * them in Button, IconButton, DataTable and TimelineRow. This pins the
 * inversion so it cannot come back by copy-paste from an old branch.
 */
describe("interactive surfaces do not signal state with alpha on a light page", () => {
  const BANNED = [
    // hover/active fills that fade a surface toward white
    /(?:hover|active|focus|focus-visible):bg-(?:bg-base|bg-raised|bg-overlay|line|accent)\/\d+/,
    // row rules and hairlines faded to invisibility
    /(?:hover|active):border-(?:line|text-faint)\/\d+/,
  ] as const;

  it("no hover/active state uses a faded token fill", () => {
    const offenders: string[] = [];
    for (const { rel, text } of shippedSources()) {
      for (const pattern of BANNED) {
        const hit = text.match(pattern);
        if (hit) offenders.push(`${rel} → ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually finds a violation when one exists", () => {
    expect(BANNED[0].test("active:bg-bg-overlay/70")).toBe(true);
    expect(BANNED[0].test("hover:bg-bg-overlay")).toBe(false);
  });
});
