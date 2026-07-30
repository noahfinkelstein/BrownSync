(() => {
  const groups = [{"group":"code:CPSY 1730","srcdb":"202610","sections":[{"crn":"14569"}]},{"group":"code:CPSY 1900","srcdb":"202610","sections":[{"crn":"14577"}]},{"group":"code:CPSY 1960","srcdb":"202610","sections":[{"crn":"14581"}]},{"group":"code:CPSY 1970","srcdb":"202610","sections":[{"crn":"11115"},{"crn":"11116"},{"crn":"11117"},{"crn":"11118"},{"crn":"11119"},{"crn":"11120"},{"crn":"11121"},{"crn":"11122"},{"crn":"11123"},{"crn":"11124"},{"crn":"11125"},{"crn":"11126"},{"crn":"11127"},{"crn":"11128"},{"crn":"11129"},{"crn":"11130"},{"crn":"11131"},{"crn":"11132"},{"crn":"11133"},{"crn":"11134"},{"crn":"11135"},{"crn":"11136"},{"crn":"11137"},{"crn":"11138"},{"crn":"11139"},{"crn":"11140"},{"crn":"11141"}]}];
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
