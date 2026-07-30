(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10674"},{"crn":"10675"},{"crn":"10676"},{"crn":"10677"},{"crn":"10678"},{"crn":"10679"},{"crn":"10680"},{"crn":"10681"},{"crn":"10682"},{"crn":"10683"},{"crn":"10684"},{"crn":"10685"},{"crn":"10686"},{"crn":"10687"},{"crn":"10688"},{"crn":"10689"},{"crn":"10690"},{"crn":"10691"},{"crn":"10692"},{"crn":"10693"},{"crn":"10694"},{"crn":"10695"},{"crn":"10696"},{"crn":"10697"},{"crn":"10698"},{"crn":"10699"},{"crn":"10700"},{"crn":"10701"},{"crn":"10702"},{"crn":"10703"},{"crn":"10704"},{"crn":"10705"},{"crn":"10706"},{"crn":"10707"},{"crn":"10708"},{"crn":"10709"},{"crn":"10710"},{"crn":"10711"},{"crn":"10712"},{"crn":"10713"},{"crn":"10714"},{"crn":"10715"},{"crn":"10716"},{"crn":"10717"},{"crn":"10718"},{"crn":"10719"},{"crn":"10720"},{"crn":"10721"},{"crn":"10722"},{"crn":"10723"}]}];
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
