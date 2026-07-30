(() => {
  const groups = [{"group":"code:HIAA 2940","srcdb":"202610","sections":[{"crn":"12001"},{"crn":"12002"},{"crn":"12003"},{"crn":"12004"},{"crn":"12005"},{"crn":"12006"}]},{"group":"code:HIAA 2980","srcdb":"202610","sections":[{"crn":"12007"},{"crn":"12008"},{"crn":"12009"},{"crn":"12010"},{"crn":"12011"},{"crn":"12012"},{"crn":"12013"},{"crn":"12014"},{"crn":"12015"}]},{"group":"code:HIAA 2981","srcdb":"202610","sections":[{"crn":"12016"},{"crn":"12017"},{"crn":"12018"},{"crn":"12019"},{"crn":"12020"},{"crn":"12021"}]},{"group":"code:HIAA 2982","srcdb":"202610","sections":[{"crn":"12022"},{"crn":"12023"},{"crn":"12024"},{"crn":"12025"},{"crn":"12026"},{"crn":"12027"},{"crn":"12028"},{"crn":"12029"},{"crn":"12030"}]}];
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
