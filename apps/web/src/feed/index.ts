/**
 * The unified campus feed: pure model, no React.
 *
 * `model` owns the shapes and the three adapters; `rank` owns the scoring and
 * the diversity rules. Consumers should import from here so the split can move
 * without touching call sites.
 */

export { FeedPanel, PUBLICATIONS_DATA_URL } from "./FeedPanel";
export * from "./model";
export * from "./rank";
