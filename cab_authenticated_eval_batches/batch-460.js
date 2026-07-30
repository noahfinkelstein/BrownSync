(() => {
  const groups = [{"group":"code:ECON 2960","srcdb":"202610","sections":[{"crn":"14126"}]},{"group":"code:ECON 2970","srcdb":"202610","sections":[{"crn":"14127"}]},{"group":"code:ECON 2980","srcdb":"202610","sections":[{"crn":"11559"},{"crn":"11560"},{"crn":"11561"},{"crn":"11562"},{"crn":"11563"},{"crn":"11564"},{"crn":"11565"},{"crn":"11566"},{"crn":"11567"},{"crn":"11568"},{"crn":"11569"},{"crn":"11570"},{"crn":"11571"},{"crn":"11572"},{"crn":"11573"},{"crn":"11574"},{"crn":"11575"}]},{"group":"code:ECON 2990","srcdb":"202610","sections":[{"crn":"13307"}]}];
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
