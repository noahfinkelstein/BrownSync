/**
 * Design tokens — handoff §6.1.
 *
 * **Light theme on Brown's own palette** (2026-07-29). The v1 dark theme read
 * as a utility dashboard; this is a student-facing product that has to look
 * inviting next to studentactivities.brown.edu, so the chrome is white/warm
 * paper with Brown's seal brown for structure and Brown red for action.
 *
 * Every value below is measured, not picked. Contrast against all three
 * background levels is asserted in `apps/web/test/a11y-contrast.test.ts`;
 * the numbers in the comments are what that suite verifies.
 *
 * @brownsync/ui renders these as CSS custom properties; the map style and
 * deck.gl layers read them from here so cartography and UI stay in lockstep.
 */
export const tokens = {
  bg: {
    /** Page / deepest background. */
    base: "#FFFFFF",
    /** Panels, rails. Warm off-white — a neutral grey next to seal brown
     *  reads cold and slightly green. */
    raised: "#F8F6F3",
    /** Cards-within-panels, inputs, hover rows. */
    overlay: "#F0ECE6",
  },
  line: "#DFD8CF",
  text: {
    /** 17.9:1 on white. Warm near-black, not #000 — pure black on paper-white
     *  is harsh and fights the brown. */
    primary: "#1C1614",
    /** 7.8:1 on white. */
    secondary: "#5C5048",
    /** 3.8:1 — deliberately BELOW AA, and therefore banned for text. Ornament
     *  only: hairlines, tick marks, aria-hidden geometry. The ban is enforced
     *  by a source scan in a11y-contrast.test.ts. */
    faint: "#8C8078",
  },
  /**
   * Brown's institutional colours.
   *
   * `brown` is Brown University's Seal Brown, the documented primary. It
   * carries structural chrome — the header bar, footers, filled controls —
   * where the old theme used a background level.
   */
  brand: {
    /** 11.2:1 on white; white-on-brown is the same 11.2:1. */
    brown: "#4E3629",
    /** Warm tint of seal brown for large quiet fills. */
    brownSoft: "#6B4F3E",
    /**
     * Type and signal ON a seal-brown fill. A separate triad because the
     * page-level ones do not survive the trip: `text.primary` is near-black
     * (1.4:1 on brown) and — the one that actually bites — **Brown red on
     * seal brown is 1.73:1**, so the app's signal colour disappears exactly
     * where the header wants to put a live dot.
     */
    onBrown: "#FFFFFF",
    /** 6.8:1 on brown. */
    onBrownMuted: "#D6C8BC",
    /** 4.9:1 on brown. Same signal, lifted until it reads. */
    accentOnBrown: "#FF8A80",
  },
  /**
   * The single signal color: Brown red. ONLY for live/now indicators and
   * primary actions — never decorative. 6.4:1 on white, and 6.4:1 for white
   * text on a filled red button.
   */
  accent: "#C00404",
  /**
   * Cartography. The map is still a DARK surface inside light chrome — a
   * deliberate pairing, not an oversight. Inverting it means re-deriving the
   * campus material ramp, the daylight model and the label-contrast ceiling,
   * all of which are measured against dark surfaces; and a dark map is what
   * makes the category pins read as the brightest thing on screen, which is
   * the point of the map. Tracked as its own piece of work.
   */
  map: {
    road: "#1C222B",
    water: "#0D1319",
    green: "#131A16",
    /** Page-level frame the map sits in, so the seam reads intentional. */
    frame: "#2B211B",
    /**
     * MAP TYPOGRAPHY — its own triad, deliberately NOT the UI text tokens.
     *
     * The cartography layers used to read `tokens.text.*` for label colour and
     * `tokens.bg.base` for the halo. That worked only because the app and the
     * map were both dark. The moment the chrome went light, the map started
     * drawing near-black labels with a WHITE halo on a near-black basemap —
     * invisible, and the daylight contrast suite went red for the right
     * reason.
     *
     * The map is its own surface with its own background; its type has to be
     * pinned to that surface, not to the page. When the basemap is inverted
     * (see handoffs/CURSOR_LIGHT_CARTOGRAPHY.md) these three flip together and
     * nothing in the UI moves.
     */
    label: "#E8ECF1",
    labelMuted: "#8B94A3",
    labelHalo: "#0B0E12",
    /** Building outlines. Was `tokens.line`, which is now a light hairline
     *  and would draw as a bright cage around every footprint. */
    line: "#232A35",
  },
  radius: {
    /** Max radius anywhere in the app (px). */
    max: 6,
  },
  type: {
    /**
     * Only these sizes (px).
     *
     * Six tiers, not the original five. The 13 px body was the single most
     * common complaint about the v1 UI, and five tiers left no size between
     * a 18 px section head and a 24 px page title — so the feed, the header
     * and the detail panels all collapsed onto the same two sizes and read
     * as undifferentiated.
     *
     * 12 survives as a genuine caption/mono tier: IBM Plex Mono's x-height
     * carries 12 px where Instrument Sans does not, and every 12 px pairing
     * is contrast-audited in apps/web/test/a11y-contrast.test.ts.
     */
    scale: [12, 14, 16, 19, 24, 30],
    /** Default body size. `packages/ui/src/styles.css` sets it on `body`. */
    body: 14,
    /**
     * Line height per size (px), so the ramp is data rather than six
     * hand-written CSS declarations. Native clients read this too — a Swift
     * `Font` carries no line height, so `Tokens.swift` needs the number.
     *
     * Tightening as size grows (1.43 → 1.20) is deliberate: leading that
     * flatters a paragraph makes a 30 px title look unglued from its label.
     */
    lineHeights: { 12: 16, 14: 20, 16: 22, 19: 26, 24: 30, 30: 36 },
    display: '"Instrument Sans", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
  },
  motion: {
    /** Micro-transition bounds (ms), ease-out. */
    minMs: 120,
    maxMs: 160,
  },
} as const;

export type Tokens = typeof tokens;
