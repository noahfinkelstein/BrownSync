(() => {
  const groups = [{"group":"code:HIAA 0010","srcdb":"202610","sections":[{"crn":"14697"},{"crn":"14698"},{"crn":"14699"},{"crn":"14700"},{"crn":"14701"},{"crn":"14702"},{"crn":"14703"},{"crn":"14704"},{"crn":"14705"},{"crn":"16086"}]},{"group":"code:HIAA 0023","srcdb":"202610","sections":[{"crn":"14710"},{"crn":"14711"},{"crn":"15739"},{"crn":"15740"},{"crn":"15741"}]},{"group":"code:HIAA 0032","srcdb":"202610","sections":[{"crn":"14706"},{"crn":"14707"},{"crn":"14708"},{"crn":"14709"},{"crn":"15220"}]},{"group":"code:HIAA 0052","srcdb":"202610","sections":[{"crn":"15697"},{"crn":"15698"},{"crn":"15699"},{"crn":"15700"},{"crn":"16087"}]}];
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
