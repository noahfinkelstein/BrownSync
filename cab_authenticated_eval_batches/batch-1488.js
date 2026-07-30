(() => {
  const groups = [{"group":"code:STS 1700B","srcdb":"202610","sections":[{"crn":"15785"}]},{"group":"code:STS 1700G","srcdb":"202610","sections":[{"crn":"15775"}]},{"group":"code:STS 1900","srcdb":"202610","sections":[{"crn":"13461"}]},{"group":"code:STS 1970","srcdb":"202610","sections":[{"crn":"13151"},{"crn":"13152"},{"crn":"13153"},{"crn":"13154"},{"crn":"13155"},{"crn":"13156"},{"crn":"13157"},{"crn":"13158"},{"crn":"13159"},{"crn":"13160"},{"crn":"13161"},{"crn":"13162"},{"crn":"13163"},{"crn":"13164"},{"crn":"13165"},{"crn":"13166"},{"crn":"13167"},{"crn":"13168"},{"crn":"13169"},{"crn":"13170"},{"crn":"13171"},{"crn":"13172"},{"crn":"13173"},{"crn":"13174"},{"crn":"13175"},{"crn":"13176"},{"crn":"13177"},{"crn":"13178"},{"crn":"13179"}]}];
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
