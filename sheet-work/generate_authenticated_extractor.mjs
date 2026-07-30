import fs from "node:fs/promises";
import path from "node:path";

const workspace = "/Users/noah_finkelstein/Developer/BrownSync";
const batchDirectory = path.join(workspace, "fall_2026_cab_group_batches");
const outputPath = path.join(workspace, "cab_extract_authenticated_batch.js");
const evalBatchDirectory = path.join(
  workspace,
  "cab_authenticated_eval_batches_safe",
);

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
  for (const group of payload) {
    groups.push({
      group: `code:${group.course_code}`,
      srcdb: group.term_code || "202610",
      sections: group.sections.map((section) => ({ crn: section.crn })),
    });
  }
}

function buildExtractor(batchGroups) {
  return `(() => {
  const groups = ${JSON.stringify(batchGroups)};
  const extractGroup = (group) => {
    const groupRows = [];
    return group.sections
      .reduce(
        (previous, section) =>
          previous.then(() => {
            const key = "crn:" + section.crn;
            return fose.detailsAPI
              .fetchFor(group.group, key, key, group.srcdb)
              .then((detail) => {
                const meetingContainer = document.createElement("div");
                meetingContainer.innerHTML = detail.meeting_html || "";
                groupRows.push({
                  crn: String(detail.crn || section.crn),
                  course_code:
                    detail.code || group.group.replace(/^code:/, ""),
                  meeting_html: detail.meeting_html || "",
                  schedule_and_location: (meetingContainer.textContent || "")
                    .replace(/\\s+/g, " ")
                    .trim(),
                });
              })
              .catch((error) => {
                groupRows.push({
                  crn: String(section.crn),
                  course_code: group.group.replace(/^code:/, ""),
                  meeting_html: "",
                  schedule_and_location: "",
                  error: String(error),
                });
              });
          }),
        Promise.resolve(),
      )
      .then(() => groupRows);
  };

  const starts = Array.from(
    { length: Math.ceil(groups.length / 4) },
    (_, index) => index * 4,
  );
  const rows = [];

  return starts
    .reduce(
      (previous, start) =>
        previous
          .then(() =>
            Promise.all(groups.slice(start, start + 4).map(extractGroup)),
          )
          .then((groupRows) => rows.push(...groupRows.flat())),
      Promise.resolve(),
    )
    .then(() => JSON.stringify(rows))
    .catch((error) =>
      JSON.stringify({
        top_error: String(error),
        stack: error && error.stack ? String(error.stack) : "",
      }),
    );
})()
`;
}

const extractor = buildExtractor(groups);
await fs.writeFile(outputPath, extractor, "utf8");

await fs.mkdir(evalBatchDirectory, { recursive: true });
const evalBatches = [];
let pendingGroups = [];
let pendingSections = 0;

function flushPendingGroups() {
  if (pendingGroups.length) {
    evalBatches.push(pendingGroups);
    pendingGroups = [];
    pendingSections = 0;
  }
}

for (const group of groups) {
  if (group.sections.length > 50) {
    flushPendingGroups();
    for (let start = 0; start < group.sections.length; start += 50) {
      evalBatches.push([
        {
          ...group,
          sections: group.sections.slice(start, start + 50),
        },
      ]);
    }
    continue;
  }

  if (
    pendingGroups.length >= 25 ||
    pendingSections + group.sections.length > 100
  ) {
    flushPendingGroups();
  }
  pendingGroups.push(group);
  pendingSections += group.sections.length;
}
flushPendingGroups();

for (let index = 0; index < evalBatches.length; index += 1) {
  await fs.writeFile(
    path.join(
      evalBatchDirectory,
      `batch-${String(index).padStart(3, "0")}.js`,
    ),
    buildExtractor(evalBatches[index]),
    "utf8",
  );
}

console.log(
  JSON.stringify({
    outputPath,
    evalBatchDirectory,
    evalBatches: evalBatches.length,
    groups: groups.length,
    sections: groups.reduce(
      (count, group) => count + group.sections.length,
      0,
    ),
  }),
);
