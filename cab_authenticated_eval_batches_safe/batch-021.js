(() => {
  const groups = [{"group":"code:BIOL 2980","srcdb":"202610","sections":[{"crn":"10945"},{"crn":"10946"},{"crn":"10947"},{"crn":"10948"},{"crn":"10949"},{"crn":"10950"},{"crn":"10951"},{"crn":"10952"},{"crn":"10953"},{"crn":"10954"},{"crn":"10955"},{"crn":"10956"},{"crn":"10957"},{"crn":"10958"},{"crn":"10959"},{"crn":"10960"},{"crn":"10961"},{"crn":"10962"},{"crn":"10963"},{"crn":"10964"},{"crn":"10965"},{"crn":"10966"},{"crn":"10967"},{"crn":"10968"},{"crn":"10969"},{"crn":"10970"},{"crn":"10971"},{"crn":"10972"},{"crn":"13463"},{"crn":"13484"},{"crn":"13503"},{"crn":"13532"},{"crn":"13573"},{"crn":"14317"},{"crn":"14318"},{"crn":"14319"},{"crn":"14320"},{"crn":"14528"},{"crn":"14531"},{"crn":"16141"},{"crn":"16176"}]}];
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
