(() => {
  const groups = [{"group":"code:ANTH 2970","srcdb":"202610","sections":[{"crn":"13278"}]},{"group":"code:ANTH 2980","srcdb":"202610","sections":[{"crn":"10259"},{"crn":"10260"},{"crn":"10261"},{"crn":"10262"},{"crn":"10263"},{"crn":"10264"},{"crn":"10265"},{"crn":"10266"},{"crn":"10267"},{"crn":"10268"},{"crn":"10269"},{"crn":"10270"},{"crn":"10271"},{"crn":"10272"},{"crn":"10273"},{"crn":"10274"},{"crn":"10275"},{"crn":"10276"},{"crn":"10277"},{"crn":"10278"},{"crn":"16154"}]},{"group":"code:ANTH 2990","srcdb":"202610","sections":[{"crn":"13279"}]},{"group":"code:APMA 0160","srcdb":"202610","sections":[{"crn":"14596"}]}];
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
