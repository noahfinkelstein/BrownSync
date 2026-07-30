(() => {
  const groups = [{"group":"code:CHEM 2970","srcdb":"202610","sections":[{"crn":"13289"}]},{"group":"code:CHEM 2980","srcdb":"202610","sections":[{"crn":"11002"},{"crn":"11003"},{"crn":"11004"},{"crn":"11005"},{"crn":"11006"},{"crn":"11007"},{"crn":"11008"},{"crn":"11009"},{"crn":"11010"},{"crn":"11011"},{"crn":"11012"},{"crn":"11013"},{"crn":"11014"},{"crn":"11015"},{"crn":"11016"}]},{"group":"code:CHEM 2981","srcdb":"202610","sections":[{"crn":"11017"},{"crn":"11018"},{"crn":"14416"}]},{"group":"code:CHEM 2990","srcdb":"202610","sections":[{"crn":"13290"}]}];
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
