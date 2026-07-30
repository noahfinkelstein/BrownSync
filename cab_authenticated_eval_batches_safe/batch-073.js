(() => {
  const groups = [{"group":"code:MUSC 0450","srcdb":"202610","sections":[{"crn":"15581"},{"crn":"15582"}]},{"group":"code:MUSC 0550","srcdb":"202610","sections":[{"crn":"15569"},{"crn":"15571"},{"crn":"15572"},{"crn":"15573"},{"crn":"15574"},{"crn":"15575"}]},{"group":"code:MUSC 0600","srcdb":"202610","sections":[{"crn":"15592"}]},{"group":"code:MUSC 0610","srcdb":"202610","sections":[{"crn":"15593"}]},{"group":"code:MUSC 0620","srcdb":"202610","sections":[{"crn":"15594"}]},{"group":"code:MUSC 0630","srcdb":"202610","sections":[{"crn":"15596"},{"crn":"15597"},{"crn":"15598"},{"crn":"15599"},{"crn":"15600"},{"crn":"15601"},{"crn":"15602"},{"crn":"15603"},{"crn":"15604"}]},{"group":"code:MUSC 0640","srcdb":"202610","sections":[{"crn":"15613"},{"crn":"15614"}]},{"group":"code:MUSC 0642","srcdb":"202610","sections":[{"crn":"15615"},{"crn":"15616"}]},{"group":"code:MUSC 0650","srcdb":"202610","sections":[{"crn":"15591"}]},{"group":"code:MUSC 0670","srcdb":"202610","sections":[{"crn":"15619"}]},{"group":"code:MUSC 0680","srcdb":"202610","sections":[{"crn":"15620"}]},{"group":"code:MUSC 0810","srcdb":"202610","sections":[{"crn":"12349"},{"crn":"12350"},{"crn":"12351"},{"crn":"12352"},{"crn":"12353"},{"crn":"12354"}]},{"group":"code:MUSC 0890","srcdb":"202610","sections":[{"crn":"15410"}]},{"group":"code:MUSC 1010","srcdb":"202610","sections":[{"crn":"15415"}]},{"group":"code:MUSC 1050","srcdb":"202610","sections":[{"crn":"15589"}]},{"group":"code:MUSC 1100","srcdb":"202610","sections":[{"crn":"15584"},{"crn":"16200"},{"crn":"16201"},{"crn":"16202"}]},{"group":"code:MUSC 1120","srcdb":"202610","sections":[{"crn":"15414"}]},{"group":"code:MUSC 1150","srcdb":"202610","sections":[{"crn":"15588"}]},{"group":"code:MUSC 1170","srcdb":"202610","sections":[{"crn":"15409"}]},{"group":"code:MUSC 1200","srcdb":"202610","sections":[{"crn":"15576"},{"crn":"15577"},{"crn":"15578"},{"crn":"15579"}]},{"group":"code:MUSC 1210","srcdb":"202610","sections":[{"crn":"15412"},{"crn":"15413"}]},{"group":"code:MUSC 1222","srcdb":"202610","sections":[{"crn":"16229"}]},{"group":"code:MUSC 1234","srcdb":"202610","sections":[{"crn":"16013"}]},{"group":"code:MUSC 1240N","srcdb":"202610","sections":[{"crn":"15587"}]},{"group":"code:MUSC 1240R","srcdb":"202610","sections":[{"crn":"15580"}]}];
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
