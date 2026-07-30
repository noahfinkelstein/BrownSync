(() => {
  const groups = [{"group":"code:ECON 1620","srcdb":"202610","sections":[{"crn":"14792"},{"crn":"14793"},{"crn":"15259"},{"crn":"15260"},{"crn":"15261"},{"crn":"15262"},{"crn":"15263"},{"crn":"15264"}]},{"group":"code:ECON 1629","srcdb":"202610","sections":[{"crn":"14794"},{"crn":"14795"},{"crn":"14796"},{"crn":"15105"},{"crn":"15106"},{"crn":"15107"},{"crn":"15108"},{"crn":"15109"},{"crn":"15110"},{"crn":"15111"},{"crn":"15112"},{"crn":"15113"},{"crn":"15114"},{"crn":"15115"},{"crn":"15116"}]},{"group":"code:ECON 1630","srcdb":"202610","sections":[{"crn":"14797"},{"crn":"14798"}]},{"group":"code:ECON 1690","srcdb":"202610","sections":[{"crn":"15691"}]}];
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
