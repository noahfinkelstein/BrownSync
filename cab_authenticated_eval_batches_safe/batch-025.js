(() => {
  const groups = [{"group":"code:COLT 2820A","srcdb":"202610","sections":[{"crn":"16380"}]},{"group":"code:COLT 2980","srcdb":"202610","sections":[{"crn":"11089"},{"crn":"11090"},{"crn":"11091"},{"crn":"11092"},{"crn":"11093"},{"crn":"11094"},{"crn":"11095"},{"crn":"11096"}]},{"group":"code:COLT 2990","srcdb":"202610","sections":[{"crn":"13296"}]},{"group":"code:COST 0120","srcdb":"202610","sections":[{"crn":"13957"}]},{"group":"code:COST 0535","srcdb":"202610","sections":[{"crn":"13964"},{"crn":"15804"}]},{"group":"code:COST 0711","srcdb":"202610","sections":[{"crn":"16373"}]},{"group":"code:COST 0924","srcdb":"202610","sections":[{"crn":"15806"},{"crn":"15849"}]},{"group":"code:COST 1030","srcdb":"202610","sections":[{"crn":"15808"}]},{"group":"code:COST 1910","srcdb":"202610","sections":[{"crn":"11097"},{"crn":"11098"},{"crn":"11099"},{"crn":"11100"},{"crn":"11101"},{"crn":"11102"},{"crn":"11103"},{"crn":"11104"},{"crn":"11105"},{"crn":"11106"},{"crn":"11107"},{"crn":"11108"},{"crn":"11109"},{"crn":"11110"},{"crn":"11111"},{"crn":"11112"},{"crn":"11113"},{"crn":"11114"}]},{"group":"code:COST 1980","srcdb":"202610","sections":[{"crn":"14513"}]},{"group":"code:CPSY 0010","srcdb":"202610","sections":[{"crn":"14565"},{"crn":"15145"},{"crn":"15146"},{"crn":"15147"},{"crn":"15148"},{"crn":"15149"},{"crn":"15150"},{"crn":"15151"},{"crn":"15152"},{"crn":"15153"},{"crn":"15154"},{"crn":"15155"},{"crn":"15156"}]},{"group":"code:CPSY 0450","srcdb":"202610","sections":[{"crn":"14563"}]},{"group":"code:CPSY 0500","srcdb":"202610","sections":[{"crn":"14562"}]},{"group":"code:CPSY 0540","srcdb":"202610","sections":[{"crn":"14580"}]},{"group":"code:CPSY 0550","srcdb":"202610","sections":[{"crn":"14583"}]},{"group":"code:CPSY 0610","srcdb":"202610","sections":[{"crn":"14567"}]},{"group":"code:CPSY 0740","srcdb":"202610","sections":[{"crn":"14573"},{"crn":"16374"},{"crn":"16375"},{"crn":"16376"},{"crn":"16377"},{"crn":"16378"}]},{"group":"code:CPSY 0900","srcdb":"202610","sections":[{"crn":"14566"}]},{"group":"code:CPSY 1181C","srcdb":"202610","sections":[{"crn":"14594"}]},{"group":"code:CPSY 1195","srcdb":"202610","sections":[{"crn":"14588"}]},{"group":"code:CPSY 1196","srcdb":"202610","sections":[{"crn":"14633"}]},{"group":"code:CPSY 1197","srcdb":"202610","sections":[{"crn":"14589"}]},{"group":"code:CPSY 1291","srcdb":"202610","sections":[{"crn":"14579"}]},{"group":"code:CPSY 1480I","srcdb":"202610","sections":[{"crn":"14582"}]},{"group":"code:CPSY 1492","srcdb":"202610","sections":[{"crn":"14585"}]}];
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
