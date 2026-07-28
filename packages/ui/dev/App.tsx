import { CATEGORIES, type Category, tokens } from "@brownsync/contract";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  buildMapImages,
  CategoryIcon,
  Chip,
  CloseGlyph,
  ConfidenceDot,
  DataTable,
  type DataTableColumn,
  EmptyState,
  IconButton,
  Kbd,
  Panel,
  Scrubber,
  SearchGlyph,
  SearchInput,
  SegmentedControl,
  Skeleton,
  SkeletonRows,
  SourceBadge,
  StatusDot,
  TimelineRow,
} from "../src";

/* ---------------------------------------------------------------- chrome */

function Section({
  n,
  title,
  note,
  children,
}: {
  n: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line py-8">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="font-mono text-12 text-text-faint">{n}</span>
        <h2 className="font-mono text-12 uppercase tracking-[0.14em] text-text-secondary">
          {title}
        </h2>
        {note && <span className="text-12 text-text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-mono text-12 text-text-faint">{children}</div>;
}

function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-4 flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

function Swatch({ name, value, border }: { name: string; value: string; border?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`h-8 w-12 rounded-2 ${border ? "border border-line" : ""}`}
        style={{ background: value }}
      />
      <span className="flex flex-col">
        <span className="font-mono text-12 text-text-secondary">{name}</span>
        <span className="font-mono text-12 text-text-faint">{value}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- demo data */

type DemoEvent = {
  id: string;
  time: string;
  title: string;
  place: string;
  category: Category;
  source: string;
  confidence: number;
};

const DEMO_EVENTS: DemoEvent[] = [
  {
    id: "1",
    time: "18:00",
    title: "CS colloquium: verified kernels",
    place: "CIT 368",
    category: "academic",
    source: "livewhale",
    confidence: 1,
  },
  {
    id: "2",
    time: "19:04",
    title: "Brown Outing Club — general body",
    place: "Sayles Hall",
    category: "club",
    source: "clubs",
    confidence: 0.92,
  },
  {
    id: "3",
    time: "19:30",
    title: "Orchestra dress rehearsal",
    place: "Sayles Hall",
    category: "arts",
    source: "livewhale",
    confidence: 1,
  },
  {
    id: "4",
    time: "20:00",
    title: "W volleyball vs. Yale",
    place: "Pizzitola Center",
    category: "athletics",
    source: "athletics_ics",
    confidence: 1,
  },
  {
    id: "5",
    time: "21:00",
    title: "Late night @ Andrews",
    place: "Andrews Commons",
    category: "food",
    source: "bdh",
    confidence: 0.61,
  },
];

/* -------------------------------------------------- map-image demo strip */

function MapImageStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    try {
      const images = buildMapImages(32);
      host.replaceChildren();
      for (const c of CATEGORIES) {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        canvas.title = c.icon;
        canvas.getContext("2d")?.putImageData(images[c.id], 0, 0);
        host.appendChild(canvas);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  if (err) return <div className="text-12 text-status-error">{err}</div>;
  return (
    <div
      ref={ref}
      className="flex flex-wrap items-center gap-3 rounded-4 border border-line bg-bg-overlay p-3"
    />
  );
}

/* ------------------------------------------------------------------ app */

const HOURS = Array.from({ length: 15 }, (_, i) => i * 4);

export function App() {
  const [chips, setChips] = useState<ReadonlySet<Category>>(new Set(["club", "arts"]));
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("map");
  const [cursor, setCursor] = useState(31);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState("2");

  const toggleChip = (c: Category) =>
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const eventColumns: readonly DataTableColumn<DemoEvent>[] = [
    { key: "time", header: "time", mono: true, width: "64px", cell: (r) => r.time },
    {
      key: "title",
      header: "event",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <CategoryIcon category={r.category} size={16} className="shrink-0 text-text-secondary" />
          <span className="text-text-primary">{r.title}</span>
        </span>
      ),
    },
    {
      key: "place",
      header: "place",
      cell: (r) => <span className="text-text-secondary">{r.place}</span>,
    },
    {
      key: "src",
      header: "src",
      width: "130px",
      align: "right",
      cell: (r) => <SourceBadge source={r.source} confidence={r.confidence} />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1080px] px-6 pb-24 pt-10">
      {/* masthead */}
      <header className="mb-8 flex items-end justify-between">
        <div>
          <div className="text-24 font-medium tracking-tight text-text-primary">
            BrownSync <span className="text-text-faint">design system</span>
          </div>
          <div className="pt-1 font-mono text-12 text-text-secondary">
            /dev/ui · §6 design law · one accent, ten categories, zero card grids
          </div>
        </div>
        <StatusDot status="ok" label="tokens" detail="synced w/ contract" />
      </header>

      {/* 01 tokens */}
      <Section n="01" title="tokens" note="bg stack · line · text triad · one accent">
        <Label>background stack + line</Label>
        <Row className="gap-6">
          <Swatch name="--bg-base" value={tokens.bg.base} border />
          <Swatch name="--bg-raised" value={tokens.bg.raised} border />
          <Swatch name="--bg-overlay" value={tokens.bg.overlay} border />
          <Swatch name="--line" value={tokens.line} />
        </Row>
        <Label>text triad + accent (live/now + primary actions ONLY)</Label>
        <Row className="gap-6">
          <Swatch name="--text-primary" value={tokens.text.primary} />
          <Swatch name="--text-secondary" value={tokens.text.secondary} />
          <Swatch name="--text-faint" value={tokens.text.faint} />
          <Swatch name="--accent" value={tokens.accent} />
        </Row>
        <Label>tailwind theme proof — literal utility classes compiled from the token map</Label>
        <Row className="font-mono text-12">
          <span className="rounded-2 bg-bg-overlay px-1.5 py-0.5 text-text-secondary">
            bg-bg-overlay
          </span>
          <span className="rounded-2 border border-line px-1.5 py-0.5 text-text-secondary">
            border-line
          </span>
          <span className="rounded-2 px-1.5 py-0.5 text-accent">text-accent</span>
          <span className="rounded-2 bg-cat-club px-1.5 py-0.5 text-bg-base">bg-cat-club</span>
          <span className="rounded-2 bg-cat-arts px-1.5 py-0.5 text-bg-base">bg-cat-arts</span>
          <span className="rounded-2 px-1.5 py-0.5 text-cat-academic">text-cat-academic</span>
        </Row>
        <Label>category palette — chroma-matched on dark (contract §4)</Label>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5">
              <span className="h-6 w-6 rounded-2" style={{ background: c.colorHex }} />
              <span className="flex flex-col">
                <span className="font-mono text-12 text-text-secondary">{c.colorToken}</span>
                <span className="font-mono text-12 text-text-faint">{c.colorHex}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* 02 type */}
      <Section
        n="02"
        title="type"
        note="Instrument Sans display · IBM Plex Mono data · 12/13/15/18/24 only"
      >
        <div className="flex flex-col gap-2">
          <div className="text-24 tracking-tight text-text-primary">
            24 — Everything happening at Brown
          </div>
          <div className="text-18 tracking-tight text-text-primary">18 — Sayles Hall, tonight</div>
          <div className="text-15 text-text-primary">15 — Panel titles and section heads</div>
          <div className="text-13 text-text-primary">
            13 — Body and control text. Density is a feature, not a bug.
          </div>
          <div className="text-12 text-text-secondary">12 — Meta, captions, table headers</div>
          <div className="pt-2 font-mono text-13 text-text-primary">
            mono 13 — 41.8268°N 71.4025°W
          </div>
          <div className="font-mono text-12 text-text-secondary">
            mono 12 — 19:04 · in 26 min · livewhale · conf 0.92
          </div>
        </div>
      </Section>

      {/* 03 icons */}
      <Section
        n="03"
        title="icons"
        note="10 glyphs · 16 grid · 1.5px stroke · squared terminals · one family"
      >
        <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
              <div className="flex items-end gap-3 text-text-primary">
                <CategoryIcon category={c.id} size={16} title={`${c.label} 16px`} />
                <CategoryIcon category={c.id} size={24} title={`${c.label} 24px`} />
                <CategoryIcon category={c.id} size={32} title={`${c.label} 32px`} />
                <CategoryIcon
                  category={c.id}
                  size={16}
                  style={{ color: c.colorHex }}
                  title={`${c.label} tinted`}
                />
              </div>
              <div className="font-mono text-12 text-text-faint">{c.icon}</div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Label>
            buildMapImages(32) — OffscreenCanvas → ImageData, white on transparent for MapLibre
            addImage
          </Label>
          <MapImageStrip />
        </div>
        <div className="mt-4">
          <Label>utility glyphs (inputs only)</Label>
          <div className="flex items-center gap-3 text-text-secondary">
            <SearchGlyph className="h-4 w-4" />
            <CloseGlyph className="h-4 w-4" />
          </div>
        </div>
      </Section>

      {/* 04 buttons */}
      <Section n="04" title="buttons" note="primary = accent, and accent means it">
        <Label>variants · dense (default)</Label>
        <Row>
          <Button variant="primary">Add to calendar</Button>
          <Button variant="ghost">Open source ↗</Button>
          <Button variant="subtle">Reset filters</Button>
          <Button variant="primary" disabled>
            Add to calendar
          </Button>
          <Button variant="ghost" disabled>
            Open source ↗
          </Button>
        </Row>
        <Label>comfortable</Label>
        <Row>
          <Button variant="primary" density="comfortable">
            Add to calendar
          </Button>
          <Button variant="ghost" density="comfortable">
            Open source ↗
          </Button>
          <Button variant="subtle" density="comfortable">
            Reset filters
          </Button>
        </Row>
        <Label>icon buttons</Label>
        <Row>
          <IconButton aria-label="Search">
            <SearchGlyph className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton aria-label="Close">
            <CloseGlyph className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton aria-label="Close" density="comfortable">
            <CloseGlyph className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="Close" disabled>
            <CloseGlyph className="h-3.5 w-3.5" />
          </IconButton>
        </Row>
      </Section>

      {/* 05 chips + badges */}
      <Section
        n="05"
        title="chips + provenance"
        note="category filter chips · source badge + confidence dot"
      >
        <Label>category chips — click to toggle</Label>
        <Row>
          {CATEGORIES.map((c) => (
            <Chip key={c.id} category={c.id} selected={chips.has(c.id)} onToggle={toggleChip} />
          ))}
        </Row>
        <Label>with counts</Label>
        <Row>
          <Chip category="club" selected count={41} onToggle={toggleChip} />
          <Chip category="academic" count={12} onToggle={toggleChip} />
          <Chip category="athletics" count={3} onToggle={toggleChip} />
        </Row>
        <Label>badges + provenance</Label>
        <Row>
          <Badge>all-day</Badge>
          <Badge>free food</Badge>
          <Badge variant="accent">starting soon</Badge>
          <SourceBadge source="livewhale" confidence={1} />
          <SourceBadge source="cab" confidence={0.92} />
          <SourceBadge source="bdh" confidence={0.61} />
        </Row>
        <Label>confidence ramp</Label>
        <Row className="gap-4">
          {[1, 0.85, 0.7, 0.55, 0.4].map((c) => (
            <span
              key={c}
              className="flex items-center gap-1.5 font-mono text-12 text-text-secondary"
            >
              <ConfidenceDot confidence={c} />
              {c.toFixed(2)}
            </span>
          ))}
        </Row>
      </Section>

      {/* 06 inputs */}
      <Section n="06" title="inputs" note="search · segmented · kbd">
        <div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>search — empty, with shortcut hint</Label>
            <SearchInput
              placeholder="Search events, places, orgs…"
              kbdHint="⌘K"
              value=""
              onChange={() => {}}
            />
          </div>
          <div>
            <Label>search — live value + clear</Label>
            <SearchInput
              placeholder="Search events, places, orgs…"
              value={query || "sayles"}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
            />
          </div>
          <div>
            <Label>comfortable</Label>
            <SearchInput
              density="comfortable"
              placeholder="Search…"
              kbdHint="⌘K"
              value=""
              onChange={() => {}}
            />
          </div>
          <div>
            <Label>segmented — arrow keys work</Label>
            <Row>
              <SegmentedControl
                aria-label="View mode"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "map", label: "map" },
                  { value: "list", label: "list" },
                  { value: "split", label: "split" },
                ]}
              />
              <SegmentedControl
                aria-label="View mode comfortable"
                density="comfortable"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "map", label: "map" },
                  { value: "list", label: "list" },
                ]}
              />
            </Row>
          </div>
        </div>
        <Label>kbd</Label>
        <Row>
          <span className="text-13 text-text-secondary">
            Press <Kbd>⌘K</Kbd> to search, <Kbd>T</Kbd> for tonight, <Kbd>Esc</Kbd> to close
          </span>
        </Row>
      </Section>

      {/* 07 scrubber */}
      <Section n="07" title="time scrubber" note="±7 days · thin track · accent NOW marker">
        <div className="max-w-[720px]">
          <div className="mb-1 flex justify-between font-mono text-12 text-text-faint">
            <span>-7d</span>
            <span className="text-accent">now</span>
            <span>+7d</span>
          </div>
          <Scrubber
            aria-label="Time cursor"
            min={0}
            max={56}
            step={1}
            value={cursor}
            onValueChange={setCursor}
            ticks={HOURS}
            now={28}
            getValueText={(v) => `${v - 28 >= 0 ? "+" : ""}${(v - 28) * 6} hours`}
          />
          <div className="mt-1 font-mono text-12 text-text-secondary">
            cursor: {cursor === 28 ? "live" : `${cursor > 28 ? "+" : ""}${(cursor - 28) * 6}h`}
          </div>
          <div className="mt-4">
            <Label>disabled</Label>
            <Scrubber
              aria-label="Disabled scrubber"
              disabled
              min={0}
              max={56}
              value={20}
              now={28}
              ticks={HOURS}
              onValueChange={() => {}}
            />
          </div>
        </div>
      </Section>

      {/* 08 data table */}
      <Section n="08" title="data table" note="dense rows · mono timestamps · hairlines, not cards">
        <Label>dense (default)</Label>
        <DataTable
          aria-label="Events (dense)"
          columns={eventColumns}
          rows={DEMO_EVENTS}
          rowKey={(r) => r.id}
        />
        <div className="mt-6">
          <Label>comfortable</Label>
          <DataTable
            aria-label="Events (comfortable)"
            columns={eventColumns}
            rows={DEMO_EVENTS.slice(0, 2)}
            rowKey={(r) => r.id}
            density="comfortable"
          />
        </div>
        <div className="mt-6">
          <Label>empty</Label>
          <DataTable
            aria-label="Events (empty)"
            columns={eventColumns}
            rows={[]}
            rowKey={(r: DemoEvent) => r.id}
            empty={
              <EmptyState
                title="No events in view"
                body="Widen the time window or zoom out — the map only lists what fits the current viewport."
                action={<Button variant="ghost">Widen to tonight</Button>}
              />
            }
          />
        </div>
      </Section>

      {/* 09 timeline */}
      <Section
        n="09"
        title="timeline"
        note="time gutter · rail node by category · the one ambient pulse"
      >
        <div className="max-w-[560px] border-y border-line py-1">
          <TimelineRow
            time="18:47"
            sub="in 12 min"
            live
            title="Brown Outing Club — general body"
            meta="Sayles Hall · club"
            end={<Badge variant="accent">soon</Badge>}
            onClick={() => setSelectedRow("2")}
            selected={selectedRow === "2"}
          />
          {DEMO_EVENTS.filter((e) => e.id !== "2").map((e) => (
            <TimelineRow
              key={e.id}
              time={e.time}
              title={e.title}
              meta={`${e.place} · ${e.category}`}
              category={e.category}
              onClick={() => setSelectedRow(e.id)}
              selected={selectedRow === e.id}
              end={<SourceBadge source={e.source} confidence={e.confidence} />}
            />
          ))}
        </div>
        <div className="mt-6 max-w-[560px]">
          <Label>comfortable · static (no onClick)</Label>
          <TimelineRow
            density="comfortable"
            time="20:00"
            title="W volleyball vs. Yale"
            meta="Pizzitola Center · athletics"
            category="athletics"
          />
        </div>
      </Section>

      {/* 10 panel */}
      <Section n="10" title="panel" note="right slide-over · 1px line + the app's ONLY shadow">
        <Row>
          <Button variant="ghost" onClick={() => setPanelOpen(true)}>
            Open detail panel
          </Button>
        </Row>
        <Panel
          open={panelOpen}
          onOpenChange={setPanelOpen}
          title="Brown Outing Club — general body"
          sub="19:04 · in 26 min · Sayles Hall"
          footer={
            <div className="flex items-center justify-between">
              <SourceBadge source="clubs" confidence={0.92} />
              <div className="flex gap-2">
                <Button variant="ghost">Open source ↗</Button>
                <Button variant="primary">Add to calendar</Button>
              </div>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <Row className="mb-0">
              <Chip category="club" selected />
              <Badge>weekly</Badge>
              <Badge variant="accent">starting soon</Badge>
            </Row>
            <p className="text-13 text-text-secondary">
              First general body meeting of the semester. Trip sign-ups for the fall break White
              Mountains traverse open tonight.
            </p>
            <DataTable
              aria-label="Event fields"
              columns={[
                {
                  key: "k",
                  header: "field",
                  mono: true,
                  width: "90px",
                  cell: (r: { k: string; v: string }) => r.k,
                },
                {
                  key: "v",
                  header: "value",
                  cell: (r: { k: string; v: string }) => (
                    <span className="text-text-primary">{r.v}</span>
                  ),
                },
              ]}
              rows={[
                { k: "when", v: "Tue 19:04 – 20:30" },
                { k: "where", v: "Sayles Hall, Main Green" },
                { k: "org", v: "Brown Outing Club" },
                { k: "cost", v: "free" },
              ]}
              rowKey={(r) => r.k}
            />
          </div>
        </Panel>
      </Section>

      {/* 11 states */}
      <Section
        n="11"
        title="async states"
        note="designed skeleton / empty / error — never a bare spinner"
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-4 border border-line bg-bg-raised p-4">
            <Label>loading — opacity pulse, no shimmer</Label>
            <Skeleton className="mb-2.5 h-4 w-2/3" />
            <SkeletonRows rows={4} />
          </div>
          <div className="rounded-4 border border-line bg-bg-raised p-4">
            <Label>empty — real copy + action</Label>
            <EmptyState
              icon={<CategoryIcon category="social" size={24} title="Social" />}
              title="Nothing on right now"
              body="It's 03:40 on a Tuesday. Scrub forward to tonight to see what's coming."
              action={<Button variant="ghost">Jump to tonight</Button>}
            />
          </div>
          <div className="rounded-4 border border-line bg-bg-raised p-4">
            <Label>error — say which source, keep the rest</Label>
            <EmptyState
              title="LiveWhale unreachable"
              body="Showing the last snapshot from 12 min ago. Other sources are unaffected."
              action={<Button variant="subtle">Retry now</Button>}
            />
          </div>
        </div>
        <div className="mt-6">
          <Label>source health</Label>
          <Row className="gap-5">
            <StatusDot status="ok" label="livewhale" detail="4 min ago" />
            <StatusDot status="ok" label="cab" detail="2 h ago" />
            <StatusDot status="stale" label="athletics_ics" detail="26 h ago" />
            <StatusDot status="error" label="bdh" detail="failed 09:12" />
          </Row>
        </div>
      </Section>

      <footer className="border-t border-line pt-6 font-mono text-12 text-text-faint">
        litmus §6.5 — passes as Bloomberg/Gotham dark, fails as v0 template · radius ≤ 6 · one
        shadow · one accent
      </footer>
    </div>
  );
}
