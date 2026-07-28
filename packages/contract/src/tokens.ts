/**
 * Design tokens — handoff §6.1. One dark theme in MVP.
 * @brownsync/ui renders these as CSS custom properties; the map style and
 * deck.gl layers read them from here so cartography and UI stay in lockstep.
 */
export const tokens = {
  bg: {
    /** Page / deepest background. */
    base: "#0B0E12",
    /** Panels, rails. */
    raised: "#11151B",
    /** Cards-within-panels, inputs, hover rows. */
    overlay: "#171C24",
  },
  line: "#232A35",
  text: {
    primary: "#E8ECF1",
    secondary: "#8B94A3",
    faint: "#566070",
  },
  /**
   * The single signal color. ONLY for live/now indicators and primary
   * actions — never decorative.
   */
  accent: "#D96C3D",
  map: {
    road: "#1C222B",
    water: "#0D1319",
    green: "#131A16",
  },
  radius: {
    /** Max radius anywhere in the app (px). */
    max: 6,
  },
  type: {
    /** Only these sizes (px). */
    scale: [12, 13, 15, 18, 24],
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
