(() => {
  const groups = [{"group":"code:MATH 0090","srcdb":"202610","sections":[{"crn":"14428"},{"crn":"14429"},{"crn":"14430"},{"crn":"14431"},{"crn":"14432"},{"crn":"14433"},{"crn":"14434"},{"crn":"14435"},{"crn":"14436"},{"crn":"14437"},{"crn":"14438"},{"crn":"14439"},{"crn":"14440"},{"crn":"14441"},{"crn":"14442"}]},{"group":"code:MATH 0100","srcdb":"202610","sections":[{"crn":"14448"},{"crn":"14449"},{"crn":"14450"},{"crn":"14451"},{"crn":"14452"},{"crn":"14719"},{"crn":"14720"},{"crn":"14721"},{"crn":"14722"},{"crn":"14723"},{"crn":"14724"},{"crn":"14725"},{"crn":"14726"},{"crn":"14727"},{"crn":"14728"}]},{"group":"code:MATH 0180","srcdb":"202610","sections":[{"crn":"14453"},{"crn":"14454"},{"crn":"14455"},{"crn":"14456"},{"crn":"14457"},{"crn":"14458"},{"crn":"14459"},{"crn":"14460"},{"crn":"14461"},{"crn":"14462"}]},{"group":"code:MATH 0190","srcdb":"202610","sections":[{"crn":"14463"},{"crn":"14464"},{"crn":"14465"},{"crn":"14466"},{"crn":"14467"},{"crn":"14468"}]}];
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
