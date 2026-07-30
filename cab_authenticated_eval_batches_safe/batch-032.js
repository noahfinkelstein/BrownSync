(() => {
  const groups = [{"group":"code:CSCI 1971","srcdb":"202610","sections":[{"crn":"11367"},{"crn":"11368"},{"crn":"11369"},{"crn":"11370"},{"crn":"11371"},{"crn":"11372"},{"crn":"11373"},{"crn":"11374"},{"crn":"11375"},{"crn":"11376"},{"crn":"11377"},{"crn":"11378"},{"crn":"11379"},{"crn":"11380"},{"crn":"11381"},{"crn":"11382"},{"crn":"11383"},{"crn":"11384"},{"crn":"11385"},{"crn":"11386"},{"crn":"11387"},{"crn":"11388"},{"crn":"11389"},{"crn":"11390"},{"crn":"11391"},{"crn":"11392"},{"crn":"11393"},{"crn":"11394"},{"crn":"11395"},{"crn":"11396"},{"crn":"11397"}]}];
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
