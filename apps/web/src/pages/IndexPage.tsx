import { useLocation, useNavigate } from "@tanstack/react-router";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useCallback, useState } from "react";
import { CategoryChips } from "../browse/CategoryChips";
import { ListView } from "../browse/ListView";
import { createViewportSource } from "../browse/viewport";
import { useCursorDate } from "../data/cursor";
import { LiveMap } from "../map/LiveMap";

/**
 * The composed index screen (integration): lane F's live map with lane H's
 * viewport-synced list as the split pane (§3.2). The map feeds the list
 * through H's ViewportSource seam (`moveend` → bbox); list rows open F's
 * detail panel + flyTo; ⌘K event hits arrive as `/?event=<id>` (H's palette
 * default) and are consumed here. The list re-groups off lane G's cursor.
 */
export function IndexPage() {
  const [viewport] = useState(() => createViewportSource());
  const { cursor } = useCursorDate();
  const navigate = useNavigate();
  const search = useLocation({ select: (loc) => loc.search }) as Record<string, unknown>;
  const rawEvent = search.event;
  const eventId = typeof rawEvent === "string" && rawEvent !== "" ? rawEvent : null;

  const handleMapChange = useCallback(
    (map: MaplibreMap) => {
      const sync = () => {
        const b = map.getBounds();
        viewport.set([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      map.on("moveend", sync);
      sync();
    },
    [viewport],
  );

  const clearEventParam = useCallback(() => {
    void navigate({
      to: ".",
      replace: true,
      resetScroll: false,
      search: (prev: Record<string, unknown>) => ({ ...prev, event: undefined }),
    } as never);
  }, [navigate]);

  return (
    <LiveMap
      onMapChange={handleMapChange}
      externalEventId={eventId}
      onExternalEventClear={clearEventParam}
      renderList={(openEvent) => (
        <div className="flex h-full min-h-0 flex-col bg-bg-raised">
          {/* SLOT:chips (relocated from the header — see panels/Header.tsx): the
              taxonomy filter rides atop the list it filters; ?cats= also drives
              the map layers via useCategoryFilter in LiveMap. */}
          <div className="shrink-0 border-b border-line px-3 py-2">
            <CategoryChips />
          </div>
          <ListView
            className="min-h-0 grow"
            viewport={viewport}
            now={() => cursor}
            onSelectEvent={openEvent}
          />
        </div>
      )}
    />
  );
}
