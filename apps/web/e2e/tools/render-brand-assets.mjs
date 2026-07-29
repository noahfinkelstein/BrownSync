// Renders the PWA icon set + og.png from public/icons/mark.svg via headless
// chromium (the same binary the e2e suite uses — no extra toolchain).
//
//   cd apps/web && pnpm exec node e2e/tools/render-brand-assets.mjs
//
// Outputs (committed):
//   public/icons/icon-192.png, icon-512.png, maskable-512.png,
//   apple-touch-icon.png (180), public/og.png (1200x630)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = join(webRoot, "public");
// The fonts are dependencies of packages/ui (where the stylesheet imports
// them), so resolve them from there.
const uiModules = join(webRoot, "..", "..", "packages", "ui", "node_modules");

const BG = "#0B0E12";
const LINE = "#232A35";
const TEXT = "#E8ECF1";
const TEXT_2 = "#8B94A3";
const TEXT_3 = "#566070";
const ACCENT = "#D96C3D";

const markSvg = readFileSync(join(publicDir, "icons", "mark.svg"), "utf8");

function fontFace(family, file, weightRange) {
  const data = readFileSync(file).toString("base64");
  return `@font-face {
    font-family: "${family}";
    src: url(data:font/woff2;base64,${data}) format("woff2");
    font-weight: ${weightRange};
  }`;
}

const instrumentSans = fontFace(
  "Instrument Sans",
  join(
    uiModules,
    "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
  ),
  "400 700",
);
const plexMono = fontFace(
  "IBM Plex Mono",
  join(uiModules, "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2"),
  "500",
);

/** Full-bleed dark tile with the mark centered; markRatio < 1 shrinks it
 *  into the maskable safe zone. */
function tileHtml(size, markRatio) {
  const markSize = Math.round(size * markRatio);
  return `<!doctype html><html><head><style>
    * { margin: 0; }
    body { width: ${size}px; height: ${size}px; background: ${BG};
           display: flex; align-items: center; justify-content: center; overflow: hidden; }
    svg { width: ${markSize}px; height: ${markSize}px; }
  </style></head><body>${markSvg}</body></html>`;
}

function ogHtml() {
  return `<!doctype html><html><head><style>
    ${instrumentSans}
    ${plexMono}
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; background: ${BG}; overflow: hidden;
           font-family: "Instrument Sans", sans-serif; position: relative; }
    .frame { position: absolute; inset: 28px; border: 1px solid ${LINE}; }
    .content { position: absolute; inset: 28px; display: flex; align-items: center; }
    .left { flex: 1; padding: 0 0 0 72px; }
    .wordmark { font-size: 92px; font-weight: 600; letter-spacing: -0.03em; color: ${TEXT}; }
    .cats { margin-top: 28px; font-family: "IBM Plex Mono", monospace; font-weight: 500;
            font-size: 20px; letter-spacing: 0.12em; color: ${TEXT_2}; }
    .live { margin-top: 14px; font-family: "IBM Plex Mono", monospace; font-weight: 500;
            font-size: 20px; letter-spacing: 0.12em; color: ${ACCENT};
            display: flex; align-items: center; gap: 12px; }
    .live-dot { width: 10px; height: 10px; border-radius: 50%; background: ${ACCENT};
                box-shadow: 0 0 0 5px rgb(217 108 61 / 0.18); }
    .coords { position: absolute; left: 100px; bottom: 64px; font-family: "IBM Plex Mono", monospace;
              font-weight: 500; font-size: 16px; letter-spacing: 0.08em; color: ${TEXT_3}; }
    .right { width: 440px; display: flex; align-items: center; justify-content: center; }
    .right svg { width: 360px; height: 360px; }
  </style></head><body>
    <div class="frame"></div>
    <div class="content">
      <div class="left">
        <div class="wordmark">BrownSync</div>
        <div class="cats">EVENTS · CLUBS · CLASSES · ATHLETICS</div>
        <div class="live"><span class="live-dot"></span>LIVE ON ONE MAP</div>
        <div class="coords">COLLEGE HILL · 41.8268 N · 71.4025 W</div>
      </div>
      <div class="right">${markSvg}</div>
    </div>
  </body></html>`;
}

const targets = [
  { html: tileHtml(192, 0.94), width: 192, height: 192, out: "icons/icon-192.png" },
  { html: tileHtml(512, 0.94), width: 512, height: 512, out: "icons/icon-512.png" },
  // Maskable safe zone: keep the mark inside the central 80%.
  { html: tileHtml(512, 0.66), width: 512, height: 512, out: "icons/maskable-512.png" },
  { html: tileHtml(180, 0.9), width: 180, height: 180, out: "icons/apple-touch-icon.png" },
  { html: ogHtml(), width: 1200, height: 630, out: "og.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { html, width, height, out } of targets) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(publicDir, out), clip: { x: 0, y: 0, width, height } });
  console.log(`wrote public/${out}`);
}
await browser.close();
