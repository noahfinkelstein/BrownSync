(() => {
  const groups = [{"group":"code:MPA 2721","srcdb":"202610","sections":[{"crn":"16300"}]},{"group":"code:MPA 2722","srcdb":"202610","sections":[{"crn":"15608"}]},{"group":"code:MPA 2723","srcdb":"202610","sections":[{"crn":"15680"}]},{"group":"code:MPA 2724","srcdb":"202610","sections":[{"crn":"15993"}]},{"group":"code:MPA 2981","srcdb":"202610","sections":[{"crn":"12346"},{"crn":"12347"},{"crn":"12348"}]},{"group":"code:MUSC 0021F","srcdb":"202610","sections":[{"crn":"15408"}]},{"group":"code:MUSC 0090","srcdb":"202610","sections":[{"crn":"15942"}]},{"group":"code:MUSC 0200","srcdb":"202610","sections":[{"crn":"15585"},{"crn":"16041"},{"crn":"16042"},{"crn":"16043"},{"crn":"16044"},{"crn":"16045"},{"crn":"16046"},{"crn":"16047"},{"crn":"16048"}]},{"group":"code:MUSC 0400B","srcdb":"202610","sections":[{"crn":"15405"},{"crn":"15406"},{"crn":"15407"}]},{"group":"code:MUSC 0450","srcdb":"202610","sections":[{"crn":"15581"},{"crn":"15582"}]},{"group":"code:MUSC 0550","srcdb":"202610","sections":[{"crn":"15569"},{"crn":"15571"},{"crn":"15572"},{"crn":"15573"},{"crn":"15574"},{"crn":"15575"}]},{"group":"code:MUSC 0600","srcdb":"202610","sections":[{"crn":"15592"}]},{"group":"code:MUSC 0610","srcdb":"202610","sections":[{"crn":"15593"}]},{"group":"code:MUSC 0620","srcdb":"202610","sections":[{"crn":"15594"}]},{"group":"code:MUSC 0630","srcdb":"202610","sections":[{"crn":"15596"},{"crn":"15597"},{"crn":"15598"},{"crn":"15599"},{"crn":"15600"},{"crn":"15601"},{"crn":"15602"},{"crn":"15603"},{"crn":"15604"}]},{"group":"code:MUSC 0640","srcdb":"202610","sections":[{"crn":"15613"},{"crn":"15614"}]},{"group":"code:MUSC 0642","srcdb":"202610","sections":[{"crn":"15615"},{"crn":"15616"}]},{"group":"code:MUSC 0650","srcdb":"202610","sections":[{"crn":"15591"}]},{"group":"code:MUSC 0670","srcdb":"202610","sections":[{"crn":"15619"}]},{"group":"code:MUSC 0680","srcdb":"202610","sections":[{"crn":"15620"}]},{"group":"code:MUSC 0810","srcdb":"202610","sections":[{"crn":"12349"},{"crn":"12350"},{"crn":"12351"},{"crn":"12352"},{"crn":"12353"},{"crn":"12354"}]},{"group":"code:MUSC 0890","srcdb":"202610","sections":[{"crn":"15410"}]},{"group":"code:MUSC 1010","srcdb":"202610","sections":[{"crn":"15415"}]},{"group":"code:MUSC 1050","srcdb":"202610","sections":[{"crn":"15589"}]},{"group":"code:MUSC 1100","srcdb":"202610","sections":[{"crn":"15584"},{"crn":"16200"},{"crn":"16201"},{"crn":"16202"}]}];
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
