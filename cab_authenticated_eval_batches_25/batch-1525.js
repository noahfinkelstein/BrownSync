(() => {
  const groups = [{"group":"code:TAPS 2980","srcdb":"202610","sections":[{"crn":"13217"},{"crn":"13218"},{"crn":"13219"},{"crn":"13220"},{"crn":"13221"},{"crn":"13222"},{"crn":"13223"},{"crn":"13224"},{"crn":"13225"},{"crn":"13226"},{"crn":"13227"}]},{"group":"code:TAPS 2981","srcdb":"202610","sections":[{"crn":"13228"}]},{"group":"code:TAPS 2982","srcdb":"202610","sections":[{"crn":"13229"},{"crn":"13230"},{"crn":"13231"},{"crn":"13232"},{"crn":"13233"},{"crn":"13234"},{"crn":"13235"}]},{"group":"code:TAPS 2990","srcdb":"202610","sections":[{"crn":"13387"}]},{"group":"code:UNIV 0456","srcdb":"202610","sections":[{"crn":"15203"},{"crn":"15204"},{"crn":"15205"},{"crn":"15206"},{"crn":"15207"}]},{"group":"code:UNIV 1110","srcdb":"202610","sections":[{"crn":"15731"}]},{"group":"code:UNIV 1111","srcdb":"202610","sections":[{"crn":"13955"}]},{"group":"code:UNIV 1221","srcdb":"202610","sections":[{"crn":"15526"}]},{"group":"code:UNIV 1801","srcdb":"202610","sections":[{"crn":"15871"}]},{"group":"code:URBN 0210","srcdb":"202610","sections":[{"crn":"13464"},{"crn":"15130"}]},{"group":"code:URBN 1251","srcdb":"202610","sections":[{"crn":"13976"}]},{"group":"code:URBN 1870D","srcdb":"202610","sections":[{"crn":"13977"}]},{"group":"code:URBN 1871A","srcdb":"202610","sections":[{"crn":"13466"}]},{"group":"code:URBN 1970","srcdb":"202610","sections":[{"crn":"13236"},{"crn":"13237"},{"crn":"13238"},{"crn":"13239"}]},{"group":"code:URBN 1971","srcdb":"202610","sections":[{"crn":"13240"},{"crn":"13241"},{"crn":"13242"},{"crn":"13243"},{"crn":"13244"},{"crn":"13245"},{"crn":"13246"},{"crn":"13247"},{"crn":"13248"},{"crn":"13249"},{"crn":"13250"}]},{"group":"code:URBN XLIST","srcdb":"202610","sections":[{"crn":"15932"}]},{"group":"code:VIET 0100","srcdb":"202610","sections":[{"crn":"10142"}]},{"group":"code:VIET 0300","srcdb":"202610","sections":[{"crn":"10143"}]},{"group":"code:VISA 0100","srcdb":"202610","sections":[{"crn":"15539"},{"crn":"15542"},{"crn":"15545"},{"crn":"15546"},{"crn":"15547"}]},{"group":"code:VISA 0120","srcdb":"202610","sections":[{"crn":"15548"}]},{"group":"code:VISA 0130","srcdb":"202610","sections":[{"crn":"15450"}]},{"group":"code:VISA 0140","srcdb":"202610","sections":[{"crn":"15451"}]},{"group":"code:VISA 0150","srcdb":"202610","sections":[{"crn":"15452"},{"crn":"15455"}]},{"group":"code:VISA 0160","srcdb":"202610","sections":[{"crn":"15531"},{"crn":"15532"}]},{"group":"code:VISA 0170","srcdb":"202610","sections":[{"crn":"15449"}]}];
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
