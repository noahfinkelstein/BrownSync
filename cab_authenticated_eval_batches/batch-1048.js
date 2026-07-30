(() => {
  const groups = [{"group":"code:LITR 1300","srcdb":"202610","sections":[{"crn":"12162"},{"crn":"12163"},{"crn":"12164"},{"crn":"12165"},{"crn":"12166"},{"crn":"12167"},{"crn":"12168"},{"crn":"12169"}]},{"group":"code:LITR 1310","srcdb":"202610","sections":[{"crn":"12170"},{"crn":"12171"},{"crn":"12172"},{"crn":"12173"},{"crn":"12174"},{"crn":"12175"},{"crn":"12176"},{"crn":"12177"},{"crn":"12178"},{"crn":"12179"},{"crn":"12180"}]},{"group":"code:LITR 1510","srcdb":"202610","sections":[{"crn":"12181"},{"crn":"12182"},{"crn":"12183"},{"crn":"12184"},{"crn":"12185"},{"crn":"12186"},{"crn":"12187"},{"crn":"12188"},{"crn":"12189"},{"crn":"12190"},{"crn":"12191"},{"crn":"12192"},{"crn":"12193"},{"crn":"12194"},{"crn":"12195"},{"crn":"12196"},{"crn":"12197"},{"crn":"12198"},{"crn":"12199"},{"crn":"12200"},{"crn":"13459"}]},{"group":"code:LITR 2010A","srcdb":"202610","sections":[{"crn":"13798"}]}];
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
                    .replace(/\s+/g, " ")
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
