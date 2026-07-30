import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const ROOT = "/Users/noah_finkelstein/Developer/BrownSync";
const RAW = path.join(ROOT, "scrape-work", "raw");
const PREVIEWS = path.join(ROOT, "scrape-work", "previews");
const SNAPSHOT_UTC = "2026-07-29T13:35:00Z";

const readJson = async (name) =>
  JSON.parse(await fs.readFile(path.join(RAW, name), "utf8"));

const groupBatchStarts = [0, 50, 100, 150, 200, 250, 300, 350, 400];
const undergraduateGroups = (
  await Promise.all(
    groupBatchStarts.map((start) =>
      readJson(path.join("student_groups", `batch-${start}.json`)),
    ),
  )
).flat();
const graduateGroups = await readJson("brown_graduate_student_groups.json");
const diningRaw = await readJson("brown_dining_menu_links.json");
const facultyMenus = await readJson("brown_faculty_club_menu_links.json");
const newsRaw = await readJson("brown_news_archive.json");
const eventsRaw = await readJson("brown_events_selected.json");
const academicCalendar = await readJson(
  "brown_academic_calendar_2026_2027.json",
);
const resourcesRaw = await readJson("brown_a_to_z_resources.json");
const bdhRaw = await readJson("brown_daily_herald_feed.json");
const athleticsEvents = await readJson("brown_athletics_events.json");
const osmRaw = await readJson("osm_college_hill_buildings.json");
const libraryHours = await readJson("brown_library_hours.json");

const cleanHtmlEntities = (value) =>
  String(value ?? "")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"')
    .trim();

const studentGroups = [
  ...undergraduateGroups.map((group) => ({
    group_type: "Undergraduate student group",
    name: group.name,
    description: group.description,
    contact_emails: group.email,
    advisor: group.advisor,
    funding_category: group.funding_category,
    tags: group.tags,
    website_url: group.website_url,
    instagram_url: group.instagram_url,
    facebook_url: group.facebook_url,
    linkedin_url: group.linkedin_url,
    youtube_url: group.youtube_url,
    twitter_url: group.twitter_url,
    tiktok_url: group.tiktok_url,
    other_social_urls: group.other_social_urls,
    source_url: group.source_url,
    directory_source_url: group.directory_source_url,
  })),
  ...graduateGroups.map((group) => ({
    group_type: group.group_type,
    name: group.name,
    description: group.description,
    contact_emails: group.contact_emails,
    advisor: "",
    funding_category: "",
    tags: "Graduate Student Council recognized group",
    website_url: group.website_url,
    instagram_url: "",
    facebook_url: "",
    linkedin_url: "",
    youtube_url: "",
    twitter_url: "",
    tiktok_url: "",
    other_social_urls: "",
    source_url: group.website_url || group.directory_source_url,
    directory_source_url: group.directory_source_url,
  })),
].sort((left, right) =>
  left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
);

const diningMenus = [
  ...diningRaw.locations.map((location) => ({
    dining_location: location.dining_location,
    menu_name: "Daily menus",
    menu_url: location.menu_url,
    menu_instructions: location.menu_instructions,
    source_url: location.source_url,
  })),
  ...diningRaw.menu_links
    .filter((item) => item.menu_url.endsWith("/search"))
    .map((item) => ({
      dining_location: "All dining locations",
      menu_name: item.dining_location,
      menu_url: item.menu_url,
      menu_instructions: "Search menu items across Brown Dining.",
      source_url: item.source_url,
    })),
  ...facultyMenus,
];

const brownNews = newsRaw.items;
const bdhNews = bdhRaw.items;
const events = eventsRaw.map((event) => {
  const location = cleanHtmlEntities(event.location);
  return {
    ...event,
    location: /no location for this event/i.test(location) ? "" : location,
  };
});
const resources = resourcesRaw.items;
const buildings = osmRaw.items;

const eventLocationMap = new Map();
for (const event of events) {
  if (!event.location) continue;
  const existing = eventLocationMap.get(event.location) || {
    location: event.location,
    event_count: 0,
    latitude: "",
    longitude: "",
    first_event_start: "",
    last_event_start: "",
    organizers: new Set(),
    source_url: "https://events.brown.edu/live/json/events",
  };
  existing.event_count += 1;
  if (existing.latitude === "" && event.latitude !== "") {
    existing.latitude = event.latitude;
    existing.longitude = event.longitude;
  }
  if (
    !existing.first_event_start ||
    event.start_date_iso < existing.first_event_start
  ) {
    existing.first_event_start = event.start_date_iso;
  }
  if (
    !existing.last_event_start ||
    event.start_date_iso > existing.last_event_start
  ) {
    existing.last_event_start = event.start_date_iso;
  }
  if (event.organizer) existing.organizers.add(event.organizer);
  eventLocationMap.set(event.location, existing);
}
const eventLocations = [...eventLocationMap.values()]
  .map((location) => ({
    ...location,
    organizers: [...location.organizers].sort().join(" | "),
  }))
  .sort(
    (left, right) =>
      right.event_count - left.event_count ||
      left.location.localeCompare(right.location),
  );

const classCsvText = await fs.readFile(
  path.join(ROOT, "brown_fall_2026_classes_and_locations.csv"),
  "utf8",
);
const classImport = await Workbook.fromCSV(classCsvText, {
  sheetName: "Classes",
});
const classValues = classImport
  .worksheets.getItem("Classes")
  .getUsedRange(true).values;
classValues[0][0] = String(classValues[0][0]).replace(/^\uFEFF/, "");
const classHeaders = classValues[0];
const classRows = classValues.slice(1);

const sourceRows = [
  {
    dataset: "Fall 2026 classes and locations",
    exported_file: "brown_fall_2026_classes_and_locations.csv",
    row_count: classRows.length,
    coverage: "All authenticated Fall 2026 CAB sections visible to the logged-in user",
    snapshot_utc: "2026-07-29T01:42:00Z",
    source_name: "Courses @ Brown (CAB)",
    source_url: "https://cab.brown.edu/",
    update_strategy: "Re-scrape after CAB schedule or room changes",
    notes: "Contains physical locations, remote/online markers, arranged meetings and publication status.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Student groups",
    exported_file: "brown_all_student_groups.csv",
    row_count: studentGroups.length,
    coverage: `${undergraduateGroups.length} undergraduate + ${graduateGroups.length} graduate organizations`,
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Student Activities + Graduate Student Council",
    source_url:
      "https://studentactivities.brown.edu/student-groups/undergraduate-student-groups",
    update_strategy: "Refresh each semester",
    notes: "Public descriptions, contact emails, advisors, funding categories and social links where published.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Dining menu links",
    exported_file: "brown_dining_menu_links.csv",
    row_count: diningMenus.length,
    coverage: "Seven Brown Dining locations, cross-location search and Faculty Club menus",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown Dining + Faculty Club",
    source_url: "https://menus.dining.brown.edu/",
    update_strategy: "Links are stable; menu contents remain live on Brown sites",
    notes: "The Dining SPA uses one shared URL; open it and select the named location.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Brown University news archive",
    exported_file: "brown_news_archive.csv",
    row_count: brownNews.length,
    coverage: `${newsRaw.expected_count} official articles from 2016-01-04 through 2026-07-28`,
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown University News",
    source_url: "https://www.brown.edu/news/all",
    update_strategy: "Daily metadata refresh",
    notes: "Metadata only: titles, dates, categories, links and image metadata; no article-body copying.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Brown Daily Herald current feed",
    exported_file: "brown_daily_herald_news.csv",
    row_count: bdhNews.length,
    coverage: `Current ${bdhNews.length}-item top-stories RSS feed`,
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "The Brown Daily Herald",
    source_url: "https://www.browndailyherald.com/feed",
    update_strategy: "Poll periodically; retain only metadata and short excerpts",
    notes: `Feed last built ${bdhRaw.last_build_date}.`,
    license_or_terms: "Publisher copyright applies",
  },
  {
    dataset: "Upcoming public events",
    exported_file: "brown_upcoming_events.csv",
    row_count: events.length,
    coverage: "1,000 event instances from 2026-07-29 through 2026-11-03",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown Events / LiveWhale JSON",
    source_url: "https://events.brown.edu/live/json/events",
    update_strategy: "Poll no more frequently than every 10 minutes",
    notes: "Feed maximum observed was 1,000; fields include public contacts, categories, URLs and coordinates.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Athletics calendar",
    exported_file: "brown_athletics_calendar.csv",
    row_count: athleticsEvents.length,
    coverage: "Currently published varsity events in the SIDEARM ICS feed",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown Bears Athletics",
    source_url: "https://brownbears.com/calendar.ashx/calendar.ics",
    update_strategy: "Poll at the feed's two-hour publication interval",
    notes: "Includes home/away inference, opponent, venue, streaming URL and event URL.",
    license_or_terms: "Brown Athletics site terms apply",
  },
  {
    dataset: "2026-2027 academic calendar",
    exported_file: "brown_academic_calendar_2026_2027.csv",
    row_count: academicCalendar.length,
    coverage: "Summer 2026, Fall 2026, Winter 2027 and Spring 2027",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown Registrar",
    source_url:
      "https://registrar.brown.edu/academic-calendar/2026-2027-academic-calendar",
    update_strategy: "Refresh after Registrar calendar changes",
    notes: "Includes multi-day date ranges and event links.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Campus A-Z resources",
    exported_file: "brown_a_to_z_resources.csv",
    row_count: resources.length,
    coverage: "All 300 entries in Brown's public A-Z directory",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown A-Z",
    source_url: "https://www.brown.edu/a-z",
    update_strategy: "Monthly refresh",
    notes: "Includes public phone, decoded public email, address, map and directory links where present.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Brown Library weekly hours",
    exported_file: "brown_library_hours.csv",
    row_count: libraryHours.length,
    coverage: "13 service/location rows across 2026-07-26 through 2026-08-01",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown University Library",
    source_url:
      "https://lib.brown.edu/using-library/visiting-library/locations-hours",
    update_strategy: "Refresh weekly or daily; hours are subject to change",
    notes: "Snapshot of the currently displayed seven-day hours table.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "College Hill building centroids",
    exported_file: "brown_college_hill_buildings.csv",
    row_count: buildings.length,
    coverage: "All OSM building ways in the Brown/College Hill bounding box",
    snapshot_utc: osmRaw.osm_timestamp,
    source_name: "OpenStreetMap via Overpass API",
    source_url: "https://overpass-api.de/",
    update_strategy: "Periodic OSM refresh; retain attribution",
    notes: `${buildings.filter((item) => item.name).length} named buildings; ${buildings.filter((item) => item.brown_relevant_hint).length} Brown-relevance hints. Not every footprint is Brown-owned.`,
    license_or_terms: "OpenStreetMap contributors, ODbL",
  },
  {
    dataset: "Event locations (derived)",
    exported_file: "brown_event_locations.csv",
    row_count: eventLocations.length,
    coverage: "Unique nonblank locations from the 1,000-event LiveWhale snapshot",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Derived from Brown Events / LiveWhale JSON",
    source_url: "https://events.brown.edu/live/json/events",
    update_strategy: "Rebuild with each event refresh",
    notes: "Aggregates event count, observed coordinates, date range and organizers.",
    license_or_terms: "Brown University site terms apply",
  },
  {
    dataset: "Brown campus map (live source)",
    exported_file: "",
    row_count: 0,
    coverage: "Interactive ArcGIS campus map; source catalog entry only",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown University Campus Map",
    source_url:
      "https://experience.arcgis.com/experience/dc278deab79e4fcaa875a81a1732e13e",
    update_strategy: "Evaluate ArcGIS service endpoints for a future gazetteer refresh",
    notes: "Linked for future ingestion; not duplicated in this snapshot.",
    license_or_terms: "Brown University / Esri terms apply",
  },
  {
    dataset: "Campus shuttle (live source)",
    exported_file: "",
    row_count: 0,
    coverage: "Live vehicle and route source; source catalog entry only",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown Shuttle / Passio GO",
    source_url: "https://brownuniversity.passiogo.com/",
    update_strategy: "Use as a live feed rather than a static snapshot",
    notes: "High-churn positions were intentionally not frozen into the CSV pack.",
    license_or_terms: "Passio GO and Brown Transportation terms apply",
  },
  {
    dataset: "Emergency information (live source)",
    exported_file: "",
    row_count: 0,
    coverage: "Current emergency-information page; source catalog entry only",
    snapshot_utc: SNAPSHOT_UTC,
    source_name: "Brown Emergency Information",
    source_url: "https://www.brown.edu/emergency",
    update_strategy: "Link live; do not cache for safety-critical display",
    notes: "Always show the live official page rather than a stale snapshot.",
    license_or_terms: "Brown University site terms apply",
  },
];

const datasets = [
  {
    file: "brown_all_student_groups.csv",
    sheet: "Student Groups",
    title: "Brown Student Groups",
    note: "457 public organizations: 424 undergraduate and 33 graduate groups.",
    headers: [
      "group_type",
      "name",
      "description",
      "contact_emails",
      "advisor",
      "funding_category",
      "tags",
      "website_url",
      "instagram_url",
      "facebook_url",
      "linkedin_url",
      "youtube_url",
      "twitter_url",
      "tiktok_url",
      "other_social_urls",
      "source_url",
      "directory_source_url",
    ],
    rows: studentGroups,
  },
  {
    file: "brown_dining_menu_links.csv",
    sheet: "Dining Menus",
    title: "Brown Dining Menu Links",
    note: "Links only, as requested. The Brown Dining SPA uses a shared URL for its seven locations.",
    headers: [
      "dining_location",
      "menu_name",
      "menu_url",
      "menu_instructions",
      "source_url",
    ],
    rows: diningMenus,
  },
  {
    file: "brown_news_archive.csv",
    sheet: "Brown News",
    title: "Brown University News Archive",
    note: "3,301 official news metadata records from January 2016 through July 2026.",
    headers: [
      "content_id",
      "title",
      "category",
      "published_at",
      "published_date",
      "article_url",
      "image_url",
      "image_alt",
      "archive_page_url",
      "archive_source_url",
    ],
    rows: brownNews,
  },
  {
    file: "brown_daily_herald_news.csv",
    sheet: "BDH Headlines",
    title: "Brown Daily Herald Current Feed",
    note: "Current RSS metadata with excerpts capped at 500 characters.",
    headers: [
      "title",
      "categories",
      "author",
      "published_at",
      "article_url",
      "summary_excerpt",
      "image_url",
      "source_url",
    ],
    rows: bdhNews,
  },
  {
    file: "brown_upcoming_events.csv",
    sheet: "LiveWhale Events",
    title: "Brown Upcoming Public Events",
    note: "1,000 upcoming event instances. The public feed cap was reached.",
    headers: [
      "event_id",
      "title",
      "start_date_iso",
      "end_date_iso",
      "display_date",
      "display_time",
      "timezone",
      "all_day",
      "repeats",
      "repeats_until",
      "series_start",
      "series_end",
      "canceled",
      "online",
      "online_type",
      "online_url",
      "location",
      "latitude",
      "longitude",
      "cost",
      "organizer",
      "event_types",
      "audiences",
      "campus_categories",
      "tags",
      "contact",
      "contact_emails",
      "registration_available",
      "registration_limit",
      "wait_list_available",
      "thumbnail_url",
      "thumbnail_alt",
      "source_url",
      "api_source_url",
    ],
    rows: events,
  },
  {
    file: "brown_athletics_calendar.csv",
    sheet: "Athletics",
    title: "Brown Athletics Calendar",
    note: "Current Brown Bears SIDEARM calendar feed with home/away and opponent fields.",
    headers: [
      "event_id",
      "title",
      "sport",
      "home_or_away",
      "opponent",
      "start_at",
      "end_at",
      "all_day",
      "location",
      "home_event",
      "streaming_url",
      "event_url",
      "source_url",
    ],
    rows: athleticsEvents,
  },
  {
    file: "brown_academic_calendar_2026_2027.csv",
    sheet: "Academic Calendar",
    title: "Brown Academic Calendar 2026-2027",
    note: "Registrar calendar across Summer 2026, Fall 2026, Winter 2027 and Spring 2027.",
    headers: [
      "academic_term",
      "month",
      "start_date_display",
      "end_date_display",
      "event",
      "event_url",
      "source_url",
    ],
    rows: academicCalendar,
  },
  {
    file: "brown_a_to_z_resources.csv",
    sheet: "A-Z Resources",
    title: "Brown Campus A-Z Resources",
    note: "All 300 public directory entries with contact and address information when published.",
    headers: [
      "content_id",
      "name",
      "email",
      "phone",
      "address",
      "map_url",
      "directory_entry_url",
      "directory_source_url",
    ],
    rows: resources,
  },
  {
    file: "brown_library_hours.csv",
    sheet: "Library Hours",
    title: "Brown Library Weekly Hours",
    note: "Snapshot for July 26-August 1, 2026. Hours are subject to change.",
    headers: [
      "location",
      "date",
      "day_of_week",
      "hours",
      "location_url",
      "source_url",
      "snapshot_note",
    ],
    rows: libraryHours,
  },
  {
    file: "brown_event_locations.csv",
    sheet: "Event Locations",
    title: "Brown Event Locations",
    note: "Unique location strings derived from the 1,000-event public feed snapshot.",
    headers: [
      "location",
      "event_count",
      "latitude",
      "longitude",
      "first_event_start",
      "last_event_start",
      "organizers",
      "source_url",
    ],
    rows: eventLocations,
  },
  {
    file: "brown_college_hill_buildings.csv",
    sheet: "College Hill Buildings",
    title: "College Hill Building Centroids",
    note: "2,150 OSM building ways in the campus-area bounding box. Not every footprint is Brown-owned.",
    headers: [
      "osm_type",
      "osm_id",
      "name",
      "brown_relevant_hint",
      "building_type",
      "amenity",
      "operator",
      "owner",
      "address_number",
      "address_street",
      "address_city",
      "address_state",
      "address_postcode",
      "levels",
      "wikidata",
      "wikipedia",
      "website",
      "latitude",
      "longitude",
      "osm_url",
      "source_url",
      "license",
    ],
    rows: buildings,
  },
  {
    file: "brown_data_sources.csv",
    sheet: "Sources",
    title: "BrownSync Public Data Sources",
    note: "Exported datasets plus verified live sources worth integrating next.",
    headers: [
      "dataset",
      "exported_file",
      "row_count",
      "coverage",
      "snapshot_utc",
      "source_name",
      "source_url",
      "update_strategy",
      "notes",
      "license_or_terms",
    ],
    rows: sourceRows,
  },
];

const normalizeCell = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join(" | ");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
};

const rowsToMatrix = (headers, rows) =>
  rows.map((row) => headers.map((header) => normalizeCell(row[header])));

const csvEscape = (value) => {
  const stringValue = String(normalizeCell(value));
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
};

const writeCsv = async (dataset) => {
  const lines = [
    dataset.headers.map(csvEscape).join(","),
    ...dataset.rows.map((row) =>
      dataset.headers.map((header) => csvEscape(row[header])).join(","),
    ),
  ];
  const outputPath = path.join(ROOT, dataset.file);
  await fs.writeFile(outputPath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
  const validation = await Workbook.fromCSV(await fs.readFile(outputPath, "utf8"), {
    sheetName: "Validation",
  });
  const used = validation.worksheets
    .getItem("Validation")
    .getUsedRange(true);
  if (used.rowCount !== dataset.rows.length + 1) {
    throw new Error(
      `${dataset.file}: expected ${dataset.rows.length + 1} rows, got ${used.rowCount}`,
    );
  }
  if (used.columnCount !== dataset.headers.length) {
    throw new Error(
      `${dataset.file}: expected ${dataset.headers.length} columns, got ${used.columnCount}`,
    );
  }
  return {
    file: dataset.file,
    rows: used.rowCount - 1,
    columns: used.columnCount,
  };
};

const csvValidation = [];
for (const dataset of datasets) {
  csvValidation.push(await writeCsv(dataset));
}

const workbook = Workbook.create();
const BROWN = "#4E3629";
const RED = "#C00404";
const CREAM = "#F4EDE4";
const WHITE = "#FFFFFF";
const GOLD = "#C6A664";
const TEXT = "#2D2926";

const columnLetter = (index) => {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

const widthForHeader = (header) => {
  if (
    /description|notes|coverage|update_strategy|summary_excerpt|instructions/i.test(
      header,
    )
  )
    return 48;
  if (/url|source/i.test(header)) return 42;
  if (/title|event|location|organizers|tags|address/i.test(header)) return 34;
  if (/date|time|published|start|end/i.test(header)) return 21;
  if (/latitude|longitude|count|id|status|term|category|sport/i.test(header))
    return 17;
  return 20;
};

const addStyledSheet = ({ sheetName, title, note, headers, rows }) => {
  const sheet = workbook.worksheets.add(sheetName);
  sheet.showGridLines = false;
  const lastColumn = columnLetter(headers.length - 1);
  const titleLastColumn = columnLetter(Math.min(headers.length, 10) - 1);
  sheet.getRange(`A1:${titleLastColumn}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A2:${titleLastColumn}2`).merge();
  sheet.getRange("A2").values = [[`${note} Snapshot: ${SNAPSHOT_UTC}`]];
  const matrix = [headers, ...rowsToMatrix(headers, rows)];
  sheet
    .getRangeByIndexes(3, 0, matrix.length, headers.length)
    .writeValues(matrix);

  sheet.getRange(`A1:${lastColumn}1`).format = {
    fill: BROWN,
    font: { bold: true, color: WHITE, size: 16 },
    verticalAlignment: "center",
  };
  sheet.getRange(`A1:${lastColumn}1`).format.rowHeight = 28;
  sheet.getRange(`A2:${lastColumn}2`).format = {
    fill: CREAM,
    font: { color: TEXT, italic: true, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${lastColumn}2`).format.rowHeight = 30;
  sheet.getRange(`A4:${lastColumn}4`).format = {
    fill: RED,
    font: { bold: true, color: WHITE, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    borders: { bottom: { color: GOLD, style: "thick" } },
  };
  sheet.getRange(`A4:${lastColumn}4`).format.rowHeight = 30;
  if (rows.length) {
    sheet.getRange(`A5:${lastColumn}${rows.length + 4}`).format = {
      font: { color: TEXT, size: 9 },
      verticalAlignment: "top",
      wrapText: false,
    };
  }
  headers.forEach((header, index) => {
    sheet
      .getRangeByIndexes(0, index, rows.length + 4, 1)
      .format.columnWidth = widthForHeader(header);
    if (
      rows.length &&
      /description|summary_excerpt|notes|coverage|instructions|event$|title/i.test(
        header,
      )
    ) {
      sheet
        .getRangeByIndexes(4, index, rows.length, 1)
        .format.wrapText = true;
    }
    if (
      rows.length &&
      /^(snapshot_utc|published_at|start_at|end_at|start_date_iso|end_date_iso|series_start|series_end|first_event_start|last_event_start)$/.test(
        header,
      )
    ) {
      sheet
        .getRangeByIndexes(4, index, rows.length, 1)
        .setNumberFormat("yyyy-mm-dd hh:mm:ss");
    }
    if (
      rows.length &&
      /^(date|start_date|end_date)$/.test(header)
    ) {
      sheet
        .getRangeByIndexes(4, index, rows.length, 1)
        .setNumberFormat("yyyy-mm-dd");
    }
  });
  if (
    rows.length &&
    headers.some((header) =>
      /description|summary_excerpt|notes|coverage|instructions|event$|title/i.test(
        header,
      ),
    )
  ) {
    sheet
      .getRangeByIndexes(4, 0, rows.length, headers.length)
      .format.rowHeight = 34;
  }
  sheet.freezePanes.freezeRows(4);
  sheet.tables.add(
    `A4:${lastColumn}${rows.length + 4}`,
    true,
    `${sheetName.replace(/[^A-Za-z0-9]/g, "")}Table`,
  );
  return sheet;
};

addStyledSheet({
  sheetName: "Sources",
  title: "BrownSync Public Data Sources",
  note: "Start here: exported snapshots, coverage notes, refresh cadence and verified live sources.",
  headers: datasets.find((dataset) => dataset.sheet === "Sources").headers,
  rows: sourceRows,
});

addStyledSheet({
  sheetName: "Fall 2026 Classes",
  title: "Brown Fall 2026 Classes and Locations",
  note: "Authenticated CAB export with published physical rooms, remote markers and arranged meetings.",
  headers: classHeaders,
  rows: classRows.map((row) =>
    Object.fromEntries(classHeaders.map((header, index) => [header, row[index]])),
  ),
});

for (const dataset of datasets.filter((dataset) => dataset.sheet !== "Sources")) {
  addStyledSheet({
    sheetName: dataset.sheet,
    title: dataset.title,
    note: dataset.note,
    headers: dataset.headers,
    rows: dataset.rows,
  });
}

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 4000,
});

const workbookSummary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 3,
  tableMaxCols: 8,
  tableMaxCellChars: 60,
});

await fs.mkdir(PREVIEWS, { recursive: true });
const previewResults = [];
for (const sheetInfo of [
  {
    sheet: "Sources",
    headers: datasets.find((dataset) => dataset.sheet === "Sources").headers,
  },
  { sheet: "Fall 2026 Classes", headers: classHeaders },
  ...datasets
    .filter((dataset) => dataset.sheet !== "Sources")
    .map((dataset) => ({ sheet: dataset.sheet, headers: dataset.headers })),
]) {
  const previewColumn = columnLetter(Math.min(sheetInfo.headers.length, 10) - 1);
  const preview = await workbook.render({
    sheetName: sheetInfo.sheet,
    range: `A1:${previewColumn}16`,
    scale: 1,
    format: "png",
  });
  const previewName = `${sheetInfo.sheet
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.png`;
  await fs.writeFile(
    path.join(PREVIEWS, previewName),
    new Uint8Array(await preview.arrayBuffer()),
  );
  previewResults.push(previewName);
}

const workbookPath = path.join(ROOT, "brownsync_public_data.xlsx");
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(workbookPath);

const manifest = {
  snapshot_utc: SNAPSHOT_UTC,
  workbook: path.basename(workbookPath),
  csv_validation: csvValidation,
  classes: { rows: classRows.length, columns: classHeaders.length },
  workbook_sheets: 13,
  previews: previewResults,
  formula_errors: formulaErrors.ndjson,
  workbook_summary: workbookSummary.ndjson,
};
await fs.writeFile(
  path.join(ROOT, "scrape-work", "build_manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      workbook: workbookPath,
      csv_validation: csvValidation,
      class_rows: classRows.length,
      sheet_count: manifest.workbook_sheets,
      preview_count: previewResults.length,
      formula_error_scan: formulaErrors.ndjson,
    },
    null,
    2,
  ),
);
