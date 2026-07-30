(() => {
  const groups = [{"group":"code:POLS 1910","srcdb":"202610","sections":[{"crn":"14054"}]},{"group":"code:POLS 1970","srcdb":"202610","sections":[{"crn":"12947"},{"crn":"12948"},{"crn":"12949"},{"crn":"12950"},{"crn":"12951"},{"crn":"12952"},{"crn":"12953"},{"crn":"12954"},{"crn":"12955"},{"crn":"12956"},{"crn":"12957"},{"crn":"12958"},{"crn":"12959"},{"crn":"12960"},{"crn":"12961"},{"crn":"12962"},{"crn":"12963"},{"crn":"12964"},{"crn":"12965"},{"crn":"12966"},{"crn":"12967"},{"crn":"12968"},{"crn":"12969"},{"crn":"12970"},{"crn":"12971"},{"crn":"12972"},{"crn":"12973"},{"crn":"12974"},{"crn":"12975"},{"crn":"12976"},{"crn":"12977"},{"crn":"12978"},{"crn":"12979"},{"crn":"12980"},{"crn":"12981"},{"crn":"12982"}]},{"group":"code:POLS 2050","srcdb":"202610","sections":[{"crn":"14055"}]},{"group":"code:POLS 2052","srcdb":"202610","sections":[{"crn":"14056"}]}];
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
