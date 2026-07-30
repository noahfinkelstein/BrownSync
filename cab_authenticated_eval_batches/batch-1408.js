(() => {
  const groups = [{"group":"code:RELS 1999","srcdb":"202610","sections":[{"crn":"13015"},{"crn":"13016"},{"crn":"13017"},{"crn":"13018"},{"crn":"13019"},{"crn":"13531"}]},{"group":"code:RELS 2000B","srcdb":"202610","sections":[{"crn":"13954"}]},{"group":"code:RELS 2890","srcdb":"202610","sections":[{"crn":"13374"}]},{"group":"code:RELS 2910","srcdb":"202610","sections":[{"crn":"13020"},{"crn":"13021"},{"crn":"13022"},{"crn":"13023"},{"crn":"13024"},{"crn":"13025"},{"crn":"13026"},{"crn":"13027"},{"crn":"13028"},{"crn":"13029"},{"crn":"13470"},{"crn":"14401"},{"crn":"14514"}]}];
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
