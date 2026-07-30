(() => {
  const groups = [{"group":"code:CSCI 2980","srcdb":"202610","sections":[{"crn":"11451"},{"crn":"11452"},{"crn":"11453"},{"crn":"11454"},{"crn":"11455"},{"crn":"11456"},{"crn":"11457"},{"crn":"11458"},{"crn":"11459"},{"crn":"11460"},{"crn":"11461"},{"crn":"11462"},{"crn":"11463"},{"crn":"11464"},{"crn":"11465"},{"crn":"11466"},{"crn":"11467"},{"crn":"11468"},{"crn":"11469"},{"crn":"11470"},{"crn":"11471"},{"crn":"11472"},{"crn":"11473"},{"crn":"11474"},{"crn":"11475"},{"crn":"11476"},{"crn":"11477"},{"crn":"11478"},{"crn":"11479"},{"crn":"11480"},{"crn":"11481"},{"crn":"11482"},{"crn":"11483"},{"crn":"11484"},{"crn":"11485"},{"crn":"11486"},{"crn":"11487"},{"crn":"11488"},{"crn":"11489"},{"crn":"11490"},{"crn":"11491"},{"crn":"11492"},{"crn":"11493"},{"crn":"11494"},{"crn":"11495"},{"crn":"11496"},{"crn":"11497"},{"crn":"11498"},{"crn":"11499"},{"crn":"11500"}]}];
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
