(() => {
  const groups = [{"group":"code:POBS 1970","srcdb":"202610","sections":[{"crn":"12923"},{"crn":"12924"},{"crn":"12925"},{"crn":"12926"},{"crn":"12927"},{"crn":"12928"},{"crn":"12929"},{"crn":"12930"}]},{"group":"code:POBS 1990","srcdb":"202610","sections":[{"crn":"12931"},{"crn":"12932"},{"crn":"12933"},{"crn":"12934"},{"crn":"12935"},{"crn":"12936"},{"crn":"12937"},{"crn":"12938"},{"crn":"12939"}]},{"group":"code:POBS 2600K","srcdb":"202610","sections":[{"crn":"15685"}]},{"group":"code:POBS 2970","srcdb":"202610","sections":[{"crn":"13368"}]}];
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
