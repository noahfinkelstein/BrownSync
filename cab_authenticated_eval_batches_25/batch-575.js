(() => {
  const groups = [{"group":"code:ENGL 1380","srcdb":"202610","sections":[{"crn":"11717"},{"crn":"11718"},{"crn":"11719"}]},{"group":"code:ENGL 1561Q","srcdb":"202610","sections":[{"crn":"15974"}]},{"group":"code:ENGL 1561Y","srcdb":"202610","sections":[{"crn":"13755"}]},{"group":"code:ENGL 1580","srcdb":"202610","sections":[{"crn":"11720"},{"crn":"11721"}]},{"group":"code:ENGL 1710I","srcdb":"202610","sections":[{"crn":"14018"}]},{"group":"code:ENGL 1710M","srcdb":"202610","sections":[{"crn":"14019"}]},{"group":"code:ENGL 1711S","srcdb":"202610","sections":[{"crn":"14020"}]},{"group":"code:ENGL 1760T","srcdb":"202610","sections":[{"crn":"13815"}]},{"group":"code:ENGL 1761D","srcdb":"202610","sections":[{"crn":"13756"}]},{"group":"code:ENGL 1762P","srcdb":"202610","sections":[{"crn":"15269"}]},{"group":"code:ENGL 1762T","srcdb":"202610","sections":[{"crn":"15003"}]},{"group":"code:ENGL 1762X","srcdb":"202610","sections":[{"crn":"15360"}]},{"group":"code:ENGL 1762Z","srcdb":"202610","sections":[{"crn":"14112"}]},{"group":"code:ENGL 1780","srcdb":"202610","sections":[{"crn":"11722"},{"crn":"11723"},{"crn":"11724"},{"crn":"11725"},{"crn":"11726"},{"crn":"11727"},{"crn":"11728"}]},{"group":"code:ENGL 1901M","srcdb":"202610","sections":[{"crn":"15672"}]},{"group":"code:ENGL 1901N","srcdb":"202610","sections":[{"crn":"15086"}]},{"group":"code:ENGL 1901T","srcdb":"202610","sections":[{"crn":"13948"}]},{"group":"code:ENGL 1910G","srcdb":"202610","sections":[{"crn":"14230"}]},{"group":"code:ENGL 1991","srcdb":"202610","sections":[{"crn":"14887"}]},{"group":"code:ENGL 1993","srcdb":"202610","sections":[{"crn":"13783"}]},{"group":"code:ENGL 2210","srcdb":"202610","sections":[{"crn":"15431"}]},{"group":"code:ENGL 2380","srcdb":"202610","sections":[{"crn":"11729"}]},{"group":"code:ENGL 2580","srcdb":"202610","sections":[{"crn":"11730"},{"crn":"11731"}]},{"group":"code:ENGL 2761T","srcdb":"202610","sections":[{"crn":"15002"}]},{"group":"code:ENGL 2780","srcdb":"202610","sections":[{"crn":"11732"},{"crn":"11733"},{"crn":"11734"},{"crn":"11735"},{"crn":"11736"}]}];
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
