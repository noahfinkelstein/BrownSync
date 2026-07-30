(() => {
  const groups = [{"group":"code:ECON 2970","srcdb":"202610","sections":[{"crn":"14127"}]},{"group":"code:ECON 2980","srcdb":"202610","sections":[{"crn":"11559"},{"crn":"11560"},{"crn":"11561"},{"crn":"11562"},{"crn":"11563"},{"crn":"11564"},{"crn":"11565"},{"crn":"11566"},{"crn":"11567"},{"crn":"11568"},{"crn":"11569"},{"crn":"11570"},{"crn":"11571"},{"crn":"11572"},{"crn":"11573"},{"crn":"11574"},{"crn":"11575"}]},{"group":"code:ECON 2990","srcdb":"202610","sections":[{"crn":"13307"}]},{"group":"code:EDUC 0425","srcdb":"202610","sections":[{"crn":"13603"}]},{"group":"code:EDUC 0530","srcdb":"202610","sections":[{"crn":"13595"}]},{"group":"code:EDUC 0560","srcdb":"202610","sections":[{"crn":"13591"}]},{"group":"code:EDUC 0750","srcdb":"202610","sections":[{"crn":"13412"}]},{"group":"code:EDUC 0800","srcdb":"202610","sections":[{"crn":"13413"}]},{"group":"code:EDUC 0845","srcdb":"202610","sections":[{"crn":"16244"}]},{"group":"code:EDUC 0880","srcdb":"202610","sections":[{"crn":"14750"}]},{"group":"code:EDUC 1310","srcdb":"202610","sections":[{"crn":"15704"}]},{"group":"code:EDUC 1320","srcdb":"202610","sections":[{"crn":"13418"}]},{"group":"code:EDUC 1330","srcdb":"202610","sections":[{"crn":"15705"}]},{"group":"code:EDUC 1485","srcdb":"202610","sections":[{"crn":"16234"}]},{"group":"code:EDUC 1655","srcdb":"202610","sections":[{"crn":"13625"}]},{"group":"code:EDUC 1900","srcdb":"202610","sections":[{"crn":"13414"}]},{"group":"code:EDUC 1970","srcdb":"202610","sections":[{"crn":"11576"},{"crn":"11577"},{"crn":"11578"},{"crn":"11579"},{"crn":"11580"},{"crn":"11581"},{"crn":"11582"},{"crn":"11583"},{"crn":"11584"},{"crn":"11585"},{"crn":"11586"},{"crn":"11587"},{"crn":"11588"},{"crn":"11589"}]},{"group":"code:EDUC 1991","srcdb":"202610","sections":[{"crn":"11590"},{"crn":"11591"},{"crn":"11592"},{"crn":"11593"},{"crn":"11594"},{"crn":"11595"},{"crn":"11596"},{"crn":"11597"},{"crn":"13565"}]},{"group":"code:EDUC 2360","srcdb":"202610","sections":[{"crn":"13602"},{"crn":"16089"}]},{"group":"code:EDUC 2367","srcdb":"202610","sections":[{"crn":"13604"}]},{"group":"code:EDUC 2385","srcdb":"202610","sections":[{"crn":"13430"}]},{"group":"code:EDUC 2515","srcdb":"202610","sections":[{"crn":"13610"}]},{"group":"code:EDUC 2520A","srcdb":"202610","sections":[{"crn":"13597"}]},{"group":"code:EDUC 2520B","srcdb":"202610","sections":[{"crn":"13598"}]},{"group":"code:EDUC 2520C","srcdb":"202610","sections":[{"crn":"13599"}]}];
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
