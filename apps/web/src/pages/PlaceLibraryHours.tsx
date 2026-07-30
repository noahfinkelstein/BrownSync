import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { DAILY_ARTIFACT_QUERY_OPTIONS } from "../data/artifacts";
import { useCursorDate } from "../data/cursor";
import { campusDate } from "../dining/model";
import { formatClock } from "../time";

export const LIBRARY_HOURS_DATA_URL = "/data/library-hours.json";

type LibraryHoursRecord = {
  readonly date: string;
  readonly open: string | null;
  readonly close: string | null;
  readonly note: string | null;
};

type LibrarySchedule = {
  readonly id: string;
  readonly name: string;
  readonly placeId: string;
  readonly hours: readonly LibraryHoursRecord[];
};

type LibraryHoursDocument = {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly attribution: string;
  readonly libraries: readonly LibrarySchedule[];
};

function useLibraryHours() {
  return useQuery({
    queryKey: ["library-hours"] as const,
    queryFn: async (): Promise<LibraryHoursDocument> => {
      const response = await fetch(LIBRARY_HOURS_DATA_URL);
      if (!response.ok) throw new Error(`library hours: ${response.status}`);
      return (await response.json()) as LibraryHoursDocument;
    },
    ...DAILY_ARTIFACT_QUERY_OPTIONS,
  });
}

function hoursLabel(hours: LibraryHoursRecord): string {
  if (hours.note) return hours.note;
  if (hours.open && hours.close) {
    const open = Date.parse(hours.open);
    const close = Date.parse(hours.close);
    if (Number.isFinite(open) && Number.isFinite(close)) {
      return `${formatClock(open)}–${formatClock(close)}`;
    }
  }
  return "Hours unavailable";
}

export function PlaceLibraryHours({ placeId }: { placeId: string }) {
  const { cursor } = useCursorDate();
  const { data, isError } = useLibraryHours();
  const date = campusDate(cursor.getTime());

  const rows = useMemo(() => {
    if (!data) return [];
    return data.libraries.flatMap((library) => {
      if (library.placeId !== placeId) return [];
      const hours = library.hours.find((candidate) => candidate.date === date);
      return hours ? [{ library, hours }] : [];
    });
  }, [data, date, placeId]);

  if (isError) {
    return (
      <p role="alert" className="mt-4 text-14 text-text-secondary">
        Library hours are unavailable right now.
      </p>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section
      className="mt-4"
      aria-labelledby="place-library-hours-heading"
      data-testid="place-library-hours"
    >
      <h2
        id="place-library-hours-heading"
        className="mb-2 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary"
      >
        Library hours
      </h2>
      <ul className="space-y-2">
        {rows.map(({ library, hours }) => (
          <li key={library.id} className="flex gap-3">
            <span className="grow text-14 text-text-primary">{library.name}</span>
            <span className="shrink-0 font-mono text-12 tabular-nums text-text-secondary">
              {hoursLabel(hours)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
