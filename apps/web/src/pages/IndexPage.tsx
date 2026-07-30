import { SegmentedControl } from "@brownsync/ui";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useCallback, useEffect, useState } from "react";
import { CategoryChips } from "../browse/CategoryChips";
import { ListView } from "../browse/ListView";
import { createViewportSource } from "../browse/viewport";
import { useCursorDate } from "../data/cursor";
import { DiningPanel } from "../dining";
import { FeedPanel } from "../feed";
import { flyToTarget } from "../map/camera";
import { LiveMap } from "../map/LiveMap";
import { parseLl } from "./PlaceMiniMap";

/**
 * The composed index screen (integration): lane F's live map with lane H's
 * viewport-synced list as the split pane (§3.2). The map feeds the list
 * through H's ViewportSource seam (`moveend` → bbox); list rows open F's
 * detail panel + flyTo; ⌘K event hits arrive as `/?event=<id>` (H's palette
 * default) and are consumed here. The list re-groups off lane G's cursor.
 */
type PaneTab = "feed" | "events" | "dining";

/** Feed leads and is the default: the unified "what is happening at Brown"
 *  list is what this site is FOR. Events and Dining are the drill-downs. */
const PANE_TABS = [
  { value: "feed", label: "Feed" },
  { value: "events", label: "Events" },
  { value: "dining", label: "Dining" },
] as const;

export function IndexPage() {
  const [viewport] = useState(() => createViewportSource());
  const [tab, setTab] = useState<PaneTab>("feed");
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const { cursor } = useCursorDate();
  const navigate = useNavigate();
  const search = useLocation({ select: (loc) => loc.search }) as Record<string, unknown>;
  const rawEvent = search.event;
  const eventId = typeof rawEvent === "string" && rawEvent !== "" ? rawEvent : null;
  const rawLl = search.ll;

  const handleMapChange = useCallback(
    (m: MaplibreMap) => {
      setMap(m);
      const sync = () => {
        const b = m.getBounds();
        viewport.set([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      };
      m.on("moveend", sync);
      sync();
    },
    [viewport],
  );

  // Place mini-map click-through (`/?ll=lat,lng`): land the live map on the
  // place, then drop the param so back/reload doesn't re-fly. The fly is
  // retried: right at `load` the react-map-gl wrapper can still be mid
  // (re)attach (StrictMode recycles the instance) and a camera event fired
  // then explodes inside its handlers — so swallow and try again shortly.
  const clearLlParam = useCallback(() => {
    void navigate({
      to: ".",
      replace: true,
      resetScroll: false,
      search: (prev: Record<string, unknown>) => ({ ...prev, ll: undefined }),
    } as never);
  }, [navigate]);
  useEffect(() => {
    if (!map || rawLl == null) return;
    const target = parseLl(rawLl);
    if (!target) {
      clearLlParam(); // junk param — drop it, no fly
      return;
    }
    let done = false;
    let attempts = 0;
    const stopTimer = () => clearInterval(timer);
    const tryFly = (): void => {
      if (done) return;
      attempts += 1;
      try {
        flyToTarget(map, { lng: target.lng, lat: target.lat });
        done = true;
      } catch {
        if (attempts < 40) return; // not attached yet — next tick
        done = true; // give up on the fly but still clean the URL
      }
      stopTimer();
      map.off("idle", tryFly);
      clearLlParam();
    };
    const timer = setInterval(tryFly, 250);
    map.once("idle", tryFly);
    tryFly();
    return () => {
      stopTimer();
      map.off("idle", tryFly);
    };
  }, [map, rawLl, clearLlParam]);

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
          <div className="shrink-0 border-b border-line px-3 py-2">
            <SegmentedControl
              options={PANE_TABS}
              value={tab}
              onValueChange={setTab}
              aria-label="Right pane"
            />
          </div>
          {tab === "events" ? (
            <>
              {/* SLOT:chips (relocated from the header — see panels/Header.tsx):
                  the taxonomy filter rides atop the list it filters; ?cats=
                  also drives the map layers via useCategoryFilter in LiveMap. */}
              <div className="shrink-0 border-b border-line px-3 py-2">
                <CategoryChips />
              </div>
              <ListView
                className="min-h-0 grow"
                viewport={viewport}
                now={() => cursor}
                onSelectEvent={openEvent}
              />
            </>
          ) : tab === "feed" ? (
            // Events + student press + dining, one ranked list. Same cursor
            // and same ?cats= as the map, so the two cannot disagree.
            <div className="min-h-0 grow overflow-y-auto">
              <FeedPanel onSelectEvent={openEvent} />
            </div>
          ) : (
            // Dining reads the same cursor as the map, so scrubbing to 18:30
            // shows what is open at 18:30 rather than what is open now.
            <div className="min-h-0 grow overflow-y-auto">
              <DiningPanel />
            </div>
          )}
        </div>
      )}
    />
  );
}
