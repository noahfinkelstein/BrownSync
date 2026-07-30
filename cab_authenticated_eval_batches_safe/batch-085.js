(() => {
  const groups = [{"group":"code:PHP 2980","srcdb":"202610","sections":[{"crn":"12649"},{"crn":"12650"},{"crn":"12651"},{"crn":"12652"},{"crn":"12653"},{"crn":"12654"},{"crn":"12655"},{"crn":"12656"},{"crn":"12657"},{"crn":"12658"},{"crn":"12659"},{"crn":"12660"},{"crn":"12661"},{"crn":"12662"},{"crn":"12663"},{"crn":"12664"},{"crn":"12665"},{"crn":"12666"},{"crn":"12667"},{"crn":"12668"},{"crn":"12669"},{"crn":"12670"},{"crn":"12671"},{"crn":"12672"},{"crn":"12673"},{"crn":"12674"},{"crn":"12675"},{"crn":"12676"},{"crn":"12677"},{"crn":"12678"},{"crn":"12679"},{"crn":"12680"},{"crn":"12681"},{"crn":"12682"},{"crn":"12683"},{"crn":"12684"},{"crn":"12685"},{"crn":"12686"},{"crn":"12687"},{"crn":"12688"},{"crn":"12689"},{"crn":"12690"},{"crn":"12691"},{"crn":"12692"},{"crn":"12693"},{"crn":"12694"},{"crn":"12695"},{"crn":"12696"},{"crn":"12697"},{"crn":"12698"}]}];
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
