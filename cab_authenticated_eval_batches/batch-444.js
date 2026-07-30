(() => {
  const groups = [{"group":"code:ECON 1870","srcdb":"202610","sections":[{"crn":"14805"}]},{"group":"code:ECON 1960","srcdb":"202610","sections":[{"crn":"14806"}]},{"group":"code:ECON 1970","srcdb":"202610","sections":[{"crn":"11541"},{"crn":"11542"},{"crn":"11543"},{"crn":"11544"},{"crn":"11545"},{"crn":"11546"},{"crn":"11547"},{"crn":"11548"},{"crn":"11549"},{"crn":"11550"},{"crn":"11551"},{"crn":"11552"},{"crn":"11553"},{"crn":"11554"},{"crn":"11555"},{"crn":"11556"},{"crn":"11557"},{"crn":"11558"}]},{"group":"code:ECON 2010","srcdb":"202610","sections":[{"crn":"14113"}]}];
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
