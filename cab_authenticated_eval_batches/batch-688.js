(() => {
  const groups = [{"group":"code:ENVS 1911","srcdb":"202610","sections":[{"crn":"16353"}]},{"group":"code:ENVS 1915","srcdb":"202610","sections":[{"crn":"15246"}]},{"group":"code:ENVS 1925","srcdb":"202610","sections":[{"crn":"14992"}]},{"group":"code:ENVS 1970","srcdb":"202610","sections":[{"crn":"11833"},{"crn":"11834"},{"crn":"11835"},{"crn":"11836"},{"crn":"11837"},{"crn":"11838"},{"crn":"11839"},{"crn":"11840"},{"crn":"11841"},{"crn":"11842"},{"crn":"11843"},{"crn":"11844"},{"crn":"11845"},{"crn":"11846"},{"crn":"11847"},{"crn":"11848"},{"crn":"11849"},{"crn":"11850"},{"crn":"11851"},{"crn":"11852"},{"crn":"11853"},{"crn":"11854"},{"crn":"11855"},{"crn":"11856"},{"crn":"11857"},{"crn":"11858"},{"crn":"11859"},{"crn":"11860"},{"crn":"11861"},{"crn":"11862"},{"crn":"11863"},{"crn":"11864"},{"crn":"11865"},{"crn":"11866"},{"crn":"11867"},{"crn":"11868"},{"crn":"11869"},{"crn":"11870"},{"crn":"11871"},{"crn":"11872"},{"crn":"11873"},{"crn":"11874"},{"crn":"11875"},{"crn":"11876"},{"crn":"14521"},{"crn":"16256"},{"crn":"16356"}]}];
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
