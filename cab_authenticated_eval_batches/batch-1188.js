(() => {
  const groups = [{"group":"code:MUSC 1740","srcdb":"202610","sections":[{"crn":"16085"}]},{"group":"code:MUSC 1810","srcdb":"202610","sections":[{"crn":"12356"},{"crn":"12357"},{"crn":"12358"},{"crn":"12359"},{"crn":"12360"}]},{"group":"code:MUSC 1960","srcdb":"202610","sections":[{"crn":"15617"},{"crn":"15618"}]},{"group":"code:MUSC 1970","srcdb":"202610","sections":[{"crn":"12361"},{"crn":"12362"},{"crn":"12363"},{"crn":"12364"},{"crn":"12365"},{"crn":"12366"},{"crn":"12367"},{"crn":"12368"},{"crn":"12369"},{"crn":"12370"},{"crn":"12371"},{"crn":"12372"},{"crn":"12373"}]}];
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
