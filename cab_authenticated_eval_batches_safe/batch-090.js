(() => {
  const groups = [{"group":"code:PHYS 2980","srcdb":"202610","sections":[{"crn":"12866"},{"crn":"12867"},{"crn":"12868"},{"crn":"12869"},{"crn":"12870"},{"crn":"12871"},{"crn":"12872"},{"crn":"12873"},{"crn":"12874"},{"crn":"12875"},{"crn":"12876"},{"crn":"12877"},{"crn":"12878"},{"crn":"12879"},{"crn":"12880"},{"crn":"12881"},{"crn":"12882"},{"crn":"12883"},{"crn":"12884"},{"crn":"12885"},{"crn":"12886"},{"crn":"12887"},{"crn":"12888"},{"crn":"12889"},{"crn":"12890"},{"crn":"12891"},{"crn":"12892"},{"crn":"12893"},{"crn":"12894"},{"crn":"12895"},{"crn":"12896"},{"crn":"12897"},{"crn":"12898"},{"crn":"12899"},{"crn":"12900"},{"crn":"12901"},{"crn":"12902"},{"crn":"12903"},{"crn":"12904"},{"crn":"12905"},{"crn":"12906"},{"crn":"12907"},{"crn":"12908"},{"crn":"12909"},{"crn":"12910"},{"crn":"12911"},{"crn":"12912"},{"crn":"12913"},{"crn":"12914"},{"crn":"12915"}]}];
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
