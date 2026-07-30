(() => {
  const groups = [{"group":"code:HISP 0650","srcdb":"202610","sections":[{"crn":"15166"},{"crn":"15167"}]},{"group":"code:HISP 0750Z","srcdb":"202610","sections":[{"crn":"15168"}]},{"group":"code:HISP 1240P","srcdb":"202610","sections":[{"crn":"15382"}]},{"group":"code:HISP 1331T","srcdb":"202610","sections":[{"crn":"15383"}]},{"group":"code:HISP 1371R","srcdb":"202610","sections":[{"crn":"15758"}]},{"group":"code:HISP 1602C","srcdb":"202610","sections":[{"crn":"14672"}]},{"group":"code:HISP 1980","srcdb":"202610","sections":[{"crn":"13712"},{"crn":"14524"}]},{"group":"code:HISP 1990","srcdb":"202610","sections":[{"crn":"12041"},{"crn":"12042"},{"crn":"12043"},{"crn":"14387"},{"crn":"14508"}]},{"group":"code:HISP 2350M","srcdb":"202610","sections":[{"crn":"14823"}]},{"group":"code:HISP 2450","srcdb":"202610","sections":[{"crn":"13331"}]},{"group":"code:HISP 2620Q","srcdb":"202610","sections":[{"crn":"15165"}]},{"group":"code:HISP 2970","srcdb":"202610","sections":[{"crn":"13332"}]},{"group":"code:HISP 2980","srcdb":"202610","sections":[{"crn":"12044"},{"crn":"12045"},{"crn":"12046"},{"crn":"12047"},{"crn":"12048"},{"crn":"12049"},{"crn":"12050"},{"crn":"13506"}]},{"group":"code:HISP 2990","srcdb":"202610","sections":[{"crn":"13333"}]},{"group":"code:HISP 2990A","srcdb":"202610","sections":[{"crn":"14824"}]},{"group":"code:HISP 2991","srcdb":"202610","sections":[{"crn":"12051"},{"crn":"12052"},{"crn":"12053"}]},{"group":"code:HIST 0150A","srcdb":"202610","sections":[{"crn":"13837"}]},{"group":"code:HIST 0233","srcdb":"202610","sections":[{"crn":"13832"}]},{"group":"code:HIST 0252","srcdb":"202610","sections":[{"crn":"13846"}]},{"group":"code:HIST 0559C","srcdb":"202610","sections":[{"crn":"13842"}]},{"group":"code:HIST 0592","srcdb":"202610","sections":[{"crn":"13822"}]},{"group":"code:HIST 0658D","srcdb":"202610","sections":[{"crn":"13840"}]},{"group":"code:HIST 0930L","srcdb":"202610","sections":[{"crn":"15869"}]},{"group":"code:HIST 0931B","srcdb":"202610","sections":[{"crn":"15816"}]},{"group":"code:HIST 0931E","srcdb":"202610","sections":[{"crn":"16083"}]}];
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
