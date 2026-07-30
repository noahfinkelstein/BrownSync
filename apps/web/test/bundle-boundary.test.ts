import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const URL_HELPER_SOURCE = readFileSync(new URL("../src/events/url.ts", import.meta.url), "utf8");
const DETAIL_PANEL_SOURCE = readFileSync(
  new URL("../src/panels/EventDetailPanel.tsx", import.meta.url),
  "utf8",
);

describe("event-link bundle boundary", () => {
  it("keeps URL validation leaf-sized and calendar export lazy", () => {
    expect(URL_HELPER_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(DETAIL_PANEL_SOURCE).toContain('import { absoluteHttpUrl } from "../events/url";');
    expect(DETAIL_PANEL_SOURCE).toMatch(/import\(["']\.\/ics["']\)/);
  });
});
