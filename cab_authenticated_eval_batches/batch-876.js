(() => {
  const groups = [{"group":"code:HIST 1993","srcdb":"202610","sections":[{"crn":"15077"}]},{"group":"code:HIST 1994","srcdb":"202610","sections":[{"crn":"15079"}]},{"group":"code:HIST 2890","srcdb":"202610","sections":[{"crn":"13336"}]},{"group":"code:HIST 2910","srcdb":"202610","sections":[{"crn":"12068"},{"crn":"12069"},{"crn":"12070"},{"crn":"12071"},{"crn":"12072"},{"crn":"12073"},{"crn":"12074"},{"crn":"12075"},{"crn":"12076"},{"crn":"12077"},{"crn":"12078"},{"crn":"12079"},{"crn":"12080"},{"crn":"12081"},{"crn":"12082"},{"crn":"12083"},{"crn":"12084"},{"crn":"12085"},{"crn":"12086"},{"crn":"12087"},{"crn":"12088"},{"crn":"12089"},{"crn":"12090"},{"crn":"12091"},{"crn":"12092"},{"crn":"12093"},{"crn":"14392"},{"crn":"14507"}]}];
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
