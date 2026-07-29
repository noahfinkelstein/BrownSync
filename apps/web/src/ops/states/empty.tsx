import { Button, EmptyState } from "@brownsync/ui";

/**
 * §6.4 canonical empties — real copy that says what to do next, plus the
 * action that does it. Actions render only when the adopter wires a handler,
 * so these degrade gracefully before integration.
 */

/** Map/list has no events for the current time cursor + viewport. */
export function EmptyEvents({
  onWidenWindow,
  className,
}: {
  onWidenWindow?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      title="No events in view"
      body="Widen the time window or pan the map — this corner of campus is quiet right now."
      action={onWidenWindow && <Button onClick={onWidenWindow}>Widen the time window</Button>}
    />
  );
}

/** ⌘K palette / search field came back with nothing. */
export function EmptySearch({
  query,
  onClear,
  className,
}: {
  query: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      title={query ? `No matches for “${query}”` : "Nothing to search yet"}
      body="Try a building, an org, or a course code — ‘Salomon’, ‘Outing Club’, ‘CSCI 0150’."
      action={onClear && <Button onClick={onClear}>Clear search</Button>}
    />
  );
}

/** Place page timeline is empty for the selected day. */
export function EmptyPlaceDay({
  placeName,
  onShowWeek,
  className,
}: {
  placeName: string;
  onShowWeek?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      title={`Nothing scheduled at ${placeName} today`}
      body="Rooms fill on weekdays — the weekly view usually has more."
      action={onShowWeek && <Button onClick={onShowWeek}>Show this week</Button>}
    />
  );
}
