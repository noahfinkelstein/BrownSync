(() => {
  const groups = [{"group":"code:ANTH 1940","srcdb":"202610","sections":[{"crn":"13688"}]},{"group":"code:ANTH 1970","srcdb":"202610","sections":[{"crn":"10242"},{"crn":"10243"},{"crn":"10244"},{"crn":"10245"},{"crn":"10246"},{"crn":"10247"},{"crn":"10248"},{"crn":"10249"},{"crn":"10250"},{"crn":"10251"},{"crn":"10252"},{"crn":"10253"},{"crn":"10254"},{"crn":"10255"},{"crn":"10256"},{"crn":"10257"},{"crn":"10258"},{"crn":"16153"}]},{"group":"code:ANTH 2001","srcdb":"202610","sections":[{"crn":"16339"}]},{"group":"code:ANTH 2045","srcdb":"202610","sections":[{"crn":"13728"}]}];
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
