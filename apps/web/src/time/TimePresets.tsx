import { cn, FOCUS_RING } from "@brownsync/ui";
import { floorToMinute, type TimeCursorStore, timeCursor } from "./cursor";
import { getPreset, type TimePresetId } from "./presets";
import { useTimeCursor } from "./useTimeCursor";

export type TimePresetsProps = {
  /** Injectable for tests; defaults to the app-wide cursor. */
  store?: TimeCursorStore;
  className?: string;
};

const PRESET_IDS: readonly TimePresetId[] = ["tonight", "weekend"];

/**
 * Compact "tonight" / "weekend" jumps (handoff §2G). Clicking freezes the
 * cursor at the preset's prime instant; a preset reads as pressed while the
 * scrubbed cursor sits inside its window. Styling mirrors the category Chip
 * (§6.4 density) — no accent, that belongs to live/NOW only.
 */
export function TimePresets({ store = timeCursor, className }: TimePresetsProps) {
  const cursor = useTimeCursor(store);
  const liveNow = cursor.liveNow();
  const at = cursor.now();

  return (
    // Fieldsets default to min-width:min-content; min-w-0 keeps flex rows sane.
    <fieldset
      aria-label="Time presets"
      className={cn("m-0 flex min-w-0 items-center gap-1.5 border-0 p-0", className)}
    >
      {PRESET_IDS.map((id) => {
        const preset = getPreset(id, liveNow);
        const active = !cursor.isLive && at >= preset.from && at <= preset.to;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => cursor.setAt(floorToMinute(preset.at))}
            className={cn(
              "inline-flex h-6 shrink-0 select-none items-center rounded-4 border px-2 text-12 transition-colors duration-150 ease-out",
              // Presets have no keyboard equivalent, so they must survive on
              // touch (round-2 review): "tonight" — the #1 student jump —
              // stays at every width; "weekend" yields below sm where the
              // rail needs the room.
              id === "weekend" && "hidden sm:inline-flex",
              active
                ? "border-line bg-bg-overlay text-text-primary"
                : "border-line text-text-secondary hover:border-text-faint hover:text-text-primary",
              FOCUS_RING,
            )}
          >
            {preset.label}
          </button>
        );
      })}
    </fieldset>
  );
}
