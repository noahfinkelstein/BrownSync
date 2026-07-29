import type { EventOut } from "@brownsync/contract";
import { Button, EmptyState } from "@brownsync/ui";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useCallback, useMemo, useRef, useState } from "react";
import { useEventsWindow, useMeetingsInSession } from "../data/queries";
import { EventDetailPanel } from "../panels/EventDetailPanel";
import { EventHoverCard } from "../panels/EventHoverCard";
import { LayerRail } from "../panels/LayerRail";
import { ClassActivityLayer } from "./ClassActivityLayer";
import { flyToTarget } from "./camera";
import { aggregateMeetingActivity, totalMeetingCount } from "./classesLayer";
import { type EventHover, EventLayers } from "./EventLayers";
import {
  eventsInWindow,
  eventsToGeoJSON,
  filterByToggles,
  type LayerToggles,
  pulsePositions,
} from "./eventsLayer";
import { MapView } from "./MapView";
import { usePulseOverlay } from "./pulse";

const NO_PULSE: [number, number][] = [];

/**
 * The default screen (§3.1): full-bleed live map — GPU event layers,
 * classes-in-session building fill, the ≤30-min pulse, hover cards, the
 * right slide-over detail panel (state-driven, no route) and the left layer
 * rail. Time flows in exclusively through the cursor seam (data/cursor.ts).
 */
export function LiveMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [toggles, setToggles] = useState<LayerToggles>({
    events: true,
    classes: true,
    athletics: true,
  });
  const [hover, setHover] = useState<EventHover | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSeed, setSelectedSeed] = useState<EventOut | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const eventsQuery = useEventsWindow();
  const meetingsQuery = useMeetingsInSession();
  const cursor = eventsQuery.cursor;

  // Time-window pass (all toggles), then the rail's category split.
  const inWindow = useMemo(
    () => eventsInWindow(eventsQuery.data ?? [], cursor),
    [eventsQuery.data, cursor],
  );
  const visible = useMemo(() => filterByToggles(inWindow, toggles), [inWindow, toggles]);
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

  const handleToggle = useCallback((layer: keyof LayerToggles) => {
    setToggles((t) => ({ ...t, [layer]: !t[layer] }));
  }, []);

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

  const containerWidth = containerRef.current?.clientWidth ?? 1280;
  const containerHeight = containerRef.current?.clientHeight ?? 800;
  const showEmpty = !eventsQuery.isPending && !eventsQuery.isError && inWindow.length === 0;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <MapView onMapLoad={setMap}>
        <EventLayers
          data={geojson}
          eventsById={eventsById}
          onHover={setHover}
          onSelect={handleSelect}
        />
        <ClassActivityLayer activities={activities} enabled={toggles.classes} />
      </MapView>

      <LayerRail toggles={toggles} onToggle={handleToggle} counts={counts} />

      {eventsQuery.isPending && (
        <output
          aria-live="polite"
          className="absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-4 border border-line bg-bg-raised px-3 py-1.5 font-mono text-12 text-text-secondary"
        >
          Loading events…
        </output>
      )}

      {eventsQuery.isError && (
        <div className="absolute bottom-8 left-1/2 z-20 w-80 -translate-x-1/2 rounded-6 border border-line bg-bg-raised">
          <EmptyState
            className="px-4 py-4"
            title="Event feed unreachable"
            body="The map is up, but events didn't load. The API may still be starting."
            action={<Button onClick={() => void eventsQuery.refetch()}>Retry</Button>}
          />
        </div>
      )}

      {showEmpty && (
        <output
          aria-live="polite"
          className="absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-4 border border-line bg-bg-raised px-3 py-1.5 font-mono text-12 text-text-secondary"
        >
          No events in this window — scrub forward or widen the time window
        </output>
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
          if (!open) setSelectedId(null);
        }}
        eventId={selectedId}
        seed={selectedSeed}
        cursor={cursor}
      />
    </div>
  );
}
