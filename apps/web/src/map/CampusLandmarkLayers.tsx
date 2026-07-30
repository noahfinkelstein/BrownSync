import { Layer, Source } from "react-map-gl/maplibre";
import {
  LANDMARK_DATA_URL,
  LANDMARK_FILL_BEFORE_ID,
  LANDMARK_LABEL_BEFORE_ID,
  LANDMARK_SOURCE_ID,
  landmarkFieldLayer,
  landmarkGreenLayer,
  landmarkLabelLayer,
  landmarkOutlineLayer,
} from "./campusLandmarks";

/**
 * Campus greens, quads and athletic fields. Fills sit beneath the buildings
 * (they are ground); labels sit with the other campus labels.
 *
 * No feature-state and no interaction, so unlike the buildings this needs no
 * `promoteId` and no index — it is purely cartographic.
 */
export function CampusLandmarkLayers({ enabled = true }: { enabled?: boolean }) {
  return (
    <Source id={LANDMARK_SOURCE_ID} type="geojson" data={LANDMARK_DATA_URL}>
      <Layer {...landmarkGreenLayer(enabled)} beforeId={LANDMARK_FILL_BEFORE_ID} />
      <Layer {...landmarkFieldLayer(enabled)} beforeId={LANDMARK_FILL_BEFORE_ID} />
      <Layer {...landmarkOutlineLayer(enabled)} beforeId={LANDMARK_LABEL_BEFORE_ID} />
      <Layer {...landmarkLabelLayer(enabled)} beforeId={LANDMARK_LABEL_BEFORE_ID} />
    </Source>
  );
}
