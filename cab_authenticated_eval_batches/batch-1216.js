(() => {
  const groups = [{"group":"code:NEUR 2110","srcdb":"202610","sections":[{"crn":"10075"},{"crn":"15066"},{"crn":"15071"},{"crn":"15072"},{"crn":"15073"}]},{"group":"code:NEUR 2970","srcdb":"202610","sections":[{"crn":"13353"}]},{"group":"code:NEUR 2980","srcdb":"202610","sections":[{"crn":"12457"},{"crn":"12458"},{"crn":"12459"},{"crn":"12460"},{"crn":"12461"},{"crn":"12462"},{"crn":"12463"},{"crn":"12464"},{"crn":"12465"},{"crn":"12466"},{"crn":"12467"},{"crn":"12468"},{"crn":"12469"},{"crn":"12470"},{"crn":"12471"},{"crn":"12472"},{"crn":"12473"},{"crn":"12474"},{"crn":"12475"},{"crn":"12476"},{"crn":"12477"},{"crn":"12478"},{"crn":"12479"},{"crn":"12480"},{"crn":"12481"},{"crn":"12482"},{"crn":"12483"},{"crn":"13485"},{"crn":"13507"},{"crn":"13508"},{"crn":"16151"}]},{"group":"code:NEUR 2990","srcdb":"202610","sections":[{"crn":"13354"}]}];
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
