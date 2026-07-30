import { z } from "zod";

/**
 * Category taxonomy — DATA_CONTRACT.md §4. Fixed set; both ingestion and
 * frontend use exactly these. Changing this file requires a contract
 * version bump (contract header rule).
 */
export const CATEGORY_IDS = [
  "academic",
  "class",
  "club",
  "arts",
  "athletics",
  "food",
  "social",
  "career",
  "wellness",
  "admin",
] as const;

export type Category = (typeof CATEGORY_IDS)[number];

export const CategorySchema = z.enum(CATEGORY_IDS).meta({ id: "Category" });

export type CategoryMeta = {
  id: Category;
  label: string;
  /** Icon slug per contract §4; sprite drawn in @brownsync/ui. */
  icon: `icon-${Category}`;
  /** CSS custom property name. */
  colorToken: `--cat-${Category}`;
  /**
   * Chroma-matched OKLCH (L 0.72, C 0.09) rendered to sRGB hex, tuned for the
   * dark basemap per handoff §6.1. Hand-check against basemap in Phase 1 D.
   */
  colorHex: string;
  /** OKLCH hue in degrees, kept for regeneration/tuning. */
  hue: number;
};

export const CATEGORIES: readonly CategoryMeta[] = [
  {
    id: "academic",
    label: "Academic",
    icon: "icon-academic",
    colorToken: "--cat-academic",
    colorHex: "#1378ce",
    hue: 245,
  },
  {
    id: "class",
    label: "Class",
    icon: "icon-class",
    colorToken: "--cat-class",
    colorHex: "#147ea6",
    hue: 225,
  },
  {
    id: "club",
    label: "Club",
    icon: "icon-club",
    colorToken: "--cat-club",
    colorHex: "#1e8573",
    hue: 180,
  },
  {
    id: "arts",
    label: "Arts",
    icon: "icon-arts",
    colorToken: "--cat-arts",
    colorHex: "#8742d7",
    hue: 305,
  },
  {
    id: "athletics",
    label: "Athletics",
    icon: "icon-athletics",
    colorToken: "--cat-athletics",
    colorHex: "#df323e",
    hue: 15,
  },
  {
    id: "food",
    label: "Food",
    icon: "icon-food",
    colorToken: "--cat-food",
    colorHex: "#966e1d",
    hue: 85,
  },
  {
    id: "social",
    label: "Social",
    icon: "icon-social",
    colorToken: "--cat-social",
    colorHex: "#d3348d",
    hue: 345,
  },
  {
    id: "career",
    label: "Career",
    icon: "icon-career",
    colorToken: "--cat-career",
    colorHex: "#19828d",
    hue: 205,
  },
  {
    id: "wellness",
    label: "Wellness",
    icon: "icon-wellness",
    colorToken: "--cat-wellness",
    colorHex: "#2c862e",
    hue: 145,
  },
  {
    id: "admin",
    label: "Admin",
    icon: "icon-admin",
    colorToken: "--cat-admin",
    colorHex: "#3451e4",
    hue: 275,
  },
] as const;

export const CATEGORY_BY_ID: Readonly<Record<Category, CategoryMeta>> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<Category, CategoryMeta>;

/** places.kind — contract §1. */
export const PLACE_KINDS = [
  "academic",
  "residence",
  "dining",
  "athletic",
  "library",
  "admin",
  "outdoor",
  "other",
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PlaceKindSchema = z.enum(PLACE_KINDS).meta({ id: "PlaceKind" });

/** organizations.kind — contract §1. */
export const ORG_KINDS = ["club", "department", "office", "athletics", "external"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export const OrgKindSchema = z.enum(ORG_KINDS).meta({ id: "OrgKind" });
