(() => {
  const groups = [{"group":"code:POLS 2826H","srcdb":"202610","sections":[{"crn":"15140"}]},{"group":"code:POLS 2975","srcdb":"202610","sections":[{"crn":"12983"}]},{"group":"code:POLS 2980","srcdb":"202610","sections":[{"crn":"12984"},{"crn":"12985"},{"crn":"12986"},{"crn":"12987"},{"crn":"12988"},{"crn":"12989"},{"crn":"12990"},{"crn":"12991"},{"crn":"12992"},{"crn":"12993"},{"crn":"12994"},{"crn":"12995"},{"crn":"12996"},{"crn":"12997"},{"crn":"12998"},{"crn":"12999"},{"crn":"13000"},{"crn":"13001"},{"crn":"13002"},{"crn":"13003"},{"crn":"13004"},{"crn":"13005"},{"crn":"13006"},{"crn":"13007"},{"crn":"13008"},{"crn":"13009"},{"crn":"13010"}]},{"group":"code:POLS 2990","srcdb":"202610","sections":[{"crn":"13371"}]}];
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
