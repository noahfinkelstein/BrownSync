(() => {
  const groups = [{"group":"code:LACA 1994","srcdb":"202610","sections":[{"crn":"12138"},{"crn":"12139"}]},{"group":"code:LANG 0800","srcdb":"202610","sections":[{"crn":"13446"}]},{"group":"code:LANG 1800","srcdb":"202610","sections":[{"crn":"13447"}]},{"group":"code:LANG 1900","srcdb":"202610","sections":[{"crn":"12140"},{"crn":"12141"},{"crn":"12142"},{"crn":"12143"}]},{"group":"code:LATN 0100","srcdb":"202610","sections":[{"crn":"13859"}]},{"group":"code:LATN 0300","srcdb":"202610","sections":[{"crn":"13860"}]},{"group":"code:LATN 1060E","srcdb":"202610","sections":[{"crn":"13861"}]},{"group":"code:LATN 1110S","srcdb":"202610","sections":[{"crn":"13862"}]},{"group":"code:LATN 1120G","srcdb":"202610","sections":[{"crn":"13863"}]},{"group":"code:LATN 1820","srcdb":"202610","sections":[{"crn":"14008"}]},{"group":"code:LATN 1970","srcdb":"202610","sections":[{"crn":"12144"},{"crn":"12145"},{"crn":"12146"},{"crn":"12147"},{"crn":"12148"},{"crn":"12149"}]},{"group":"code:LATN 1990","srcdb":"202610","sections":[{"crn":"12150"},{"crn":"12151"},{"crn":"12152"},{"crn":"12153"},{"crn":"12154"}]},{"group":"code:LATN 2030B","srcdb":"202610","sections":[{"crn":"15733"}]},{"group":"code:LATN 2120A","srcdb":"202610","sections":[{"crn":"13865"}]},{"group":"code:LATN 2970","srcdb":"202610","sections":[{"crn":"13341"}]},{"group":"code:LATN 2980","srcdb":"202610","sections":[{"crn":"12155"},{"crn":"12156"}]},{"group":"code:LATN 2990","srcdb":"202610","sections":[{"crn":"13342"}]},{"group":"code:LING 0100","srcdb":"202610","sections":[{"crn":"14645"}]},{"group":"code:LING 0131","srcdb":"202610","sections":[{"crn":"14650"}]},{"group":"code:LING 0580","srcdb":"202610","sections":[{"crn":"14646"}]},{"group":"code:LING 1081","srcdb":"202610","sections":[{"crn":"14838"}]},{"group":"code:LING 1160","srcdb":"202610","sections":[{"crn":"14932"}]},{"group":"code:LING 1410","srcdb":"202610","sections":[{"crn":"14652"}]},{"group":"code:LING 1615","srcdb":"202610","sections":[{"crn":"14653"}]},{"group":"code:LING 1870","srcdb":"202610","sections":[{"crn":"14651"}]}];
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
