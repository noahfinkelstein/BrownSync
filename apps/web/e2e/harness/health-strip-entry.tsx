import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HealthStrip } from "../../src/ops/HealthStrip";
import { EmptyEvents } from "../../src/ops/states/empty";
import { ErrorState } from "../../src/ops/states/error";
import { ListSkeleton, PanelSkeleton } from "../../src/ops/states/skeletons";
import "./harness.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-12 tracking-[0.08em] text-text-faint uppercase">
          HealthStrip
        </h2>
        <div className="flex justify-end">
          <HealthStrip />
        </div>
      </section>
      <section className="flex flex-col gap-2" data-testid="states-gallery">
        <h2 className="font-mono text-12 tracking-[0.08em] text-text-faint uppercase">States</h2>
        <EmptyEvents onWidenWindow={() => {}} />
        <ErrorState what="events" detail="GET /api/events 503" bordered onRetry={() => {}} />
        <ListSkeleton />
        <PanelSkeleton />
      </section>
    </div>
  </StrictMode>,
);
