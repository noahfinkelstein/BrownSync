(() => {
  const groups = [{"group":"code:APMA 2670","srcdb":"202610","sections":[{"crn":"14627"}]},{"group":"code:APMA 2812K","srcdb":"202610","sections":[{"crn":"14642"}]},{"group":"code:APMA 2980","srcdb":"202610","sections":[{"crn":"10321"},{"crn":"10322"},{"crn":"10323"},{"crn":"10324"},{"crn":"10325"},{"crn":"10326"},{"crn":"10327"},{"crn":"10328"},{"crn":"10329"},{"crn":"10330"},{"crn":"10331"},{"crn":"10332"},{"crn":"10333"},{"crn":"10334"},{"crn":"10335"},{"crn":"10336"},{"crn":"10337"},{"crn":"10338"},{"crn":"10339"},{"crn":"10340"},{"crn":"10341"},{"crn":"10342"},{"crn":"10343"},{"crn":"10344"},{"crn":"10345"}]},{"group":"code:APMA 2990","srcdb":"202610","sections":[{"crn":"13281"}]}];
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
