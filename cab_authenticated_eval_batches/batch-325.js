(() => {
  const groups = [{"group":"code:CSCI 0111E","srcdb":"202610","sections":[{"crn":"16127"},{"crn":"16128"},{"crn":"16129"}]},{"group":"code:CSCI 0150","srcdb":"202610","sections":[{"crn":"13667"},{"crn":"15911"},{"crn":"15912"},{"crn":"15913"},{"crn":"15914"},{"crn":"15915"},{"crn":"15916"},{"crn":"15917"},{"crn":"15918"},{"crn":"15919"},{"crn":"15920"},{"crn":"15921"},{"crn":"15922"},{"crn":"15923"},{"crn":"15924"}]},{"group":"code:CSCI 0170","srcdb":"202610","sections":[{"crn":"10144"},{"crn":"14895"},{"crn":"15985"},{"crn":"15986"},{"crn":"15987"},{"crn":"15988"}]},{"group":"code:CSCI 0190","srcdb":"202610","sections":[{"crn":"13668"},{"crn":"15950"},{"crn":"15951"},{"crn":"15952"}]},{"group":"code:CSCI 0200","srcdb":"202610","sections":[{"crn":"13669"},{"crn":"15872"},{"crn":"15873"},{"crn":"15874"},{"crn":"15875"},{"crn":"16022"}]},{"group":"code:CSCI 0220","srcdb":"202610","sections":[{"crn":"13670"},{"crn":"15889"},{"crn":"15890"},{"crn":"15891"},{"crn":"15892"}]},{"group":"code:CSCI 0300","srcdb":"202610","sections":[{"crn":"13671"},{"crn":"15795"},{"crn":"15838"},{"crn":"15839"},{"crn":"15840"},{"crn":"15841"},{"crn":"15842"},{"crn":"15843"},{"crn":"15844"}]},{"group":"code:CSCI 0320","srcdb":"202610","sections":[{"crn":"13672"},{"crn":"15876"},{"crn":"15877"},{"crn":"15878"},{"crn":"15879"},{"crn":"15880"},{"crn":"16023"}]},{"group":"code:CSCI 0410","srcdb":"202610","sections":[{"crn":"13673"},{"crn":"15926"},{"crn":"15927"},{"crn":"15928"},{"crn":"15929"},{"crn":"15930"},{"crn":"15931"}]},{"group":"code:CSCI 0500","srcdb":"202610","sections":[{"crn":"13674"}]},{"group":"code:CSCI 1010","srcdb":"202610","sections":[{"crn":"14336"}]},{"group":"code:CSCI 1230","srcdb":"202610","sections":[{"crn":"14241"},{"crn":"15812"}]},{"group":"code:CSCI 1234","srcdb":"202610","sections":[{"crn":"14242"}]},{"group":"code:CSCI 1250","srcdb":"202610","sections":[{"crn":"14243"}]},{"group":"code:CSCI 1260","srcdb":"202610","sections":[{"crn":"14244"}]},{"group":"code:CSCI 1270","srcdb":"202610","sections":[{"crn":"14245"}]},{"group":"code:CSCI 1302","srcdb":"202610","sections":[{"crn":"14246"}]},{"group":"code:CSCI 1310","srcdb":"202610","sections":[{"crn":"13681"},{"crn":"15797"}]},{"group":"code:CSCI 1340","srcdb":"202610","sections":[{"crn":"14247"}]},{"group":"code:CSCI 1360","srcdb":"202610","sections":[{"crn":"14248"},{"crn":"15938"}]},{"group":"code:CSCI 1377","srcdb":"202610","sections":[{"crn":"15788"}]},{"group":"code:CSCI 1390","srcdb":"202610","sections":[{"crn":"15945"}]},{"group":"code:CSCI 1411","srcdb":"202610","sections":[{"crn":"13682"}]},{"group":"code:CSCI 1420","srcdb":"202610","sections":[{"crn":"14254"}]},{"group":"code:CSCI 1430","srcdb":"202610","sections":[{"crn":"14255"}]}];
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
