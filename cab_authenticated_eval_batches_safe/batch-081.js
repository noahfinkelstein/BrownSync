(() => {
  const groups = [{"group":"code:PHP 1980","srcdb":"202610","sections":[{"crn":"12550"},{"crn":"12551"},{"crn":"12552"},{"crn":"12553"},{"crn":"12554"},{"crn":"12555"},{"crn":"12556"},{"crn":"12557"},{"crn":"12558"},{"crn":"12559"},{"crn":"12560"},{"crn":"12561"},{"crn":"12562"},{"crn":"12563"},{"crn":"12564"},{"crn":"12565"},{"crn":"12566"},{"crn":"12567"},{"crn":"12568"},{"crn":"12569"},{"crn":"12570"},{"crn":"12571"},{"crn":"12572"},{"crn":"12573"},{"crn":"12574"},{"crn":"12575"},{"crn":"12576"},{"crn":"12577"},{"crn":"12578"},{"crn":"12579"},{"crn":"12580"},{"crn":"12581"},{"crn":"12582"},{"crn":"12583"},{"crn":"12584"},{"crn":"12585"},{"crn":"12586"},{"crn":"12587"},{"crn":"12588"},{"crn":"12589"},{"crn":"12590"},{"crn":"12591"},{"crn":"12592"},{"crn":"12593"},{"crn":"12594"},{"crn":"12595"},{"crn":"12596"},{"crn":"12597"},{"crn":"12598"},{"crn":"14385"}]}];
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
