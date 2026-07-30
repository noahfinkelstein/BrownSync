(() => {
  const groups = [{"group":"code:MGRK 0300","srcdb":"202610","sections":[{"crn":"13867"}]},{"group":"code:MGRK 0500","srcdb":"202610","sections":[{"crn":"13868"}]},{"group":"code:MGRK 1800","srcdb":"202610","sections":[{"crn":"13869"}]},{"group":"code:MGRK 1910","srcdb":"202610","sections":[{"crn":"12343"},{"crn":"12344"},{"crn":"12345"}]},{"group":"code:MGRK 2200","srcdb":"202610","sections":[{"crn":"13870"}]},{"group":"code:MPA 2020","srcdb":"202610","sections":[{"crn":"15034"}]},{"group":"code:MPA 2221","srcdb":"202610","sections":[{"crn":"15139"}]},{"group":"code:MPA 2226","srcdb":"202610","sections":[{"crn":"15032"}]},{"group":"code:MPA 2229","srcdb":"202610","sections":[{"crn":"15033"}]},{"group":"code:MPA 2445","srcdb":"202610","sections":[{"crn":"15031"}]},{"group":"code:MPA 2476","srcdb":"202610","sections":[{"crn":"16040"}]},{"group":"code:MPA 2478","srcdb":"202610","sections":[{"crn":"16349"}]},{"group":"code:MPA 2479","srcdb":"202610","sections":[{"crn":"16355"}]},{"group":"code:MPA 2540","srcdb":"202610","sections":[{"crn":"16017"}]},{"group":"code:MPA 2607","srcdb":"202610","sections":[{"crn":"15716"}]},{"group":"code:MPA 2610","srcdb":"202610","sections":[{"crn":"16305"}]},{"group":"code:MPA 2721","srcdb":"202610","sections":[{"crn":"16300"}]},{"group":"code:MPA 2722","srcdb":"202610","sections":[{"crn":"15608"}]},{"group":"code:MPA 2723","srcdb":"202610","sections":[{"crn":"15680"}]},{"group":"code:MPA 2724","srcdb":"202610","sections":[{"crn":"15993"}]},{"group":"code:MPA 2981","srcdb":"202610","sections":[{"crn":"12346"},{"crn":"12347"},{"crn":"12348"}]},{"group":"code:MUSC 0021F","srcdb":"202610","sections":[{"crn":"15408"}]},{"group":"code:MUSC 0090","srcdb":"202610","sections":[{"crn":"15942"}]},{"group":"code:MUSC 0200","srcdb":"202610","sections":[{"crn":"15585"},{"crn":"16041"},{"crn":"16042"},{"crn":"16043"},{"crn":"16044"},{"crn":"16045"},{"crn":"16046"},{"crn":"16047"},{"crn":"16048"}]},{"group":"code:MUSC 0400B","srcdb":"202610","sections":[{"crn":"15405"},{"crn":"15406"},{"crn":"15407"}]}];
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
