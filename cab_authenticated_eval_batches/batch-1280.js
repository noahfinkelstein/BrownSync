(() => {
  const groups = [{"group":"code:PHP 2988","srcdb":"202610","sections":[{"crn":"12738"},{"crn":"12739"},{"crn":"12740"},{"crn":"12741"},{"crn":"12742"},{"crn":"12743"},{"crn":"12744"},{"crn":"12745"},{"crn":"12746"},{"crn":"12747"},{"crn":"12748"},{"crn":"12749"},{"crn":"12750"},{"crn":"12751"},{"crn":"12752"},{"crn":"12753"},{"crn":"12754"},{"crn":"12755"},{"crn":"12756"},{"crn":"12757"},{"crn":"12758"},{"crn":"12759"},{"crn":"12760"},{"crn":"12761"},{"crn":"12762"}]},{"group":"code:PHP 2990","srcdb":"202610","sections":[{"crn":"13361"}]},{"group":"code:PHUM 2010","srcdb":"202610","sections":[{"crn":"15285"}]},{"group":"code:PHUM 2011","srcdb":"202610","sections":[{"crn":"16288"}]}];
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
