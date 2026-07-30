(() => {
  const groups = [{"group":"code:BIOL 0530","srcdb":"202610","sections":[{"crn":"10107"},{"crn":"13536"},{"crn":"13537"},{"crn":"13538"},{"crn":"13539"},{"crn":"13540"},{"crn":"13541"},{"crn":"13542"},{"crn":"13543"},{"crn":"13544"},{"crn":"13545"},{"crn":"13546"},{"crn":"13547"},{"crn":"14848"}]},{"group":"code:BIOL 0940A","srcdb":"202610","sections":[{"crn":"10086"},{"crn":"14849"}]},{"group":"code:BIOL 0940D","srcdb":"202610","sections":[{"crn":"10101"},{"crn":"14865"}]},{"group":"code:BIOL 0946","srcdb":"202610","sections":[{"crn":"13575"}]}];
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
