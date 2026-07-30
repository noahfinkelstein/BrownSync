import fs from "node:fs";

const inputPath =
  "/Users/noah_finkelstein/Developer/BrownSync/scrape-work/raw/brown_athletics_calendar.ics";
const raw = fs.readFileSync(inputPath, "utf8").replace(/\r\n/g, "\n");
const unfolded = raw.replace(/\n[ \t]/g, "");
const blocks = unfolded.match(/BEGIN:VEVENT\n[\s\S]*?\nEND:VEVENT/g) || [];

const unescapeIcs = (value = "") =>
  value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/&amp;/g, "&")
    .trim();

const getProperty = (block, name) => {
  const match = block.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "m"));
  return match ? unescapeIcs(match[1]) : "";
};

const toIso = (value) => {
  if (!value) return "";
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
  );
  if (!match) return value;
  const [, year, month, day, hour, minute, second, zulu] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${zulu || ""}`;
};

const items = blocks.map((block) => {
  const title = getProperty(block, "SUMMARY");
  const match = title.match(/^Brown University (.+?) (vs|at) (.+)$/);
  const description = getProperty(block, "DESCRIPTION");
  const streamingMatch = description.match(
    /Streaming Video:\s*(https?:\/\/\S+)/i,
  );
  const location = getProperty(block, "LOCATION");
  return {
    event_id: getProperty(block, "UID"),
    title,
    sport: match?.[1] || "",
    home_or_away: match?.[2] === "vs" ? "Home" : match?.[2] === "at" ? "Away" : "",
    opponent: match?.[3] || "",
    start_at: toIso(getProperty(block, "DTSTART")),
    end_at: toIso(getProperty(block, "DTEND")),
    all_day: /^\d{8}$/.test(getProperty(block, "DTSTART")),
    location,
    home_event: /^Providence,\s*R\.I\./i.test(location),
    streaming_url: streamingMatch?.[1] || "",
    event_url: getProperty(block, "URL"),
    source_url: "https://brownbears.com/calendar.ashx/calendar.ics",
  };
});

process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
