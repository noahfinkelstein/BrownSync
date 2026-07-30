(() => {
  const groups = [{"group":"code:PHYS 2710","srcdb":"202610","sections":[{"crn":"12822"},{"crn":"12823"},{"crn":"12824"},{"crn":"12825"},{"crn":"12826"},{"crn":"12827"},{"crn":"12828"},{"crn":"12829"},{"crn":"12830"},{"crn":"12831"},{"crn":"12832"},{"crn":"12833"},{"crn":"12834"},{"crn":"12835"},{"crn":"12836"},{"crn":"12837"},{"crn":"12838"},{"crn":"12839"},{"crn":"12840"},{"crn":"12841"},{"crn":"12842"},{"crn":"12843"},{"crn":"12844"},{"crn":"12845"},{"crn":"12846"},{"crn":"12847"},{"crn":"12848"},{"crn":"12849"},{"crn":"12850"},{"crn":"12851"},{"crn":"12852"},{"crn":"12853"},{"crn":"12854"},{"crn":"12855"},{"crn":"12856"},{"crn":"12857"},{"crn":"12858"},{"crn":"12859"},{"crn":"12860"},{"crn":"12861"},{"crn":"12862"},{"crn":"12863"},{"crn":"12864"},{"crn":"12865"}]},{"group":"code:PHYS 2711","srcdb":"202610","sections":[{"crn":"14400"}]},{"group":"code:PHYS 2970","srcdb":"202610","sections":[{"crn":"13364"},{"crn":"13365"}]}];
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
