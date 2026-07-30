(() => {
  const groups = [{"group":"code:CSCI 0190","srcdb":"202610","sections":[{"crn":"13668"},{"crn":"15950"},{"crn":"15951"},{"crn":"15952"}]},{"group":"code:CSCI 0200","srcdb":"202610","sections":[{"crn":"13669"},{"crn":"15872"},{"crn":"15873"},{"crn":"15874"},{"crn":"15875"},{"crn":"16022"}]},{"group":"code:CSCI 0220","srcdb":"202610","sections":[{"crn":"13670"},{"crn":"15889"},{"crn":"15890"},{"crn":"15891"},{"crn":"15892"}]},{"group":"code:CSCI 0300","srcdb":"202610","sections":[{"crn":"13671"},{"crn":"15795"},{"crn":"15838"},{"crn":"15839"},{"crn":"15840"},{"crn":"15841"},{"crn":"15842"},{"crn":"15843"},{"crn":"15844"}]}];
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
