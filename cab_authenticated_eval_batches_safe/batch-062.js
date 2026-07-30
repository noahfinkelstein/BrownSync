(() => {
  const groups = [{"group":"code:HMAN 1977E","srcdb":"202610","sections":[{"crn":"13984"}]},{"group":"code:HMAN 1977H","srcdb":"202610","sections":[{"crn":"15813"}]},{"group":"code:HMAN 1977T","srcdb":"202610","sections":[{"crn":"15905"}]},{"group":"code:HMAN 1977U","srcdb":"202610","sections":[{"crn":"13947"}]},{"group":"code:HMAN 1978A","srcdb":"202610","sections":[{"crn":"15904"}]},{"group":"code:HMAN 1978B","srcdb":"202610","sections":[{"crn":"15906"}]},{"group":"code:HMAN 1990","srcdb":"202610","sections":[{"crn":"12094"},{"crn":"12095"},{"crn":"12096"}]},{"group":"code:HMAN 2301","srcdb":"202610","sections":[{"crn":"13649"},{"crn":"14304"}]},{"group":"code:HMAN 2401L","srcdb":"202610","sections":[{"crn":"15814"}]},{"group":"code:HMAN 2402M","srcdb":"202610","sections":[{"crn":"13916"}]},{"group":"code:HMAN 2402N","srcdb":"202610","sections":[{"crn":"15345"}]},{"group":"code:HMAN 2402O","srcdb":"202610","sections":[{"crn":"13944"}]},{"group":"code:HMAN 2410","srcdb":"202610","sections":[{"crn":"16227"}]},{"group":"code:HMAN 2971I","srcdb":"202610","sections":[{"crn":"15229"}]},{"group":"code:HNDI 0100","srcdb":"202610","sections":[{"crn":"13434"}]},{"group":"code:HNDI 0300","srcdb":"202610","sections":[{"crn":"13435"}]},{"group":"code:HNDI 1080","srcdb":"202610","sections":[{"crn":"13442"}]},{"group":"code:HSP 0310","srcdb":"202610","sections":[{"crn":"14074"},{"crn":"14075"},{"crn":"14076"},{"crn":"14077"},{"crn":"14078"},{"crn":"14079"},{"crn":"14080"},{"crn":"14081"},{"crn":"14082"},{"crn":"14083"},{"crn":"14084"},{"crn":"14085"},{"crn":"14086"},{"crn":"14087"},{"crn":"14088"},{"crn":"14089"},{"crn":"14090"},{"crn":"14091"},{"crn":"14092"},{"crn":"14093"}]},{"group":"code:HSP 1460","srcdb":"202610","sections":[{"crn":"14657"}]},{"group":"code:HSP 1480","srcdb":"202610","sections":[{"crn":"16064"}]},{"group":"code:HSP 1481","srcdb":"202610","sections":[{"crn":"15857"}]},{"group":"code:HSP 1580","srcdb":"202610","sections":[{"crn":"15489"}]},{"group":"code:HSP 1821","srcdb":"202610","sections":[{"crn":"14754"}]},{"group":"code:HSP 2077A","srcdb":"202610","sections":[{"crn":"15867"}]},{"group":"code:HSP 2081","srcdb":"202610","sections":[{"crn":"15495"}]}];
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
