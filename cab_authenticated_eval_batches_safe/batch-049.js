(() => {
  const groups = [{"group":"code:ENGN 2031","srcdb":"202610","sections":[{"crn":"15280"}]},{"group":"code:ENGN 2135","srcdb":"202610","sections":[{"crn":"15991"}]},{"group":"code:ENGN 2150","srcdb":"202610","sections":[{"crn":"15176"},{"crn":"15181"},{"crn":"15182"},{"crn":"15183"}]},{"group":"code:ENGN 2160","srcdb":"202610","sections":[{"crn":"15177"},{"crn":"15265"},{"crn":"15266"},{"crn":"15267"}]},{"group":"code:ENGN 2171","srcdb":"202610","sections":[{"crn":"15210"}]},{"group":"code:ENGN 2210","srcdb":"202610","sections":[{"crn":"14098"}]},{"group":"code:ENGN 2222","srcdb":"202610","sections":[{"crn":"15026"}]},{"group":"code:ENGN 2350","srcdb":"202610","sections":[{"crn":"14099"}]},{"group":"code:ENGN 2410","srcdb":"202610","sections":[{"crn":"14001"}]},{"group":"code:ENGN 2502","srcdb":"202610","sections":[{"crn":"14012"}]},{"group":"code:ENGN 2605","srcdb":"202610","sections":[{"crn":"16099"}]},{"group":"code:ENGN 2625","srcdb":"202610","sections":[{"crn":"10022"},{"crn":"15171"}]},{"group":"code:ENGN 2702","srcdb":"202610","sections":[{"crn":"14667"}]},{"group":"code:ENGN 2703","srcdb":"202610","sections":[{"crn":"15279"}]},{"group":"code:ENGN 2721","srcdb":"202610","sections":[{"crn":"13998"}]},{"group":"code:ENGN 2742","srcdb":"202610","sections":[{"crn":"15025"}]},{"group":"code:ENGN 2800","srcdb":"202610","sections":[{"crn":"14669"}]},{"group":"code:ENGN 2801","srcdb":"202610","sections":[{"crn":"14668"}]},{"group":"code:ENGN 2810","srcdb":"202610","sections":[{"crn":"14560"}]},{"group":"code:ENGN 2911X","srcdb":"202610","sections":[{"crn":"15172"}]},{"group":"code:ENGN 2912B","srcdb":"202610","sections":[{"crn":"10024"},{"crn":"15173"}]},{"group":"code:ENGN 2912E","srcdb":"202610","sections":[{"crn":"15170"}]},{"group":"code:ENGN 2912H","srcdb":"202610","sections":[{"crn":"14554"}]},{"group":"code:ENGN 2912T","srcdb":"202610","sections":[{"crn":"16348"}]},{"group":"code:ENGN 2960","srcdb":"202610","sections":[{"crn":"14424"}]}];
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
