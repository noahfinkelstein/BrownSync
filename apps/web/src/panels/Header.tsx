import { Link } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { SearchTrigger } from "../browse/SearchTrigger";
import { HealthStrip } from "../ops/HealthStrip";
import { NowBar } from "./NowBar";

/**
 * Shell header (§3.1) — Brown's seal-brown bar.
 *
 * Structural chrome uses `brand.brown`; the page below is white. That split is
 * what makes the app read as Brown's without turning every surface brown, and
 * it matches the visual language of Brown's own Student Activities site.
 *
 * The time machine is NOT here — it is a full-width bottom dock
 * (`time/TimeMachineDock.tsx`), because a ±7-day scrubber cannot share a row
 * with three other slots and stay precise. The freed centre slot is the live
 * campus readout, which is the question the whole site answers.
 */

/**
 * Re-point the theme's own custom properties for this subtree.
 *
 * The page triad does not survive the trip onto brown: `--text-primary` is
 * near-black (1.4:1) and — the one that actually bites — **Brown red is 1.73:1
 * on seal brown**, so the app's single signal colour is invisible exactly
 * where the header wants to put a live dot.
 *
 * Rebinding the variables rather than threading an `onBrown` prop through
 * `SearchTrigger`, `NowBar` and `HealthStrip` is deliberate: those components
 * already resolve every colour through these tokens, so they re-theme for
 * free and stay ignorant of where they are mounted. Radix popovers portal to
 * the body and therefore correctly escape this scope back to page colours.
 *
 * Every value is measured against `#4E3629`: white 11.2:1, muted 6.8:1,
 * lifted accent 4.9:1.
 */
const ON_BROWN: CSSProperties = {
  "--text-primary": "var(--on-brown)",
  "--text-secondary": "var(--on-brown-muted)",
  "--text-faint": "var(--on-brown-muted)",
  "--accent": "var(--accent-on-brown)",
  "--line": "rgb(255 255 255 / 0.16)",
  "--bg-raised": "var(--brand-brown)",
  "--bg-overlay": "rgb(255 255 255 / 0.10)",
} as CSSProperties;

const NAV_LINK =
  "font-mono text-12 uppercase tracking-[0.08em] text-text-secondary no-underline transition-colors duration-150 ease-out hover:text-text-primary";

function MobileDirectoryNav() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="relative shrink-0 md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Browse directories"
        aria-controls="mobile-directory-nav"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${NAV_LINK} h-7 rounded-4 border border-line bg-bg-overlay px-2`}
      >
        Browse
      </button>
      {open && (
        <nav
          id="mobile-directory-nav"
          aria-label="Directories"
          className="absolute left-0 top-full z-50 mt-1.5 flex w-36 flex-col gap-0.5 rounded-4 border border-line bg-brand-brown p-1"
        >
          <Link
            to="/events"
            search={(prev) => prev}
            onClick={() => setOpen(false)}
            className={`${NAV_LINK} rounded-2 px-2 py-2 hover:bg-bg-overlay`}
          >
            Events
          </Link>
          <Link
            to="/clubs"
            search={(prev) => prev}
            onClick={() => setOpen(false)}
            className={`${NAV_LINK} rounded-2 px-2 py-2 hover:bg-bg-overlay`}
          >
            Clubs
          </Link>
        </nav>
      )}
    </div>
  );
}

export function AppHeader() {
  return (
    <header
      style={ON_BROWN}
      className="relative z-30 flex h-14 shrink-0 items-center gap-4 bg-brand-brown px-4 text-text-primary"
    >
      <div className="flex shrink-0 items-baseline gap-2.5">
        {/* <Link>, never a bare <a href>. A raw anchor is a full document
            navigation: it re-downloads the bundle, re-boots MapLibre and
            refetches 4.9 MB of tiles — and it DISCARDS the search params, so
            clicking the wordmark silently throws away the user's ?at= cursor,
            ?cats= filter and ?layers= selection. */}
        <Link
          to="/"
          search={(prev) => prev}
          className="text-19 font-semibold tracking-[-0.02em] text-text-primary no-underline"
        >
          BrownSync
        </Link>
        <span className="hidden font-mono text-12 text-text-secondary 2xl:inline">
          COLLEGE HILL · 41.827°N 71.403°W
        </span>
      </div>

      {/* The map is the front door, but it must not be the only one. */}
      <MobileDirectoryNav />
      <nav aria-label="Directories" className="hidden shrink-0 items-center gap-4 md:flex">
        <Link to="/events" search={(prev) => prev} className={NAV_LINK}>
          Events
        </Link>
        <Link to="/clubs" search={(prev) => prev} className={NAV_LINK}>
          Clubs
        </Link>
      </nav>

      <div className="flex shrink-0 items-center justify-start">
        {/* SLOT:search — lane H's ⌘K trigger (opens the palette, owns the hotkey). */}
        <SearchTrigger />
      </div>

      <div className="flex min-w-0 grow items-center justify-end lg:justify-center">
        {/* SLOT:now — live campus readout, keyed off the same cursor + ?cats=
            as the map so the two can never disagree. */}
        <NowBar className="min-w-0" />
      </div>

      <div className="flex shrink-0 items-center">
        {/* SLOT:health — lane I's source-health aggregate; popover has the per-source detail. */}
        <HealthStrip compact />
      </div>
    </header>
  );
}
