import { HealthOutSchema } from "@brownsync/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDefaultFixtureData, healthSnapshot } from "../mocks/fixtureApi";
import type { SourceHealth } from "./health-model";

/** Matches the poller cadence ceiling — fresher than this is wasted requests. */
export const HEALTH_REFRESH_MS = 60_000;

export function healthUrl(): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  return `${base.replace(/\/+$/, "")}/api/health`;
}

/** Zero-backend mode (README): serve the fixture snapshot, touch no network. */
function fixturesEnabled(): boolean {
  return import.meta.env.VITE_USE_FIXTURES === "1";
}

export type HealthPhase = "loading" | "ready" | "error";

export type HealthState = {
  phase: HealthPhase;
  /** Last good payload — kept through fetch failures so the strip degrades, not blanks. */
  sources: SourceHealth[];
  /** Epoch ms of the last completed check (success or failure). */
  checkedAt: number | null;
  refetch: () => void;
};

/**
 * Self-contained /api/health poller: fetch + Zod parse, refreshed on an
 * interval and whenever the tab becomes visible again. Deliberately does NOT
 * depend on a QueryClientProvider so the strip mounts anywhere (header slot,
 * /health page, e2e harness).
 */
export function useHealth(refreshMs: number = HEALTH_REFRESH_MS): HealthState {
  const [phase, setPhase] = useState<HealthPhase>("loading");
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      let payload: unknown;
      if (fixturesEnabled()) {
        payload = healthSnapshot(getDefaultFixtureData());
      } else {
        const res = await fetch(healthUrl(), { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`GET /api/health ${res.status}`);
        payload = await res.json();
      }
      const parsed = HealthOutSchema.parse(payload);
      if (!alive.current) return;
      setSources(parsed.sources);
      setPhase("ready");
    } catch {
      if (!alive.current) return;
      setPhase("error");
    } finally {
      if (alive.current) setCheckedAt(Date.now());
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const interval = window.setInterval(() => void load(), refreshMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, refreshMs]);

  const refetch = useCallback(() => {
    void load();
  }, [load]);

  return { phase, sources, checkedAt, refetch };
}
