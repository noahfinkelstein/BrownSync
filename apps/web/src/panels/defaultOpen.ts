/**
 * Should a map overlay panel mount expanded?
 *
 * Desktop: yes — the map has room and the panels are the point. Below md
 * (768 px, Tailwind's breakpoint) they mount collapsed: the UI audit found
 * LayerPanel + HappeningNow expanded together covered ~45% of a 375 px map.
 *
 * A mount-time read, not a live media query, on purpose: a panel snapping
 * shut because the user rotated their phone would throw away their toggle.
 * jsdom has no matchMedia, so tests get the desktop default.
 */
export function panelStartsOpen(): boolean {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? true
    : window.matchMedia("(min-width: 768px)").matches;
}
