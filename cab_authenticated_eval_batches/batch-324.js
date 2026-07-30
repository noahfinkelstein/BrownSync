(() => {
  const groups = [{"group":"code:CSCI 0111","srcdb":"202610","sections":[{"crn":"13666"},{"crn":"15883"},{"crn":"15884"},{"crn":"15885"},{"crn":"15886"},{"crn":"15887"},{"crn":"15888"}]},{"group":"code:CSCI 0111E","srcdb":"202610","sections":[{"crn":"16127"},{"crn":"16128"},{"crn":"16129"}]},{"group":"code:CSCI 0150","srcdb":"202610","sections":[{"crn":"13667"},{"crn":"15911"},{"crn":"15912"},{"crn":"15913"},{"crn":"15914"},{"crn":"15915"},{"crn":"15916"},{"crn":"15917"},{"crn":"15918"},{"crn":"15919"},{"crn":"15920"},{"crn":"15921"},{"crn":"15922"},{"crn":"15923"},{"crn":"15924"}]},{"group":"code:CSCI 0170","srcdb":"202610","sections":[{"crn":"10144"},{"crn":"14895"},{"crn":"15985"},{"crn":"15986"},{"crn":"15987"},{"crn":"15988"}]}];
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
