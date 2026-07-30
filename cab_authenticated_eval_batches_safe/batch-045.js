(() => {
  const groups = [{"group":"code:ENGL 0101J","srcdb":"202610","sections":[{"crn":"14064"},{"crn":"15652"},{"crn":"15653"}]},{"group":"code:ENGL 0202R","srcdb":"202610","sections":[{"crn":"15656"}]},{"group":"code:ENGL 0202S","srcdb":"202610","sections":[{"crn":"15657"}]},{"group":"code:ENGL 0202U","srcdb":"202610","sections":[{"crn":"15658"}]},{"group":"code:ENGL 0202X","srcdb":"202610","sections":[{"crn":"15659"}]},{"group":"code:ENGL 0300R","srcdb":"202610","sections":[{"crn":"15677"}]},{"group":"code:ENGL 0310A","srcdb":"202610","sections":[{"crn":"13748"},{"crn":"15654"},{"crn":"15655"}]},{"group":"code:ENGL 0500S","srcdb":"202610","sections":[{"crn":"15404"}]},{"group":"code:ENGL 0511H","srcdb":"202610","sections":[{"crn":"14015"}]},{"group":"code:ENGL 0700R","srcdb":"202610","sections":[{"crn":"13752"}]},{"group":"code:ENGL 0710U","srcdb":"202610","sections":[{"crn":"13753"},{"crn":"15759"},{"crn":"15760"}]},{"group":"code:ENGL 0710V","srcdb":"202610","sections":[{"crn":"13754"}]},{"group":"code:ENGL 0800X","srcdb":"202610","sections":[{"crn":"14931"}]},{"group":"code:ENGL 0900","srcdb":"202610","sections":[{"crn":"13732"},{"crn":"13733"},{"crn":"15667"},{"crn":"15668"},{"crn":"15669"},{"crn":"15791"}]},{"group":"code:ENGL 0910X","srcdb":"202610","sections":[{"crn":"15882"}]},{"group":"code:ENGL 0930","srcdb":"202610","sections":[{"crn":"13734"},{"crn":"13735"},{"crn":"13736"},{"crn":"13737"},{"crn":"13738"}]},{"group":"code:ENGL 1030G","srcdb":"202610","sections":[{"crn":"13781"}]},{"group":"code:ENGL 1030L","srcdb":"202610","sections":[{"crn":"16020"}]},{"group":"code:ENGL 1030M","srcdb":"202610","sections":[{"crn":"13784"}]},{"group":"code:ENGL 1050B","srcdb":"202610","sections":[{"crn":"13739"}]},{"group":"code:ENGL 1051B","srcdb":"202610","sections":[{"crn":"13780"}]},{"group":"code:ENGL 1051C","srcdb":"202610","sections":[{"crn":"15005"}]},{"group":"code:ENGL 1051D","srcdb":"202610","sections":[{"crn":"14291"}]},{"group":"code:ENGL 1180H","srcdb":"202610","sections":[{"crn":"13782"}]},{"group":"code:ENGL 1180Z","srcdb":"202610","sections":[{"crn":"13731"}]}];
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
