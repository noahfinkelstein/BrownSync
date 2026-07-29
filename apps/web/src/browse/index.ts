/**
 * Lane H public surface — browse & search. Integration (per handoff §2 H):
 *   header slots:  <SearchTrigger onSelectEvent={openPanel} />
 *                  <CategoryChips counts={countsByCategory} />
 *   split pane:    <ListView viewport={source} onSelectEvent={openPanel} />
 *   map wiring:    const source = createViewportSource(); map.on("moveend",
 *                  () => source.set([w, s, e, n]))
 *   map filters:   useCategoryFilter() (or parseCats on location.search.cats)
 */

export { CategoryChips, type CategoryChipsProps } from "./CategoryChips";
export { CATS_PARAM, parseCats, serializeCats, useCategoryFilter } from "./filter";
export { formatClock, formatDayLabel, formatDayTime, formatRelative } from "./format";
export {
  BUCKET_LABELS,
  bucketOf,
  groupEventsByTime,
  isLive,
  type TimeBucket,
  type TimeBucketId,
} from "./grouping";
export { ListView, type ListViewProps } from "./ListView";
export { SearchPalette, type SearchPaletteProps } from "./SearchPalette";
export { SearchTrigger, type SearchTriggerProps } from "./SearchTrigger";
export { useBrowseEvents } from "./useBrowseEvents";
export {
  type Bbox,
  bboxParam,
  createViewportSource,
  FULL_CAMPUS_BBOX,
  fullCampusViewport,
  useViewportBbox,
  type ViewportSource,
} from "./viewport";
