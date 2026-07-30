(() => {
  const groups = [{"group":"code:LITR 0110B","srcdb":"202610","sections":[{"crn":"13792"},{"crn":"13793"},{"crn":"13794"}]},{"group":"code:LITR 0110E","srcdb":"202610","sections":[{"crn":"15953"},{"crn":"15978"}]},{"group":"code:LITR 0110H","srcdb":"202610","sections":[{"crn":"13795"}]},{"group":"code:LITR 0210A","srcdb":"202610","sections":[{"crn":"13800"}]},{"group":"code:LITR 0210B","srcdb":"202610","sections":[{"crn":"13806"}]},{"group":"code:LITR 0210E","srcdb":"202610","sections":[{"crn":"13812"}]},{"group":"code:LITR 0310S","srcdb":"202610","sections":[{"crn":"15144"}]},{"group":"code:LITR 0610I","srcdb":"202610","sections":[{"crn":"14961"}]},{"group":"code:LITR 0710","srcdb":"202610","sections":[{"crn":"13804"}]},{"group":"code:LITR 1010A","srcdb":"202610","sections":[{"crn":"13797"}]},{"group":"code:LITR 1010B","srcdb":"202610","sections":[{"crn":"13802"}]},{"group":"code:LITR 1010F","srcdb":"202610","sections":[{"crn":"14644"}]},{"group":"code:LITR 1010H","srcdb":"202610","sections":[{"crn":"13803"}]},{"group":"code:LITR 1110N","srcdb":"202610","sections":[{"crn":"13801"}]},{"group":"code:LITR 1110U","srcdb":"202610","sections":[{"crn":"13811"}]},{"group":"code:LITR 1110Z","srcdb":"202610","sections":[{"crn":"14371"}]},{"group":"code:LITR 1152W","srcdb":"202610","sections":[{"crn":"14591"}]},{"group":"code:LITR 1153G","srcdb":"202610","sections":[{"crn":"14988"}]},{"group":"code:LITR 1153L","srcdb":"202610","sections":[{"crn":"15027"}]},{"group":"code:LITR 1153M","srcdb":"202610","sections":[{"crn":"14693"}]},{"group":"code:LITR 1200","srcdb":"202610","sections":[{"crn":"13796"}]},{"group":"code:LITR 1220L","srcdb":"202610","sections":[{"crn":"15868"}]},{"group":"code:LITR 1231E","srcdb":"202610","sections":[{"crn":"14373"}]},{"group":"code:LITR 1300","srcdb":"202610","sections":[{"crn":"12162"},{"crn":"12163"},{"crn":"12164"},{"crn":"12165"},{"crn":"12166"},{"crn":"12167"},{"crn":"12168"},{"crn":"12169"}]},{"group":"code:LITR 1310","srcdb":"202610","sections":[{"crn":"12170"},{"crn":"12171"},{"crn":"12172"},{"crn":"12173"},{"crn":"12174"},{"crn":"12175"},{"crn":"12176"},{"crn":"12177"},{"crn":"12178"},{"crn":"12179"},{"crn":"12180"}]}];
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
