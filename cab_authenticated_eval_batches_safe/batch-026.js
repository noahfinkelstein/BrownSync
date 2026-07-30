(() => {
  const groups = [{"group":"code:CPSY 1500","srcdb":"202610","sections":[{"crn":"14576"}]},{"group":"code:CPSY 1670","srcdb":"202610","sections":[{"crn":"14578"}]},{"group":"code:CPSY 1680F","srcdb":"202610","sections":[{"crn":"14586"}]},{"group":"code:CPSY 1680I","srcdb":"202610","sections":[{"crn":"14564"}]},{"group":"code:CPSY 1730","srcdb":"202610","sections":[{"crn":"14569"}]},{"group":"code:CPSY 1900","srcdb":"202610","sections":[{"crn":"14577"}]},{"group":"code:CPSY 1960","srcdb":"202610","sections":[{"crn":"14581"}]},{"group":"code:CPSY 1970","srcdb":"202610","sections":[{"crn":"11115"},{"crn":"11116"},{"crn":"11117"},{"crn":"11118"},{"crn":"11119"},{"crn":"11120"},{"crn":"11121"},{"crn":"11122"},{"crn":"11123"},{"crn":"11124"},{"crn":"11125"},{"crn":"11126"},{"crn":"11127"},{"crn":"11128"},{"crn":"11129"},{"crn":"11130"},{"crn":"11131"},{"crn":"11132"},{"crn":"11133"},{"crn":"11134"},{"crn":"11135"},{"crn":"11136"},{"crn":"11137"},{"crn":"11138"},{"crn":"11139"},{"crn":"11140"},{"crn":"11141"}]},{"group":"code:CPSY 1980","srcdb":"202610","sections":[{"crn":"11142"},{"crn":"11143"},{"crn":"11144"},{"crn":"11145"},{"crn":"11146"},{"crn":"11147"},{"crn":"11148"},{"crn":"11149"},{"crn":"11150"},{"crn":"11151"},{"crn":"11152"},{"crn":"11153"},{"crn":"11154"},{"crn":"11155"},{"crn":"11156"},{"crn":"11158"},{"crn":"11159"},{"crn":"11160"},{"crn":"11161"},{"crn":"11162"},{"crn":"11164"},{"crn":"11165"},{"crn":"11166"},{"crn":"11168"},{"crn":"11169"},{"crn":"11170"},{"crn":"11174"},{"crn":"11175"},{"crn":"11176"},{"crn":"11179"},{"crn":"11184"},{"crn":"11185"},{"crn":"11187"},{"crn":"11190"},{"crn":"11191"},{"crn":"11192"},{"crn":"11193"},{"crn":"11194"},{"crn":"11195"},{"crn":"11196"},{"crn":"11197"},{"crn":"11198"},{"crn":"14886"}]}];
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
