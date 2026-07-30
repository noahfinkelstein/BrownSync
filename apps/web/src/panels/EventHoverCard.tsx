import type { EventOut } from "@brownsync/contract";
import { CATEGORY_BY_ID } from "@brownsync/contract";
import { CategoryIcon, cn } from "@brownsync/ui";
import { eventTimeLabel, minutesUntil } from "../data/format";

export type EventHoverCardProps = {
  event: EventOut;
  /** Pointer position, px relative to the map container. */
  x: number;
  y: number;
  /** Container size, for edge flipping. */
  containerWidth: number;
  containerHeight: number;
  cursor: Date;
};

const CARD_W = 264;
const OFFSET = 14;

/**
 * §6.4-density hover card: title, mono "19:04 · in 26 min" line, place · org.
 * Pointer-transparent; follows the cursor with edge flipping. No shadow —
 * the slide-over panel owns the app's only shadow.
 */
export function EventHoverCard({
  event,
  x,
  y,
  containerWidth,
  containerHeight,
  cursor,
}: EventHoverCardProps) {
  const flipX = x + OFFSET + CARD_W > containerWidth;
  const flipY = y + OFFSET + 96 > containerHeight;
  const meta = [event.placeName ?? event.locationRaw, event.orgName].filter(Boolean).join(" · ");
  const soon = (() => {
    const m = minutesUntil(event.start, cursor);
    return m > 0 && m <= 30;
  })();

  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20"
      style={{
        left: flipX ? x - OFFSET - CARD_W : x + OFFSET,
        top: flipY ? undefined : y + OFFSET,
        bottom: flipY ? containerHeight - y + OFFSET : undefined,
        width: CARD_W,
      }}
    >
      <div className="rounded-6 border border-line bg-bg-raised px-3 py-2.5">
        <div className="flex items-start gap-2">
          <CategoryIcon
            category={event.category}
            size={14}
            className="mt-px shrink-0"
            style={{ color: `var(${CATEGORY_BY_ID[event.category].colorToken})` }}
          />
          <div className="min-w-0">
            <div className="line-clamp-2 text-14 font-medium leading-snug text-text-primary">
              {event.title}
            </div>
            <div
              className={cn("pt-1 font-mono text-12", soon ? "text-accent" : "text-text-secondary")}
            >
              {eventTimeLabel(event.start, event.end, cursor)}
            </div>
            {meta && <div className="truncate pt-0.5 text-12 text-text-secondary">{meta}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
