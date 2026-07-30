import { Layer, Source } from "react-map-gl/maplibre";
import {
  AMENITY_BEFORE_ID,
  AMENITY_DATA_URL,
  AMENITY_SOURCE_ID,
  type AmenityKind,
  amenityDotsLayer,
  amenityLabelsLayer,
} from "./campusAmenities";

/**
 * Campus amenity points, filtered to the kinds the layer panel has enabled.
 *
 * The Source stays mounted even when nothing is enabled (the filter resolves
 * to a constant `false`): unmounting it would make MapLibre drop and re-parse
 * the 226 KB artifact on every toggle, so the first amenity a user turns on
 * would always pop in late.
 */
export function CampusAmenityLayers({ kinds }: { kinds: readonly AmenityKind[] }) {
  return (
    <Source id={AMENITY_SOURCE_ID} type="geojson" data={AMENITY_DATA_URL}>
      <Layer {...amenityDotsLayer(kinds)} beforeId={AMENITY_BEFORE_ID} />
      <Layer {...amenityLabelsLayer(kinds)} beforeId={AMENITY_BEFORE_ID} />
    </Source>
  );
}
