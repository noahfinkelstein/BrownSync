(() => {
  const groups = [{"group":"code:CATL 1910","srcdb":"202610","sections":[{"crn":"10975"}]},{"group":"code:CHEM 0100","srcdb":"202610","sections":[{"crn":"13521"},{"crn":"15055"},{"crn":"15056"},{"crn":"15057"}]},{"group":"code:CHEM 0330","srcdb":"202610","sections":[{"crn":"13527"},{"crn":"13528"},{"crn":"15061"},{"crn":"15062"},{"crn":"15063"},{"crn":"15064"},{"crn":"15090"},{"crn":"15091"},{"crn":"15092"}]},{"group":"code:CHEM 0330L","srcdb":"202610","sections":[{"crn":"15514"},{"crn":"15515"},{"crn":"15516"},{"crn":"15517"},{"crn":"15518"},{"crn":"15519"},{"crn":"15520"},{"crn":"15521"},{"crn":"15522"},{"crn":"15524"},{"crn":"15611"}]}];
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
