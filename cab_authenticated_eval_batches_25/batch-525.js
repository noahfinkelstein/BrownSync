(() => {
  const groups = [{"group":"code:EGYT 2970","srcdb":"202610","sections":[{"crn":"13311"}]},{"group":"code:EGYT 2980","srcdb":"202610","sections":[{"crn":"11705"},{"crn":"11706"},{"crn":"13482"}]},{"group":"code:EGYT 2990","srcdb":"202610","sections":[{"crn":"13312"}]},{"group":"code:EINT 2300","srcdb":"202610","sections":[{"crn":"13443"}]},{"group":"code:EINT 2400","srcdb":"202610","sections":[{"crn":"13560"},{"crn":"13561"}]},{"group":"code:EINT 2500","srcdb":"202610","sections":[{"crn":"13566"}]},{"group":"code:EMOW 0202S","srcdb":"202610","sections":[{"crn":"16116"}]},{"group":"code:EMOW 0202U","srcdb":"202610","sections":[{"crn":"16117"}]},{"group":"code:EMOW 0300R","srcdb":"202610","sections":[{"crn":"16118"}]},{"group":"code:EMOW 1120G","srcdb":"202610","sections":[{"crn":"16110"}]},{"group":"code:EMOW 1152","srcdb":"202610","sections":[{"crn":"16120"}]},{"group":"code:EMOW 1240P","srcdb":"202610","sections":[{"crn":"16119"}]},{"group":"code:EMOW 1262M","srcdb":"202610","sections":[{"crn":"16109"}]},{"group":"code:EMOW 1266C","srcdb":"202610","sections":[{"crn":"16111"}]},{"group":"code:EMOW 1964A","srcdb":"202610","sections":[{"crn":"16108"}]},{"group":"code:EMOW 1964I","srcdb":"202610","sections":[{"crn":"16112"}]},{"group":"code:EMOW 1980","srcdb":"202610","sections":[{"crn":"14391"}]},{"group":"code:ENGL 0100F","srcdb":"202610","sections":[{"crn":"14888"},{"crn":"15648"},{"crn":"15649"},{"crn":"16304"}]},{"group":"code:ENGL 0100P","srcdb":"202610","sections":[{"crn":"13774"},{"crn":"15650"},{"crn":"15651"}]},{"group":"code:ENGL 0101J","srcdb":"202610","sections":[{"crn":"14064"},{"crn":"15652"},{"crn":"15653"}]},{"group":"code:ENGL 0202R","srcdb":"202610","sections":[{"crn":"15656"}]},{"group":"code:ENGL 0202S","srcdb":"202610","sections":[{"crn":"15657"}]},{"group":"code:ENGL 0202U","srcdb":"202610","sections":[{"crn":"15658"}]},{"group":"code:ENGL 0202X","srcdb":"202610","sections":[{"crn":"15659"}]},{"group":"code:ENGL 0300R","srcdb":"202610","sections":[{"crn":"15677"}]}];
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
