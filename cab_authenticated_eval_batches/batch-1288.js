(() => {
  const groups = [{"group":"code:PHYS 0030","srcdb":"202610","sections":[{"crn":"10044"},{"crn":"10045"},{"crn":"10111"},{"crn":"10112"},{"crn":"13904"},{"crn":"13905"},{"crn":"13906"},{"crn":"13907"},{"crn":"13908"},{"crn":"13909"},{"crn":"13910"},{"crn":"13911"},{"crn":"13912"},{"crn":"13913"},{"crn":"13914"},{"crn":"13915"}]},{"group":"code:PHYS 0040","srcdb":"202610","sections":[{"crn":"10046"},{"crn":"13917"},{"crn":"13918"},{"crn":"13919"}]},{"group":"code:PHYS 0050","srcdb":"202610","sections":[{"crn":"10047"},{"crn":"13920"},{"crn":"13921"},{"crn":"13922"},{"crn":"13923"},{"crn":"13924"},{"crn":"13925"},{"crn":"13926"}]},{"group":"code:PHYS 0070","srcdb":"202610","sections":[{"crn":"10048"},{"crn":"13927"},{"crn":"13928"},{"crn":"13929"},{"crn":"13930"},{"crn":"13931"},{"crn":"13932"},{"crn":"13933"}]}];
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
