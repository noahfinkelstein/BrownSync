import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setCursorSource } from "./data/cursor";
import { initAnalytics } from "./ops";
import { router } from "./router";
import { timeCursor } from "./time";
import { createRouterUrlAdapter } from "./time/routerUrlAdapter";
import { connectTimeCursorToUrl } from "./time/urlSync";
import "./styles.css";

document.title = "BrownSync";

// Lane G's cursor store drives every lane-F layer/panel through the seam
// (data/cursor.ts). One call, app-wide.
setCursorSource(timeCursor);

// URL owns the cursor on load (?at=<ISO> → frozen, absent → live); afterwards
// the store owns the URL (debounced replaceState via the router, so ?at= and
// ?cats= compose).
connectTimeCursorToUrl(timeCursor, createRouterUrlAdapter(router));

// Lane I analytics — silently no-ops unless VITE_POSTHOG_KEY is set.
initAnalytics();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
