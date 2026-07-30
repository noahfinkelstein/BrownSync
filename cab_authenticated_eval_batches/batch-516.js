(() => {
  const groups = [{"group":"code:EEPS 2920D","srcdb":"202610","sections":[{"crn":"14943"}]},{"group":"code:EEPS 2980","srcdb":"202610","sections":[{"crn":"11663"},{"crn":"11664"},{"crn":"11665"},{"crn":"11666"},{"crn":"11667"},{"crn":"11668"},{"crn":"11669"},{"crn":"11670"},{"crn":"11671"},{"crn":"11672"},{"crn":"11673"},{"crn":"11674"},{"crn":"11675"},{"crn":"11676"},{"crn":"11677"},{"crn":"11678"},{"crn":"11679"},{"crn":"11680"},{"crn":"11681"},{"crn":"11682"},{"crn":"11683"},{"crn":"11684"},{"crn":"11685"},{"crn":"11686"},{"crn":"11687"},{"crn":"11688"},{"crn":"11689"},{"crn":"11690"},{"crn":"11691"},{"crn":"11692"},{"crn":"11693"},{"crn":"11694"},{"crn":"11695"},{"crn":"11696"}]},{"group":"code:EEPS 2990","srcdb":"202610","sections":[{"crn":"13309"}]},{"group":"code:EGYT 1050","srcdb":"202610","sections":[{"crn":"15625"}]}];
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
