(() => {
  const groups = [{"group":"code:TAPS 1644M","srcdb":"202610","sections":[{"crn":"16185"}]},{"group":"code:TAPS 1670","srcdb":"202610","sections":[{"crn":"14219"}]},{"group":"code:TAPS 1970","srcdb":"202610","sections":[{"crn":"13190"},{"crn":"13191"},{"crn":"13192"},{"crn":"13193"},{"crn":"13194"},{"crn":"13195"},{"crn":"13196"},{"crn":"13197"},{"crn":"13198"},{"crn":"13199"},{"crn":"13200"},{"crn":"13201"},{"crn":"13202"},{"crn":"13203"},{"crn":"13204"}]},{"group":"code:TAPS 1970P","srcdb":"202610","sections":[{"crn":"13205"},{"crn":"13206"},{"crn":"13207"},{"crn":"13208"},{"crn":"14512"}]}];
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
