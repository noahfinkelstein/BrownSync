(() => {
  const groups = [{"group":"code:APMA 1931C","srcdb":"202610","sections":[{"crn":"14621"}]},{"group":"code:APMA 1970","srcdb":"202610","sections":[{"crn":"10279"},{"crn":"10280"},{"crn":"10281"},{"crn":"10282"},{"crn":"10283"},{"crn":"10284"},{"crn":"10285"},{"crn":"10286"},{"crn":"10287"},{"crn":"10288"},{"crn":"10289"},{"crn":"10290"},{"crn":"10291"},{"crn":"10292"},{"crn":"10293"},{"crn":"10294"},{"crn":"10295"},{"crn":"10296"},{"crn":"10297"},{"crn":"10298"},{"crn":"10299"},{"crn":"10300"}]},{"group":"code:APMA 1971","srcdb":"202610","sections":[{"crn":"10301"},{"crn":"10302"},{"crn":"10303"},{"crn":"10304"},{"crn":"10305"},{"crn":"10306"},{"crn":"10307"},{"crn":"10308"},{"crn":"10309"},{"crn":"10310"},{"crn":"10311"},{"crn":"10312"},{"crn":"10313"},{"crn":"10314"},{"crn":"10315"},{"crn":"10316"},{"crn":"10317"},{"crn":"10318"},{"crn":"10319"},{"crn":"10320"}]},{"group":"code:APMA 2110","srcdb":"202610","sections":[{"crn":"14622"}]}];
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
