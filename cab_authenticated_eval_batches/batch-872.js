(() => {
  const groups = [{"group":"code:HIST 1980C","srcdb":"202610","sections":[{"crn":"15818"}]},{"group":"code:HIST 1981T","srcdb":"202610","sections":[{"crn":"16195"}]},{"group":"code:HIST 1990","srcdb":"202610","sections":[{"crn":"12054"},{"crn":"12055"},{"crn":"12056"},{"crn":"12057"},{"crn":"12058"},{"crn":"12059"},{"crn":"12060"},{"crn":"12061"},{"crn":"12062"},{"crn":"12063"},{"crn":"12064"},{"crn":"12065"},{"crn":"12066"},{"crn":"12067"},{"crn":"14506"},{"crn":"14523"},{"crn":"14553"},{"crn":"16015"}]},{"group":"code:HIST 1992","srcdb":"202610","sections":[{"crn":"15076"}]}];
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
