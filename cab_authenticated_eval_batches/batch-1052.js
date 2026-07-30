(() => {
  const groups = [{"group":"code:LITR 2010B","srcdb":"202610","sections":[{"crn":"13805"}]},{"group":"code:LITR 2230","srcdb":"202610","sections":[{"crn":"12201"},{"crn":"12202"},{"crn":"12203"},{"crn":"12204"},{"crn":"12205"},{"crn":"12206"},{"crn":"12207"},{"crn":"12208"}]},{"group":"code:LITR 2310","srcdb":"202610","sections":[{"crn":"12209"},{"crn":"12210"},{"crn":"12211"},{"crn":"12212"},{"crn":"12213"},{"crn":"12214"},{"crn":"12215"},{"crn":"12216"},{"crn":"12217"}]},{"group":"code:LITR 2410","srcdb":"202610","sections":[{"crn":"12218"},{"crn":"12219"},{"crn":"12220"},{"crn":"12221"},{"crn":"12222"},{"crn":"12223"},{"crn":"12224"},{"crn":"12225"},{"crn":"12226"},{"crn":"12227"},{"crn":"12228"},{"crn":"12229"},{"crn":"12230"},{"crn":"12231"},{"crn":"12232"},{"crn":"12233"},{"crn":"12234"}]}];
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
