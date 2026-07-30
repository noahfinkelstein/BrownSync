(() => {
  const groups = [{"group":"code:CSCI 1973","srcdb":"202610","sections":[{"crn":"11398"},{"crn":"11399"},{"crn":"11400"},{"crn":"11401"},{"crn":"11402"},{"crn":"11403"},{"crn":"11404"},{"crn":"11405"},{"crn":"11406"},{"crn":"11407"},{"crn":"11408"},{"crn":"11409"},{"crn":"11410"},{"crn":"11411"},{"crn":"11412"},{"crn":"11413"},{"crn":"11414"},{"crn":"11415"},{"crn":"11416"},{"crn":"11417"},{"crn":"11418"},{"crn":"11419"},{"crn":"11420"},{"crn":"11421"},{"crn":"11422"},{"crn":"11423"},{"crn":"11424"},{"crn":"11425"},{"crn":"11426"},{"crn":"11427"},{"crn":"11428"},{"crn":"11429"},{"crn":"11430"},{"crn":"11431"},{"crn":"11432"},{"crn":"11433"},{"crn":"11434"},{"crn":"11435"},{"crn":"11436"},{"crn":"11437"},{"crn":"11438"},{"crn":"11439"},{"crn":"11440"},{"crn":"11441"},{"crn":"11442"},{"crn":"11443"},{"crn":"11444"},{"crn":"11445"},{"crn":"11446"},{"crn":"11447"}]}];
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
