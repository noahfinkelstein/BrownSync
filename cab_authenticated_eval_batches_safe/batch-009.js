(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10474"},{"crn":"10475"},{"crn":"10476"},{"crn":"10477"},{"crn":"10478"},{"crn":"10479"},{"crn":"10480"},{"crn":"10481"},{"crn":"10482"},{"crn":"10483"},{"crn":"10484"},{"crn":"10485"},{"crn":"10486"},{"crn":"10487"},{"crn":"10488"},{"crn":"10489"},{"crn":"10490"},{"crn":"10491"},{"crn":"10492"},{"crn":"10493"},{"crn":"10494"},{"crn":"10495"},{"crn":"10496"},{"crn":"10497"},{"crn":"10498"},{"crn":"10499"},{"crn":"10500"},{"crn":"10501"},{"crn":"10502"},{"crn":"10503"},{"crn":"10504"},{"crn":"10505"},{"crn":"10506"},{"crn":"10507"},{"crn":"10508"},{"crn":"10509"},{"crn":"10510"},{"crn":"10511"},{"crn":"10512"},{"crn":"10513"},{"crn":"10514"},{"crn":"10515"},{"crn":"10516"},{"crn":"10517"},{"crn":"10518"},{"crn":"10519"},{"crn":"10520"},{"crn":"10521"},{"crn":"10522"},{"crn":"10523"}]}];
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
