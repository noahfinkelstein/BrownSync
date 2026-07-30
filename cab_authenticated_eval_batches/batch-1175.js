(() => {
  const groups = [{"group":"code:MUSC 1120","srcdb":"202610","sections":[{"crn":"15414"}]},{"group":"code:MUSC 1150","srcdb":"202610","sections":[{"crn":"15588"}]},{"group":"code:MUSC 1170","srcdb":"202610","sections":[{"crn":"15409"}]},{"group":"code:MUSC 1200","srcdb":"202610","sections":[{"crn":"15576"},{"crn":"15577"},{"crn":"15578"},{"crn":"15579"}]},{"group":"code:MUSC 1210","srcdb":"202610","sections":[{"crn":"15412"},{"crn":"15413"}]},{"group":"code:MUSC 1222","srcdb":"202610","sections":[{"crn":"16229"}]},{"group":"code:MUSC 1234","srcdb":"202610","sections":[{"crn":"16013"}]},{"group":"code:MUSC 1240N","srcdb":"202610","sections":[{"crn":"15587"}]},{"group":"code:MUSC 1240R","srcdb":"202610","sections":[{"crn":"15580"}]},{"group":"code:MUSC 1240S","srcdb":"202610","sections":[{"crn":"15722"}]},{"group":"code:MUSC 1246","srcdb":"202610","sections":[{"crn":"15960"}]},{"group":"code:MUSC 1380","srcdb":"202610","sections":[{"crn":"15944"}]},{"group":"code:MUSC 1644","srcdb":"202610","sections":[{"crn":"16177"}]},{"group":"code:MUSC 1740","srcdb":"202610","sections":[{"crn":"16085"}]},{"group":"code:MUSC 1810","srcdb":"202610","sections":[{"crn":"12356"},{"crn":"12357"},{"crn":"12358"},{"crn":"12359"},{"crn":"12360"}]},{"group":"code:MUSC 1960","srcdb":"202610","sections":[{"crn":"15617"},{"crn":"15618"}]},{"group":"code:MUSC 1970","srcdb":"202610","sections":[{"crn":"12361"},{"crn":"12362"},{"crn":"12363"},{"crn":"12364"},{"crn":"12365"},{"crn":"12366"},{"crn":"12367"},{"crn":"12368"},{"crn":"12369"},{"crn":"12370"},{"crn":"12371"},{"crn":"12372"},{"crn":"12373"}]},{"group":"code:MUSC 2000","srcdb":"202610","sections":[{"crn":"15583"}]},{"group":"code:MUSC 2026","srcdb":"202610","sections":[{"crn":"15943"}]},{"group":"code:MUSC 2077","srcdb":"202610","sections":[{"crn":"15959"}]},{"group":"code:MUSC 2086","srcdb":"202610","sections":[{"crn":"15590"}]},{"group":"code:MUSC 2200","srcdb":"202610","sections":[{"crn":"15586"}]},{"group":"code:MUSC 2970","srcdb":"202610","sections":[{"crn":"13351"}]},{"group":"code:MUSC 2980","srcdb":"202610","sections":[{"crn":"12374"},{"crn":"12375"},{"crn":"12376"},{"crn":"12377"},{"crn":"12378"},{"crn":"12379"},{"crn":"12380"},{"crn":"12381"},{"crn":"12382"},{"crn":"12383"},{"crn":"12384"},{"crn":"12385"},{"crn":"12386"},{"crn":"12387"},{"crn":"12388"},{"crn":"12389"},{"crn":"12390"}]},{"group":"code:MUSC 2990","srcdb":"202610","sections":[{"crn":"13352"}]}];
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
