(() => {
  const groups = [{"group":"code:TAPS 0260","srcdb":"202610","sections":[{"crn":"14238"}]},{"group":"code:TAPS 0350","srcdb":"202610","sections":[{"crn":"14181"}]},{"group":"code:TAPS 0800L","srcdb":"202610","sections":[{"crn":"16222"}]},{"group":"code:TAPS 1100","srcdb":"202610","sections":[{"crn":"14222"}]},{"group":"code:TAPS 1148","srcdb":"202610","sections":[{"crn":"14009"}]},{"group":"code:TAPS 1230","srcdb":"202610","sections":[{"crn":"14218"}]},{"group":"code:TAPS 1251P","srcdb":"202610","sections":[{"crn":"13180"},{"crn":"13181"},{"crn":"13182"},{"crn":"13183"},{"crn":"13184"},{"crn":"13185"},{"crn":"13186"},{"crn":"13187"},{"crn":"13188"},{"crn":"13189"}]},{"group":"code:TAPS 1280G","srcdb":"202610","sections":[{"crn":"14220"}]},{"group":"code:TAPS 1280K","srcdb":"202610","sections":[{"crn":"14965"}]},{"group":"code:TAPS 1281O","srcdb":"202610","sections":[{"crn":"14194"}]},{"group":"code:TAPS 1285","srcdb":"202610","sections":[{"crn":"14182"}]},{"group":"code:TAPS 1342","srcdb":"202610","sections":[{"crn":"14240"}]},{"group":"code:TAPS 1348","srcdb":"202610","sections":[{"crn":"14189"}]},{"group":"code:TAPS 1500R","srcdb":"202610","sections":[{"crn":"16217"}]},{"group":"code:TAPS 1511","srcdb":"202610","sections":[{"crn":"15786"},{"crn":"15908"},{"crn":"16218"}]},{"group":"code:TAPS 1600V","srcdb":"202610","sections":[{"crn":"15866"}]},{"group":"code:TAPS 1644M","srcdb":"202610","sections":[{"crn":"16185"}]},{"group":"code:TAPS 1670","srcdb":"202610","sections":[{"crn":"14219"}]},{"group":"code:TAPS 1970","srcdb":"202610","sections":[{"crn":"13190"},{"crn":"13191"},{"crn":"13192"},{"crn":"13193"},{"crn":"13194"},{"crn":"13195"},{"crn":"13196"},{"crn":"13197"},{"crn":"13198"},{"crn":"13199"},{"crn":"13200"},{"crn":"13201"},{"crn":"13202"},{"crn":"13203"},{"crn":"13204"}]},{"group":"code:TAPS 1970P","srcdb":"202610","sections":[{"crn":"13205"},{"crn":"13206"},{"crn":"13207"},{"crn":"13208"},{"crn":"14512"}]},{"group":"code:TAPS 1990","srcdb":"202610","sections":[{"crn":"13209"},{"crn":"13210"},{"crn":"13211"},{"crn":"13212"}]},{"group":"code:TAPS 2100","srcdb":"202610","sections":[{"crn":"14191"}]},{"group":"code:TAPS 2310","srcdb":"202610","sections":[{"crn":"14221"}]},{"group":"code:TAPS 2970","srcdb":"202610","sections":[{"crn":"13386"}]},{"group":"code:TAPS 2975","srcdb":"202610","sections":[{"crn":"13213"},{"crn":"13214"},{"crn":"13215"},{"crn":"13216"}]}];
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
