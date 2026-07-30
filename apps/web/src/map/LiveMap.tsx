import type { EventOut } from "@brownsync/contract";
import type { Map as MaplibreMap } from "maplibre-gl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCategoryFilter } from "../browse/filter";
import { useEventsWindow, useMeetingsInSession } from "../data/queries";
import { EmptyEvents } from "../ops/states/empty";
import { ErrorState } from "../ops/states/error";
import { EventDetailPanel } from "../panels/EventDetailPanel";
import { EventHoverCard } from "../panels/EventHoverCard";
import { HappeningNow } from "../panels/HappeningNow";
import { LayerPanel } from "../panels/LayerPanel";
import { CampusAmenityLayers } from "./CampusAmenityLayers";
import { CampusBuildingLayers } from "./CampusBuildingLayers";
import { CampusLandmarkLayers } from "./CampusLandmarkLayers";
import { flyToTarget } from "./camera";
import type { AmenityKind } from "./campusAmenities";
import { aggregateMeetingActivity, totalMeetingCount } from "./classesLayer";
import { DaylightLayer } from "./DaylightLayer";
import { type EventHover, EventLayers } from "./EventLayers";
import {
  eventsInWindow,
  eventsToGeoJSON,
  filterByToggles,
  type LayerToggles,
  pulsePositions,
} from "./eventsLayer";
import { amenityKindsFor } from "./layerRegistry";
import { MapView } from "./MapView";
import { usePulseOverlay } from "./pulse";
import { useLayerState } from "./useLayerState";

const NO_PULSE: [number, number][] = [];

export type LiveMapProps = {
  /** Integration seam: the raw map once loaded (viewport sync, external flyTo). */
  onMapChange?: (map: MaplibreMap) => void;
  /** Open this event's detail panel — the ⌘K palette navigates to `/?event=<id>`. */
  externalEventId?: string | null;
  /** Called when an externally-opened panel closes, to clear `?event=`. */
  onExternalEventClear?: () => void;
  /** Split-pane list (lane H) — receives the panel opener (select + flyTo). */
  renderList?: (openEvent: (event: EventOut) => void) => ReactNode;
};

/**
 * The default screen (§3.1): full-bleed live map — GPU event layers,
 * classes-in-session building fill, the ≤30-min pulse, hover cards, the
 * right slide-over detail panel (state-driven, no route) and the left layer
 * rail. Time flows in exclusively through the cursor seam (data/cursor.ts);
 * the category-chip URL state (lane H, `?cats=`) filters the event layers.
 */
export function LiveMap({
  onMapChange,
  externalEventId,
  onExternalEventClear,
  renderList,
}: LiveMapProps = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  // Layer visibility lives in the URL (`?layers=`), so a link carries the
  // map someone is actually looking at. The three event toggles are derived
  // from it rather than duplicated in local state.
  const layers = useLayerState();
  const toggles: LayerToggles = useMemo(
    () => ({
      events: layers.state.events,
      classes: layers.state.classes,
      athletics: layers.state.athletics,
    }),
    [layers.state],
  );
  const amenityKinds = useMemo(
    () => amenityKindsFor(layers.state) as AmenityKind[],
    [layers.state],
  );
  const [hover, setHover] = useState<EventHover | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSeed, setSelectedSeed] = useState<EventOut | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const eventsQuery = useEventsWindow();
  const meetingsQuery = useMeetingsInSession();
  const cursor = eventsQuery.cursor;

  // Time-window pass, then the header chips' ?cats= filter (lane H, shared
  // with the list via the URL), then the rail's category split.
  const inWindow = useMemo(
    () => eventsInWindow(eventsQuery.data ?? [], cursor),
    [eventsQuery.data, cursor],
  );
  const { selected: selectedCats } = useCategoryFilter();
  const catFiltered = useMemo(
    () =>
      selectedCats.length === 0
        ? inWindow
        : inWindow.filter((e) => selectedCats.includes(e.category)),
    [inWindow, selectedCats],
  );
  const visible = useMemo(() => filterByToggles(catFiltered, toggles), [catFiltered, toggles]);
  const geojson = useMemo(() => eventsToGeoJSON(visible, cursor), [visible, cursor]);
  const eventsById = useMemo(() => new Map(visible.map((e) => [e.id, e])), [visible]);

  const pulse = useMemo(() => pulsePositions(visible, cursor), [visible, cursor]);
  usePulseOverlay(pulse.length > 0 ? pulse : NO_PULSE);

  const activities = useMemo(
    () => aggregateMeetingActivity(meetingsQuery.data ?? []),
    [meetingsQuery.data],
  );

  const counts = useMemo(
    () => ({
      events: inWindow.filter((e) => e.category !== "athletics").length,
      athletics: inWindow.filter((e) => e.category === "athletics").length,
      classes: totalMeetingCount(activities),
    }),
    [inWindow, activities],
  );

  const handleMapLoad = useCallback(
    (m: MaplibreMap) => {
      setMap(m);
      onMapChange?.(m);
    },
    [onMapChange],
  );

  const handleSelect = useCallback(
    (event: EventOut) => {
      setSelectedId(event.id);
      setSelectedSeed(event);
      setPanelOpen(true);
      setHover(null);
      if (map && event.lng !== null && event.lat !== null) {
        flyToTarget(map, { lng: event.lng, lat: event.lat });
      }
    },
    [map],
  );

  // External opens (⌘K palette → /?event=<id>): open once per id — the ref
  // guard keeps data refetches from re-opening a panel the user closed.
  const handledExternalRef = useRef<string | null>(null);
  const events = eventsQuery.data;
  useEffect(() => {
    if (!externalEventId || handledExternalRef.current === externalEventId) return;
    handledExternalRef.current = externalEventId;
    const seed = events?.find((e) => e.id === externalEventId) ?? null;
    setSelectedId(externalEventId);
    setSelectedSeed(seed);
    setPanelOpen(true);
    setHover(null);
    if (map && seed && seed.lng !== null && seed.lat !== null) {
      flyToTarget(map, { lng: seed.lng, lat: seed.lat });
    }
  }, [externalEventId, events, map]);

  const containerWidth = containerRef.current?.clientWidth ?? 1280;
  const containerHeight = containerRef.current?.clientHeight ?? 800;
  const showEmpty = !eventsQuery.isPending && !eventsQuery.isError && inWindow.length === 0;

  return (
    <div className="flex h-full w-full">
      <div ref={containerRef} className="relative h-full min-w-0 grow">
        <MapView onMapLoad={handleMapLoad}>
          <EventLayers
            data={geojson}
            eventsById={eventsById}
            onHover={setHover}
            onSelect={handleSelect}
          />
          <CampusLandmarkLayers enabled={layers.state.greens} />
          <DaylightLayer />
          <CampusBuildingLayers
            enabled={layers.state.buildings}
            activities={activities}
            classesEnabled={toggles.classes}
          />
          <CampusAmenityLayers kinds={amenityKinds} />
        </MapView>

        <LayerPanel
          state={layers.state}
          onToggle={layers.toggle}
          onReset={layers.reset}
          isModified={layers.isModified}
          counts={counts}
        />

        {/* Bottom-left, opposite the layer panel: what is actually running
            right now. Rows open the same detail panel a map dot does. */}
        <HappeningNow onSelect={handleSelect} />

        {eventsQuery.isPending && (
          <output
            aria-live="polite"
            className="absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-4 border border-line bg-bg-raised px-3 py-1.5 font-mono text-12 text-text-secondary"
          >
            Loading events…
          </output>
        )}

        {eventsQuery.isError && (
          <div className="absolute bottom-8 left-1/2 z-20 w-80 -translate-x-1/2">
            <ErrorState
              what="events"
              bordered
              keptLastGood={(eventsQuery.data?.length ?? 0) > 0}
              onRetry={() => void eventsQuery.refetch()}
            />
          </div>
        )}

        {showEmpty && (
          <div className="absolute bottom-8 left-1/2 z-20 w-80 -translate-x-1/2 rounded-6 border border-line bg-bg-raised">
            <EmptyEvents />
          </div>
        )}

        {hover && !panelOpen && (
          <EventHoverCard
            event={hover.event}
            x={hover.x}
            y={hover.y}
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            cursor={cursor}
          />
        )}

        <EventDetailPanel
          open={panelOpen}
          onOpenChange={(open) => {
            setPanelOpen(open);
            if (!open) {
              setSelectedId(null);
              handledExternalRef.current = null;
              if (externalEventId) onExternalEventClear?.();
            }
          }}
          eventId={selectedId}
          seed={selectedSeed}
          cursor={cursor}
        />
      </div>

      {renderList && (
        <aside className="hidden h-full w-[380px] shrink-0 border-l border-line md:block">
          {renderList(handleSelect)}
        </aside>
      )}
    </div>
  );
}
