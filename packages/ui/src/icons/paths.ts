import type { Category } from "@brownsync/contract";

/** All glyphs are drawn on a 16×16 grid. */
export const ICON_VIEWBOX = 16;

/** §6.2 — consistent 1.5px stroke, squared (butt) terminals, miter joins. */
export const ICON_STROKE_WIDTH = 1.5;

/**
 * The 10 category glyphs, hand-drawn as raw SVG path data — one family:
 * geometric construction only (lines, arcs), no fills, no rounded caps,
 * every coordinate placed so the 1.5px stroke stays inside the 16px box.
 *
 * Semantics:
 *  - academic   pediment + three columns (the campus-hall portico)
 *  - class      timetable grid with a header band
 *  - club       three joined nodes (people clustered around a thing)
 *  - arts       mitred picture frame, mat inside
 *  - athletics  pennant on a pole
 *  - food       bowl with squared steam ticks
 *  - social     two overlapping circles
 *  - career     square-cornered briefcase, clasp line through
 *  - wellness   pulse trace, hard peaks
 *  - admin      seal: circle around a diamond
 */
export const CATEGORY_ICON_PATHS: Record<Category, string> = {
  academic:
    "M2.4 5.85 L8 2.1 L13.6 5.85 M3.1 8 H12.9 M4.6 8 V12 M8 8 V12 M11.4 8 V12 M2.4 13.9 H13.6",
  class: "M2.2 2.8 H13.8 V13.2 H2.2 Z M2.2 6 H13.8 M6.1 6 V13.2 M9.9 6 V13.2 M2.2 9.6 H13.8",
  club: "M6.1 3.9 A1.9 1.9 0 1 0 9.9 3.9 A1.9 1.9 0 1 0 6.1 3.9 M2.1 12.1 A1.9 1.9 0 1 0 5.9 12.1 A1.9 1.9 0 1 0 2.1 12.1 M10.1 12.1 A1.9 1.9 0 1 0 13.9 12.1 A1.9 1.9 0 1 0 10.1 12.1 M6.9 6.15 L5.1 9.85 M9.1 6.15 L10.9 9.85 M6.5 12.1 H9.5",
  arts: "M2.6 2.6 H13.4 V13.4 H2.6 Z M5.9 5.9 H10.1 V10.1 H5.9 Z M2.6 2.6 L5.9 5.9 M13.4 2.6 L10.1 5.9 M13.4 13.4 L10.1 10.1 M2.6 13.4 L5.9 10.1",
  athletics: "M3.4 2.2 V13.8 M4.15 3.2 L13.2 5.7 L4.15 8.2 Z",
  food: "M2.2 7.8 H13.8 M3 7.8 A5 5 0 0 0 13 7.8 M6.2 2.6 V4.9 M9.8 2.6 V4.9",
  social:
    "M1.95 8 A3.9 3.9 0 1 0 9.75 8 A3.9 3.9 0 1 0 1.95 8 M6.25 8 A3.9 3.9 0 1 0 14.05 8 A3.9 3.9 0 1 0 6.25 8",
  career: "M2.2 5.6 H13.8 V13.1 H2.2 Z M5.9 5.6 V3.3 H10.1 V5.6 M2.2 8.9 H13.8",
  wellness: "M1.4 8.6 H4.4 L6.4 4.2 L9.6 12.4 L11.6 8.6 H14.6",
  admin: "M2.3 8 A5.7 5.7 0 1 0 13.7 8 A5.7 5.7 0 1 0 2.3 8 M8 4.9 L11.1 8 L8 11.1 L4.9 8 Z",
};
