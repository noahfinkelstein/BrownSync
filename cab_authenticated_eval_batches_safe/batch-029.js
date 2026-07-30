(() => {
  const groups = [{"group":"code:CSCI 1420","srcdb":"202610","sections":[{"crn":"14254"}]},{"group":"code:CSCI 1430","srcdb":"202610","sections":[{"crn":"14255"}]},{"group":"code:CSCI 1510","srcdb":"202610","sections":[{"crn":"14256"}]},{"group":"code:CSCI 1550","srcdb":"202610","sections":[{"crn":"14258"}]},{"group":"code:CSCI 1570","srcdb":"202610","sections":[{"crn":"14259"}]},{"group":"code:CSCI 1600","srcdb":"202610","sections":[{"crn":"14260"},{"crn":"16057"},{"crn":"16058"}]},{"group":"code:CSCI 1640","srcdb":"202610","sections":[{"crn":"14261"}]},{"group":"code:CSCI 1670","srcdb":"202610","sections":[{"crn":"14263"}]},{"group":"code:CSCI 1675","srcdb":"202610","sections":[{"crn":"14265"}]},{"group":"code:CSCI 1690","srcdb":"202610","sections":[{"crn":"14266"}]},{"group":"code:CSCI 1715","srcdb":"202610","sections":[{"crn":"14267"}]},{"group":"code:CSCI 1730","srcdb":"202610","sections":[{"crn":"14268"},{"crn":"16025"}]},{"group":"code:CSCI 1810","srcdb":"202610","sections":[{"crn":"14269"}]},{"group":"code:CSCI 1870","srcdb":"202610","sections":[{"crn":"14270"},{"crn":"15941"}]},{"group":"code:CSCI 1950N","srcdb":"202610","sections":[{"crn":"14370"}]},{"group":"code:CSCI 1951R","srcdb":"202610","sections":[{"crn":"14271"}]},{"group":"code:CSCI 1952A","srcdb":"202610","sections":[{"crn":"15957"}]},{"group":"code:CSCI 1953A","srcdb":"202610","sections":[{"crn":"14273"}]},{"group":"code:CSCI 1953C","srcdb":"202610","sections":[{"crn":"16235"}]}];
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
