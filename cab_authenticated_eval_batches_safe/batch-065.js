(() => {
  const groups = [{"group":"code:ITAL 2980","srcdb":"202610","sections":[{"crn":"12117"},{"crn":"12118"},{"crn":"12119"},{"crn":"12120"}]},{"group":"code:ITAL 2990","srcdb":"202610","sections":[{"crn":"13340"}]},{"group":"code:JAPN 0100","srcdb":"202610","sections":[{"crn":"10123"},{"crn":"10124"},{"crn":"10125"},{"crn":"10126"},{"crn":"10127"}]},{"group":"code:JAPN 0300","srcdb":"202610","sections":[{"crn":"10128"},{"crn":"10129"},{"crn":"10130"}]},{"group":"code:JAPN 0500","srcdb":"202610","sections":[{"crn":"10131"},{"crn":"10132"}]},{"group":"code:JAPN 0700","srcdb":"202610","sections":[{"crn":"10133"},{"crn":"10134"},{"crn":"13512"}]},{"group":"code:JAPN 0911","srcdb":"202610","sections":[{"crn":"13490"}]},{"group":"code:JUDS 0050H","srcdb":"202610","sections":[{"crn":"13558"}]},{"group":"code:JUDS 0060","srcdb":"202610","sections":[{"crn":"13556"}]},{"group":"code:JUDS 0063A","srcdb":"202610","sections":[{"crn":"16194"}]},{"group":"code:JUDS 0070","srcdb":"202610","sections":[{"crn":"16193"}]},{"group":"code:JUDS 0602","srcdb":"202610","sections":[{"crn":"14262"}]},{"group":"code:JUDS 0830","srcdb":"202610","sections":[{"crn":"13552"}]},{"group":"code:JUDS 0831","srcdb":"202610","sections":[{"crn":"13553"}]},{"group":"code:JUDS 1604","srcdb":"202610","sections":[{"crn":"14264"}]},{"group":"code:JUDS 1630","srcdb":"202610","sections":[{"crn":"13557"}]},{"group":"code:JUDS 1970","srcdb":"202610","sections":[{"crn":"12121"},{"crn":"12122"},{"crn":"12123"},{"crn":"12124"},{"crn":"12125"}]},{"group":"code:JUDS 1980P","srcdb":"202610","sections":[{"crn":"15907"}]},{"group":"code:KREA 0100","srcdb":"202610","sections":[{"crn":"10135"},{"crn":"10136"},{"crn":"10137"}]},{"group":"code:KREA 0250","srcdb":"202610","sections":[{"crn":"10138"}]},{"group":"code:KREA 0300","srcdb":"202610","sections":[{"crn":"10139"},{"crn":"10140"}]},{"group":"code:KREA 0500","srcdb":"202610","sections":[{"crn":"10141"}]},{"group":"code:LACA 1504U","srcdb":"202610","sections":[{"crn":"15501"}]},{"group":"code:LACA 1956F","srcdb":"202610","sections":[{"crn":"15815"}]},{"group":"code:LACA 1990","srcdb":"202610","sections":[{"crn":"12126"},{"crn":"12127"},{"crn":"12128"},{"crn":"12129"},{"crn":"12130"},{"crn":"12131"},{"crn":"12132"},{"crn":"12133"},{"crn":"12134"},{"crn":"12135"},{"crn":"12136"},{"crn":"12137"}]}];
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
