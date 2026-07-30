import { cn } from "@brownsync/ui";
import { useMemo, useState } from "react";
import { useCursorDate } from "../data/cursor";
import {
  campusDate,
  type DiningLocation,
  type DiningService,
  formatServiceTime,
  servicesOn,
  sortByAvailability,
  statusAt,
} from "./model";
import { useDining } from "./useDining";

/**
 * Dining halls at the time cursor.
 *
 * Reads the SAME cursor as the map and the list, so scrubbing to 18:30 shows
 * what is open at 18:30 — not what is open right now. That is the whole point
 * of having a time machine, and a dining panel pinned to wall-clock would be
 * the one surface that silently disagrees with everything around it.
 */
export function DiningPanel({ className }: { className?: string }) {
  const { cursor } = useCursorDate();
  const { data, isPending, isError } = useDining();
  const at = cursor.getTime();

  const ordered = useMemo(() => (data ? sortByAvailability(data.locations, at) : []), [data, at]);

  if (isPending) {
    return (
      <p className={cn("px-3 py-4 font-mono text-12 text-text-secondary", className)}>
        Loading dining…
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p role="alert" className={cn("px-3 py-4 text-14 text-text-secondary", className)}>
        Dining hours are unavailable right now.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col", className)} data-testid="dining-panel">
      <ul className="divide-y divide-line">
        {ordered.map((location) => (
          <li key={location.locationId}>
            <HallRow location={location} at={at} iconLabels={data.icon_labels} />
          </li>
        ))}
      </ul>
      <p className="px-3 py-2 font-mono text-12 text-text-secondary">{data.attribution}</p>
    </div>
  );
}

function HallRow({
  location,
  at,
  iconLabels,
}: {
  location: DiningLocation;
  at: number;
  iconLabels: Readonly<Record<string, string>>;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = statusAt(location, at);
  const today = servicesOn(location, campusDate(at));
  const noServiceToday = today.length === 0;

  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-baseline gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
        disabled={noServiceToday}
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full border",
            status.kind === "open"
              ? "border-transparent bg-accent"
              : "border-text-faint bg-transparent",
          )}
        />
        <span className="grow text-14 text-text-primary">{location.name}</span>
        <StatusLabel status={status} noServiceToday={noServiceToday} />
      </button>

      {expanded && today.length > 0 && (
        <div className="mt-2 space-y-3 pl-3.5">
          {today.map((service) => (
            <ServiceBlock
              key={`${service.date}-${service.meal}-${service.start}`}
              service={service}
              iconLabels={iconLabels}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusLabel({
  status,
  noServiceToday,
}: {
  status: ReturnType<typeof statusAt>;
  noServiceToday: boolean;
}) {
  if (noServiceToday) {
    return <span className="shrink-0 font-mono text-12 text-text-secondary">no service today</span>;
  }
  if (status.kind === "open") {
    const closes = formatServiceTime(status.service.end);
    return (
      <span className="shrink-0 font-mono text-12 text-text-primary">
        {closes ? `until ${closes}` : "open"}
      </span>
    );
  }
  if (status.kind === "opens-later") {
    const opens = formatServiceTime(status.service.start);
    return (
      <span className="shrink-0 font-mono text-12 text-text-secondary">
        {opens ? `opens ${opens}` : "opens later"}
      </span>
    );
  }
  return <span className="shrink-0 font-mono text-12 text-text-secondary">closed</span>;
}

function ServiceBlock({
  service,
  iconLabels,
}: {
  service: DiningService;
  iconLabels: Readonly<Record<string, string>>;
}) {
  const start = formatServiceTime(service.start);
  const end = formatServiceTime(service.end);
  return (
    <section>
      <h4 className="font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
        {service.meal}
        {start && ` · ${start}${end ? `–${end}` : ""}`}
      </h4>
      <ul className="mt-1 space-y-1.5">
        {service.stations.map((station) => (
          <li key={station.name}>
            <p className="text-12 text-text-secondary">{station.name}</p>
            <p className="text-14 text-text-primary">
              {station.items.map((item, index) => (
                <span key={item.name}>
                  {index > 0 && <span className="text-text-secondary">, </span>}
                  {item.name}
                  {(item.icons ?? []).map((icon) => (
                    // The code is the compact affordance; the expansion is the
                    // accessible name, so "VGN" is never the only signal.
                    <abbr
                      key={icon}
                      title={iconLabels[icon] ?? icon}
                      className="ml-1 font-mono text-12 text-text-secondary no-underline"
                    >
                      {icon}
                    </abbr>
                  ))}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
