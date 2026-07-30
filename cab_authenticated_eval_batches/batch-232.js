(() => {
  const groups = [{"group":"code:CHEM 0980","srcdb":"202610","sections":[{"crn":"10976"},{"crn":"10977"},{"crn":"10978"},{"crn":"10979"},{"crn":"10980"},{"crn":"10981"},{"crn":"10982"},{"crn":"10983"},{"crn":"10984"},{"crn":"10985"},{"crn":"10986"},{"crn":"10987"},{"crn":"10988"},{"crn":"10989"},{"crn":"10990"},{"crn":"10991"},{"crn":"10992"},{"crn":"10993"},{"crn":"10994"},{"crn":"10995"},{"crn":"10996"},{"crn":"10997"}]},{"group":"code:CHEM 0980S","srcdb":"202610","sections":[{"crn":"10998"},{"crn":"10999"},{"crn":"11000"}]},{"group":"code:CHEM 0981","srcdb":"202610","sections":[{"crn":"11001"}]},{"group":"code:CHEM 1060","srcdb":"202610","sections":[{"crn":"13530"}]}];
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
