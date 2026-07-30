(() => {
  const groups = [{"group":"code:IAPA 1818A","srcdb":"202610","sections":[{"crn":"12097"},{"crn":"12098"},{"crn":"12099"},{"crn":"12100"},{"crn":"12101"},{"crn":"12102"},{"crn":"12103"},{"crn":"12104"},{"crn":"12105"},{"crn":"12106"},{"crn":"12107"},{"crn":"12108"},{"crn":"12109"},{"crn":"12110"},{"crn":"12111"},{"crn":"12112"},{"crn":"12113"},{"crn":"12114"},{"crn":"14511"},{"crn":"14527"},{"crn":"14694"}]},{"group":"code:IAPA 1820H","srcdb":"202610","sections":[{"crn":"15779"}]},{"group":"code:IAPA 1820X","srcdb":"202610","sections":[{"crn":"15778"}]},{"group":"code:ITAL 0100","srcdb":"202610","sections":[{"crn":"14107"},{"crn":"14108"}]}];
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
