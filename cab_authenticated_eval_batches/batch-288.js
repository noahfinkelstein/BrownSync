(() => {
  const groups = [{"group":"code:COST 0711","srcdb":"202610","sections":[{"crn":"16373"}]},{"group":"code:COST 0924","srcdb":"202610","sections":[{"crn":"15806"},{"crn":"15849"}]},{"group":"code:COST 1030","srcdb":"202610","sections":[{"crn":"15808"}]},{"group":"code:COST 1910","srcdb":"202610","sections":[{"crn":"11097"},{"crn":"11098"},{"crn":"11099"},{"crn":"11100"},{"crn":"11101"},{"crn":"11102"},{"crn":"11103"},{"crn":"11104"},{"crn":"11105"},{"crn":"11106"},{"crn":"11107"},{"crn":"11108"},{"crn":"11109"},{"crn":"11110"},{"crn":"11111"},{"crn":"11112"},{"crn":"11113"},{"crn":"11114"}]}];
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
