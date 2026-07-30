(() => {
  const groups = [{"group":"code:HSP 2455A","srcdb":"202610","sections":[{"crn":"15499"}]},{"group":"code:HSP 2465A","srcdb":"202610","sections":[{"crn":"15500"}]},{"group":"code:IAPA 0400","srcdb":"202610","sections":[{"crn":"15219"}]},{"group":"code:IAPA 1002","srcdb":"202610","sections":[{"crn":"15274"}]},{"group":"code:IAPA 1003","srcdb":"202610","sections":[{"crn":"15221"}]},{"group":"code:IAPA 1020A","srcdb":"202610","sections":[{"crn":"15899"}]},{"group":"code:IAPA 1201C","srcdb":"202610","sections":[{"crn":"16073"}]},{"group":"code:IAPA 1201D","srcdb":"202610","sections":[{"crn":"15236"}]},{"group":"code:IAPA 1201G","srcdb":"202610","sections":[{"crn":"16053"}]},{"group":"code:IAPA 1201H","srcdb":"202610","sections":[{"crn":"15982"}]},{"group":"code:IAPA 1225","srcdb":"202610","sections":[{"crn":"15777"}]},{"group":"code:IAPA 1250","srcdb":"202610","sections":[{"crn":"15949"}]},{"group":"code:IAPA 1401","srcdb":"202610","sections":[{"crn":"15215"}]},{"group":"code:IAPA 1440","srcdb":"202610","sections":[{"crn":"15776"}]},{"group":"code:IAPA 1700G","srcdb":"202610","sections":[{"crn":"15757"}]},{"group":"code:IAPA 1700I","srcdb":"202610","sections":[{"crn":"16036"}]},{"group":"code:IAPA 1700J","srcdb":"202610","sections":[{"crn":"16035"}]},{"group":"code:IAPA 1700Q","srcdb":"202610","sections":[{"crn":"16037"}]},{"group":"code:IAPA 1701M","srcdb":"202610","sections":[{"crn":"15665"}]},{"group":"code:IAPA 1701V","srcdb":"202610","sections":[{"crn":"15216"}]},{"group":"code:IAPA 1701W","srcdb":"202610","sections":[{"crn":"15223"}]},{"group":"code:IAPA 1702N","srcdb":"202610","sections":[{"crn":"16140"}]},{"group":"code:IAPA 1702O","srcdb":"202610","sections":[{"crn":"15836"}]},{"group":"code:IAPA 1801H","srcdb":"202610","sections":[{"crn":"15429"}]},{"group":"code:IAPA 1801I","srcdb":"202610","sections":[{"crn":"16169"}]}];
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
