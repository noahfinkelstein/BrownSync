(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10424"},{"crn":"10425"},{"crn":"10426"},{"crn":"10427"},{"crn":"10428"},{"crn":"10429"},{"crn":"10430"},{"crn":"10431"},{"crn":"10432"},{"crn":"10433"},{"crn":"10434"},{"crn":"10435"},{"crn":"10436"},{"crn":"10437"},{"crn":"10438"},{"crn":"10439"},{"crn":"10440"},{"crn":"10441"},{"crn":"10442"},{"crn":"10443"},{"crn":"10444"},{"crn":"10445"},{"crn":"10446"},{"crn":"10447"},{"crn":"10448"},{"crn":"10449"},{"crn":"10450"},{"crn":"10451"},{"crn":"10452"},{"crn":"10453"},{"crn":"10454"},{"crn":"10455"},{"crn":"10456"},{"crn":"10457"},{"crn":"10458"},{"crn":"10459"},{"crn":"10460"},{"crn":"10461"},{"crn":"10462"},{"crn":"10463"},{"crn":"10464"},{"crn":"10465"},{"crn":"10466"},{"crn":"10467"},{"crn":"10468"},{"crn":"10469"},{"crn":"10470"},{"crn":"10471"},{"crn":"10472"},{"crn":"10473"}]}];
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
