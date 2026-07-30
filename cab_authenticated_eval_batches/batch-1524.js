(() => {
  const groups = [{"group":"code:TAPS 2975","srcdb":"202610","sections":[{"crn":"13213"},{"crn":"13214"},{"crn":"13215"},{"crn":"13216"}]},{"group":"code:TAPS 2980","srcdb":"202610","sections":[{"crn":"13217"},{"crn":"13218"},{"crn":"13219"},{"crn":"13220"},{"crn":"13221"},{"crn":"13222"},{"crn":"13223"},{"crn":"13224"},{"crn":"13225"},{"crn":"13226"},{"crn":"13227"}]},{"group":"code:TAPS 2981","srcdb":"202610","sections":[{"crn":"13228"}]},{"group":"code:TAPS 2982","srcdb":"202610","sections":[{"crn":"13229"},{"crn":"13230"},{"crn":"13231"},{"crn":"13232"},{"crn":"13233"},{"crn":"13234"},{"crn":"13235"}]}];
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
