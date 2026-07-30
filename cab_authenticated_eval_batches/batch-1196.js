(() => {
  const groups = [{"group":"code:MUSC 2200","srcdb":"202610","sections":[{"crn":"15586"}]},{"group":"code:MUSC 2970","srcdb":"202610","sections":[{"crn":"13351"}]},{"group":"code:MUSC 2980","srcdb":"202610","sections":[{"crn":"12374"},{"crn":"12375"},{"crn":"12376"},{"crn":"12377"},{"crn":"12378"},{"crn":"12379"},{"crn":"12380"},{"crn":"12381"},{"crn":"12382"},{"crn":"12383"},{"crn":"12384"},{"crn":"12385"},{"crn":"12386"},{"crn":"12387"},{"crn":"12388"},{"crn":"12389"},{"crn":"12390"}]},{"group":"code:MUSC 2990","srcdb":"202610","sections":[{"crn":"13352"}]}];
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
