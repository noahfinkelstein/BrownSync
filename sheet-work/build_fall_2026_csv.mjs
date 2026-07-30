import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const workspace = "/Users/noah_finkelstein/Developer/BrownSync";
const batchDirectory = path.join(workspace, "fall_2026_cab_group_batches");
const authenticatedBatchDirectory = path.join(
  workspace,
  "fall_2026_cab_authenticated_batches_safe",
);
const outputPath = path.join(
  workspace,
  "brown_fall_2026_classes_and_locations.csv",
);
const previewPath = path.join(workspace, "sheet-work", "fall_2026_preview.png");

const batchFiles = (await fs.readdir(batchDirectory))
  .filter((name) => /^batch-\d+\.json$/.test(name))
  .sort(
    (left, right) =>
      Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]),
  );

const groups = [];
for (const batchFile of batchFiles) {
  const payload = JSON.parse(
    await fs.readFile(path.join(batchDirectory, batchFile), "utf8"),
  );
  groups.push(...payload);
}

const authenticatedBatchFiles = (
  await fs.readdir(authenticatedBatchDirectory)
)
  .filter((name) => /^batch-\d+\.json$/.test(name))
  .sort(
    (left, right) =>
      Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]),
  );

const authenticatedRows = [];
for (const batchFile of authenticatedBatchFiles) {
  const payload = JSON.parse(
    await fs.readFile(
      path.join(authenticatedBatchDirectory, batchFile),
      "utf8",
    ),
  );
  authenticatedRows.push(...payload);
}

const authenticatedByCrn = new Map(
  authenticatedRows.map((row) => [String(row.crn), row]),
);
if (
  authenticatedRows.length !== 5275 ||
  authenticatedByCrn.size !== authenticatedRows.length
) {
  throw new Error(
    `Authenticated extraction mismatch: ${authenticatedRows.length} rows and ${authenticatedByCrn.size} unique CRNs`,
  );
}
const authenticatedErrors = authenticatedRows.filter((row) => row.error);
if (authenticatedErrors.length) {
  throw new Error(
    `Authenticated extraction contains ${authenticatedErrors.length} errors`,
  );
}

const statusLabels = {
  A: "Active",
  C: "Cancelled",
  F: "Full",
  X: "Cross-listed reference",
};

function decodeHtml(text) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return text
    .replace(
      /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
      (entity, code) => {
        if (code[0] === "#") {
          const value =
            code[1].toLowerCase() === "x"
              ? Number.parseInt(code.slice(2), 16)
              : Number.parseInt(code.slice(1), 10);
          return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
        }
        return entities[code.toLowerCase()] ?? entity;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text) {
  return decodeHtml(text.replace(/<[^>]*>/g, " "));
}

function parseAuthenticatedMeetings(meetingHtml) {
  const meetings = [
    ...meetingHtml.matchAll(
      /<div\b[^>]*class=["'][^"']*\bmeet\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    ),
  ].map((match) => {
    const innerHtml = match[1];
    const roomMatch = innerHtml.match(
      /<span\b[^>]*class=["'][^"']*\bmeet-room-[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/span>/i,
    );
    const room = roomMatch ? stripHtml(roomMatch[1]) : "";
    const withoutRoom = roomMatch
      ? innerHtml.replace(roomMatch[0], "")
      : innerHtml;
    const textWithoutRoom = stripHtml(withoutRoom);
    const locationTbd = /\bLocation TBD\b/i.test(textWithoutRoom);
    const schedule = textWithoutRoom
      .replace(/\bLocation TBD\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return { schedule, room, locationTbd };
  });

  return {
    schedules: [...new Set(meetings.map((meeting) => meeting.schedule).filter(Boolean))],
    rooms: [...new Set(meetings.map((meeting) => meeting.room).filter(Boolean))],
    hasLocationTbd: meetings.some((meeting) => meeting.locationTbd),
  };
}

function classifyMeeting(section, authenticatedDetail) {
  const authenticatedRaw = (
    authenticatedDetail?.schedule_and_location || ""
  ).trim();
  const raw = authenticatedRaw || (section.schedule_and_location || "").trim();
  const parsed = parseAuthenticatedMeetings(
    authenticatedDetail?.meeting_html || "",
  );
  const isCrossListedReference = section.class_status === "X";
  const isOnline = /(?:course offered online|online|remote)/i.test(raw);
  const isTba = /^(?:TBA|To Be Arranged|Arranged)$/i.test(raw);
  const isTimedMeeting =
    /^(?:M|T|W|Th|F|Sa|Su|[MTWThFSaSu]+)\s+\d/i.test(raw);

  if (isCrossListedReference) {
    return {
      meetingSchedule: "",
      location: "See primary listing",
      locationStatus: "Cross-listed reference",
    };
  }
  if (parsed.rooms.length) {
    return {
      meetingSchedule: parsed.schedules.join(" | "),
      location: parsed.rooms.join(" | "),
      locationStatus: "Physical location published",
    };
  }
  if (isOnline) {
    return {
      meetingSchedule: "",
      location: "Online",
      locationStatus: "Online",
    };
  }
  if (parsed.hasLocationTbd) {
    return {
      meetingSchedule: parsed.schedules.join(" | "),
      location: "TBD",
      locationStatus: "Physical location not yet published",
    };
  }
  if (isTba) {
    return {
      meetingSchedule: "TBA",
      location: "TBA",
      locationStatus: "TBA",
    };
  }
  if (isTimedMeeting) {
    return {
      meetingSchedule: parsed.schedules.join(" | ") || raw,
      location: "Not published in CAB",
      locationStatus: "Physical location not yet published",
    };
  }
  if (!raw) {
    return {
      meetingSchedule: "",
      location: "Not listed in CAB",
      locationStatus: "No meeting listed",
    };
  }
  return {
    meetingSchedule: "",
    location: raw,
    locationStatus: "Physical location published",
  };
}

const records = groups
  .flatMap((group) =>
    group.sections.map((section) => {
      const authenticatedDetail = authenticatedByCrn.get(String(section.crn));
      if (!authenticatedDetail) {
        throw new Error(`Missing authenticated detail for CRN ${section.crn}`);
      }
      const meeting = classifyMeeting(section, authenticatedDetail);
      return {
        term: group.term,
        term_code: group.term_code,
        course_code: section.course_code,
        course_title: section.course_title,
        section: section.section,
        crn: section.crn,
        meeting_schedule: meeting.meetingSchedule,
        location: meeting.location,
        location_status: meeting.locationStatus,
        instructor: section.instructor,
        schedule_type_code: section.schedule_type,
        class_status: statusLabels[section.class_status] || section.class_status,
        cab_status_code: section.class_status,
        cancelled: Boolean(section.cancelled),
        start_date: section.start_date,
        end_date: section.end_date,
        cab_schedule_and_location:
          authenticatedDetail.schedule_and_location ||
          section.schedule_and_location,
        source_url: group.source_url,
      };
    }),
  )
  .sort(
    (left, right) =>
      left.course_code.localeCompare(right.course_code) ||
      left.section.localeCompare(right.section) ||
      left.crn.localeCompare(right.crn),
  );

const uniqueKeys = new Set(
  records.map(
    (row) => `${row.term_code}|${row.course_code}|${row.section}|${row.crn}`,
  ),
);
if (uniqueKeys.size !== records.length) {
  throw new Error(
    `Duplicate section keys found: ${records.length - uniqueKeys.size}`,
  );
}

const headers = [
  "term",
  "term_code",
  "course_code",
  "course_title",
  "section",
  "crn",
  "meeting_schedule",
  "location",
  "location_status",
  "instructor",
  "schedule_type_code",
  "class_status",
  "cab_status_code",
  "cancelled",
  "start_date",
  "end_date",
  "cab_schedule_and_location",
  "source_url",
];

function csvCell(value) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "boolean"
        ? value
          ? "true"
          : "false"
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvRows = [
  headers.join(","),
  ...records.map((record) =>
    headers.map((header) => csvCell(record[header])).join(","),
  ),
];
const csvText = `${csvRows.join("\r\n")}\r\n`;

const workbook = await Workbook.fromCSV(csvText, {
  sheetName: "Fall 2026 Classes",
});
const sheet = workbook.worksheets.getItem("Fall 2026 Classes");
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange("A1:R1").format = {
  fill: "#4E3629",
  font: { bold: true, color: "#FFFFFF" },
  wrapText: true,
  borders: {
    bottom: { style: "medium", color: "#C6A664" },
  },
};
sheet.getRange("A1:R1").format.rowHeightPx = 42;
sheet.getRange("A2:R5276").format.font = {
  name: "Aptos",
  size: 10,
};
sheet.getRange("A2:R25").format.rowHeightPx = 34;
sheet.getRange("D2:D25").format.wrapText = true;
sheet.getRange("A2:R5276").format.borders = {
  insideHorizontal: { style: "thin", color: "#E8E2DE" },
};
sheet.getRange("A:A").format.columnWidth = 12;
sheet.getRange("B:B").format.columnWidth = 11;
sheet.getRange("C:C").format.columnWidth = 15;
sheet.getRange("D:D").format.columnWidth = 48;
sheet.getRange("E:F").format.columnWidth = 11;
sheet.getRange("G:G").format.columnWidth = 24;
sheet.getRange("H:H").format.columnWidth = 24;
sheet.getRange("I:I").format.columnWidth = 31;
sheet.getRange("J:J").format.columnWidth = 18;
sheet.getRange("K:K").format.columnWidth = 20;
sheet.getRange("L:M").format.columnWidth = 18;
sheet.getRange("N:N").format.columnWidth = 12;
sheet.getRange("O:P").format.columnWidth = 13;
sheet.getRange("Q:Q").format.columnWidth = 28;
sheet.getRange("R:R").format.columnWidth = 27;

const tableCheck = await workbook.inspect({
  kind: "table",
  range: "Fall 2026 Classes!A1:R12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 18,
  maxChars: 10000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
  maxChars: 4000,
});
const usedRange = sheet.getUsedRange(true);
const usedValues = usedRange.values;
const usedRows = usedValues.length;
const usedColumns = usedValues[0]?.length || 0;
if (usedRows !== records.length + 1 || usedColumns !== headers.length) {
  throw new Error(
    `CSV shape mismatch: expected ${records.length + 1}x${headers.length}, got ${usedRows}x${usedColumns}`,
  );
}
const preview = await workbook.render({
  sheetName: "Fall 2026 Classes",
  range: "A1:R25",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  previewPath,
  new Uint8Array(await preview.arrayBuffer()),
);

await fs.writeFile(outputPath, `\uFEFF${csvText}`, "utf8");

const countsByLocationStatus = Object.fromEntries(
  [...new Set(records.map((record) => record.location_status))]
    .sort()
    .map((status) => [
      status,
      records.filter((record) => record.location_status === status).length,
    ]),
);
const countsByClassStatus = Object.fromEntries(
  [...new Set(records.map((record) => record.class_status))]
    .sort()
    .map((status) => [
      status,
      records.filter((record) => record.class_status === status).length,
    ]),
);

console.log(
  JSON.stringify(
    {
      outputPath,
      previewPath,
      batchFiles: batchFiles.length,
      authenticatedBatchFiles: authenticatedBatchFiles.length,
      authenticatedRows: authenticatedRows.length,
      groups: groups.length,
      records: records.length,
      uniqueKeys: uniqueKeys.size,
      usedRows,
      usedColumns,
      countsByLocationStatus,
      countsByClassStatus,
      cancelled: records.filter((record) => record.cancelled).length,
      physicalLocations: [
        ...new Set(
          records
            .filter(
              (record) =>
                record.location_status === "Physical location published",
            )
            .map((record) => record.location),
        ),
      ].sort(),
      tableCheck: tableCheck.ndjson,
      formulaErrors: formulaErrors.ndjson,
    },
    null,
    2,
  ),
);
