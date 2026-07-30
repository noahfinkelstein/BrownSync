(() => {
  const groups = [{"group":"code:ENVS 2980","srcdb":"202610","sections":[{"crn":"11877"},{"crn":"11878"},{"crn":"11879"},{"crn":"11880"},{"crn":"11881"},{"crn":"11882"},{"crn":"11883"},{"crn":"11884"},{"crn":"11885"},{"crn":"11886"},{"crn":"11887"}]},{"group":"code:ENVS 2981","srcdb":"202610","sections":[{"crn":"11888"},{"crn":"11889"},{"crn":"11890"},{"crn":"11891"},{"crn":"11892"},{"crn":"11893"},{"crn":"11894"},{"crn":"11895"},{"crn":"11896"},{"crn":"11897"},{"crn":"11898"},{"crn":"11899"}]},{"group":"code:EPI 0850","srcdb":"202610","sections":[{"crn":"14065"}]},{"group":"code:EPI 1700","srcdb":"202610","sections":[{"crn":"15347"}]}];
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
