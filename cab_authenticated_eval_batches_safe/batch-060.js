(() => {
  const groups = [{"group":"code:HIST 0940D","srcdb":"202610","sections":[{"crn":"15817"}]},{"group":"code:HIST 0940P","srcdb":"202610","sections":[{"crn":"15870"}]},{"group":"code:HIST 1070","srcdb":"202610","sections":[{"crn":"14991"}]},{"group":"code:HIST 1121","srcdb":"202610","sections":[{"crn":"13834"}]},{"group":"code:HIST 1141","srcdb":"202610","sections":[{"crn":"13843"}]},{"group":"code:HIST 1202","srcdb":"202610","sections":[{"crn":"13839"}]},{"group":"code:HIST 1205","srcdb":"202610","sections":[{"crn":"13820"}]},{"group":"code:HIST 1242","srcdb":"202610","sections":[{"crn":"14955"}]},{"group":"code:HIST 1262M","srcdb":"202610","sections":[{"crn":"13819"}]},{"group":"code:HIST 1266C","srcdb":"202610","sections":[{"crn":"15023"}]},{"group":"code:HIST 1382","srcdb":"202610","sections":[{"crn":"15635"}]},{"group":"code:HIST 1457A","srcdb":"202610","sections":[{"crn":"15282"}]},{"group":"code:HIST 1507","srcdb":"202610","sections":[{"crn":"13841"}]},{"group":"code:HIST 1800","srcdb":"202610","sections":[{"crn":"13824"}]},{"group":"code:HIST 1830B","srcdb":"202610","sections":[{"crn":"14840"}]},{"group":"code:HIST 1840","srcdb":"202610","sections":[{"crn":"15250"}]},{"group":"code:HIST 1845","srcdb":"202610","sections":[{"crn":"15248"}]},{"group":"code:HIST 1940A","srcdb":"202610","sections":[{"crn":"14186"}]},{"group":"code:HIST 1950A","srcdb":"202610","sections":[{"crn":"15249"}]},{"group":"code:HIST 1954F","srcdb":"202610","sections":[{"crn":"14934"}]},{"group":"code:HIST 1954S","srcdb":"202610","sections":[{"crn":"14900"}]},{"group":"code:HIST 1956F","srcdb":"202610","sections":[{"crn":"14928"}]},{"group":"code:HIST 1961O","srcdb":"202610","sections":[{"crn":"15187"}]},{"group":"code:HIST 1962G","srcdb":"202610","sections":[{"crn":"14933"}]},{"group":"code:HIST 1964A","srcdb":"202610","sections":[{"crn":"13875"}]}];
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
