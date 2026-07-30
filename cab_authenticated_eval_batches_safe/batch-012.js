(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10624"},{"crn":"10625"},{"crn":"10626"},{"crn":"10627"},{"crn":"10628"},{"crn":"10629"},{"crn":"10630"},{"crn":"10631"},{"crn":"10632"},{"crn":"10633"},{"crn":"10634"},{"crn":"10635"},{"crn":"10636"},{"crn":"10637"},{"crn":"10638"},{"crn":"10639"},{"crn":"10640"},{"crn":"10641"},{"crn":"10642"},{"crn":"10643"},{"crn":"10644"},{"crn":"10645"},{"crn":"10646"},{"crn":"10647"},{"crn":"10648"},{"crn":"10649"},{"crn":"10650"},{"crn":"10651"},{"crn":"10652"},{"crn":"10653"},{"crn":"10654"},{"crn":"10655"},{"crn":"10656"},{"crn":"10657"},{"crn":"10658"},{"crn":"10659"},{"crn":"10660"},{"crn":"10661"},{"crn":"10662"},{"crn":"10663"},{"crn":"10664"},{"crn":"10665"},{"crn":"10666"},{"crn":"10667"},{"crn":"10668"},{"crn":"10669"},{"crn":"10670"},{"crn":"10671"},{"crn":"10672"},{"crn":"10673"}]}];
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
