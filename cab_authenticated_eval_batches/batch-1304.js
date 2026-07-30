(() => {
  const groups = [{"group":"code:PHYS 1990","srcdb":"202610","sections":[{"crn":"12796"},{"crn":"12797"},{"crn":"12798"},{"crn":"12799"},{"crn":"12800"},{"crn":"12801"},{"crn":"12802"},{"crn":"12803"},{"crn":"12804"},{"crn":"12805"},{"crn":"12806"},{"crn":"12807"},{"crn":"12808"},{"crn":"12809"},{"crn":"12810"},{"crn":"12811"},{"crn":"12812"},{"crn":"12813"},{"crn":"12814"},{"crn":"12815"},{"crn":"12816"},{"crn":"12817"},{"crn":"12818"},{"crn":"12819"},{"crn":"12820"},{"crn":"12821"},{"crn":"13504"},{"crn":"14402"},{"crn":"16204"}]},{"group":"code:PHYS 2010","srcdb":"202610","sections":[{"crn":"13895"}]},{"group":"code:PHYS 2020","srcdb":"202610","sections":[{"crn":"13896"}]},{"group":"code:PHYS 2030","srcdb":"202610","sections":[{"crn":"13897"}]}];
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
