import { Outlet } from "@tanstack/react-router";

/**
 * Root layout: dark page chrome only — the map owns the viewport. Phase 2
 * builds the header (wordmark, search, time scrubber, chips) on top of this.
 */
export function App() {
  return (
    <div className="h-dvh w-full overflow-hidden bg-[#0B0E12] text-[#E8ECF1]">
      <Outlet />
    </div>
  );
}
