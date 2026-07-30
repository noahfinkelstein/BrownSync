(() => {
  const groups = [{"group":"code:ENGN 1610","srcdb":"202610","sections":[{"crn":"10015"},{"crn":"16098"}]},{"group":"code:ENGN 1630","srcdb":"202610","sections":[{"crn":"10016"}]},{"group":"code:ENGN 1650","srcdb":"202610","sections":[{"crn":"14013"}]},{"group":"code:ENGN 1690","srcdb":"202610","sections":[{"crn":"10017"}]},{"group":"code:ENGN 1721","srcdb":"202610","sections":[{"crn":"13997"}]},{"group":"code:ENGN 1742","srcdb":"202610","sections":[{"crn":"15024"}]},{"group":"code:ENGN 1745","srcdb":"202610","sections":[{"crn":"15277"}]},{"group":"code:ENGN 1750","srcdb":"202610","sections":[{"crn":"14096"}]},{"group":"code:ENGN 1860","srcdb":"202610","sections":[{"crn":"13675"}]},{"group":"code:ENGN 1931A","srcdb":"202610","sections":[{"crn":"15169"}]},{"group":"code:ENGN 1931D","srcdb":"202610","sections":[{"crn":"15180"}]},{"group":"code:ENGN 1931Q","srcdb":"202610","sections":[{"crn":"15007"}]},{"group":"code:ENGN 1931T","srcdb":"202610","sections":[{"crn":"15010"},{"crn":"15011"}]},{"group":"code:ENGN 1931W","srcdb":"202610","sections":[{"crn":"15004"}]},{"group":"code:ENGN 1931Y","srcdb":"202610","sections":[{"crn":"10020"},{"crn":"15160"}]},{"group":"code:ENGN 1932R","srcdb":"202610","sections":[{"crn":"15012"}]},{"group":"code:ENGN 1970","srcdb":"202610","sections":[{"crn":"11737"},{"crn":"11738"},{"crn":"11739"},{"crn":"11740"},{"crn":"11741"},{"crn":"11742"},{"crn":"11743"},{"crn":"11744"},{"crn":"11745"},{"crn":"11746"}]},{"group":"code:ENGN 1972","srcdb":"202610","sections":[{"crn":"11747"},{"crn":"11748"},{"crn":"11749"},{"crn":"11750"},{"crn":"11751"},{"crn":"11752"},{"crn":"11753"},{"crn":"11754"},{"crn":"11755"},{"crn":"11756"}]},{"group":"code:ENGN 2010","srcdb":"202610","sections":[{"crn":"10021"},{"crn":"15161"}]},{"group":"code:ENGN 2031","srcdb":"202610","sections":[{"crn":"15280"}]},{"group":"code:ENGN 2135","srcdb":"202610","sections":[{"crn":"15991"}]},{"group":"code:ENGN 2150","srcdb":"202610","sections":[{"crn":"15176"},{"crn":"15181"},{"crn":"15182"},{"crn":"15183"}]},{"group":"code:ENGN 2160","srcdb":"202610","sections":[{"crn":"15177"},{"crn":"15265"},{"crn":"15266"},{"crn":"15267"}]},{"group":"code:ENGN 2171","srcdb":"202610","sections":[{"crn":"15210"}]},{"group":"code:ENGN 2210","srcdb":"202610","sections":[{"crn":"14098"}]}];
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
