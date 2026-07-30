(() => {
  const groups = [{"group":"code:BIOL 2980","srcdb":"202610","sections":[{"crn":"10845"},{"crn":"10846"},{"crn":"10847"},{"crn":"10848"},{"crn":"10849"},{"crn":"10850"},{"crn":"10851"},{"crn":"10852"},{"crn":"10853"},{"crn":"10854"},{"crn":"10855"},{"crn":"10856"},{"crn":"10857"},{"crn":"10858"},{"crn":"10859"},{"crn":"10860"},{"crn":"10861"},{"crn":"10862"},{"crn":"10863"},{"crn":"10864"},{"crn":"10865"},{"crn":"10866"},{"crn":"10867"},{"crn":"10868"},{"crn":"10869"},{"crn":"10870"},{"crn":"10871"},{"crn":"10872"},{"crn":"10873"},{"crn":"10874"},{"crn":"10875"},{"crn":"10876"},{"crn":"10877"},{"crn":"10878"},{"crn":"10879"},{"crn":"10880"},{"crn":"10881"},{"crn":"10882"},{"crn":"10883"},{"crn":"10884"},{"crn":"10885"},{"crn":"10886"},{"crn":"10887"},{"crn":"10888"},{"crn":"10889"},{"crn":"10890"},{"crn":"10891"},{"crn":"10892"},{"crn":"10893"},{"crn":"10894"}]}];
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
