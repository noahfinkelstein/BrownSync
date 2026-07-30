(() => {
  const groups = [{"group":"code:EDUC 2520D","srcdb":"202610","sections":[{"crn":"13600"}]},{"group":"code:EDUC 2525","srcdb":"202610","sections":[{"crn":"13601"}]},{"group":"code:EDUC 2535","srcdb":"202610","sections":[{"crn":"13605"}]},{"group":"code:EDUC 2565","srcdb":"202610","sections":[{"crn":"13606"},{"crn":"13607"},{"crn":"13608"},{"crn":"13609"}]},{"group":"code:EDUC 2980","srcdb":"202610","sections":[{"crn":"11598"},{"crn":"11599"},{"crn":"11600"},{"crn":"11601"},{"crn":"11602"},{"crn":"11603"},{"crn":"11604"}]},{"group":"code:EDUC 2990","srcdb":"202610","sections":[{"crn":"13308"}]},{"group":"code:EEPS 0050","srcdb":"202610","sections":[{"crn":"14940"}]},{"group":"code:EEPS 0070","srcdb":"202610","sections":[{"crn":"14748"}]},{"group":"code:EEPS 0080","srcdb":"202610","sections":[{"crn":"15525"}]},{"group":"code:EEPS 0100","srcdb":"202610","sections":[{"crn":"15276"}]},{"group":"code:EEPS 0160I","srcdb":"202610","sections":[{"crn":"14941"}]},{"group":"code:EEPS 0160K","srcdb":"202610","sections":[{"crn":"15463"}]},{"group":"code:EEPS 0220","srcdb":"202610","sections":[{"crn":"14949"}]},{"group":"code:EEPS 0350","srcdb":"202610","sections":[{"crn":"14745"}]},{"group":"code:EEPS 0830","srcdb":"202610","sections":[{"crn":"14954"}]},{"group":"code:EEPS 1130","srcdb":"202610","sections":[{"crn":"15016"}]},{"group":"code:EEPS 1240","srcdb":"202610","sections":[{"crn":"15528"}]},{"group":"code:EEPS 1320","srcdb":"202610","sections":[{"crn":"15018"}]},{"group":"code:EEPS 1370","srcdb":"202610","sections":[{"crn":"15017"}]},{"group":"code:EEPS 1400","srcdb":"202610","sections":[{"crn":"14747"}]},{"group":"code:EEPS 1420","srcdb":"202610","sections":[{"crn":"14740"}]},{"group":"code:EEPS 1430","srcdb":"202610","sections":[{"crn":"15230"}]},{"group":"code:EEPS 1615","srcdb":"202610","sections":[{"crn":"14945"}]},{"group":"code:EEPS 1670","srcdb":"202610","sections":[{"crn":"14952"}]},{"group":"code:EEPS 1690","srcdb":"202610","sections":[{"crn":"14744"}]}];
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
