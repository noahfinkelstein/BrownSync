(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10724"},{"crn":"10725"},{"crn":"10726"},{"crn":"10727"},{"crn":"10728"},{"crn":"10729"},{"crn":"10730"},{"crn":"10731"},{"crn":"10732"},{"crn":"10733"},{"crn":"10734"},{"crn":"10735"},{"crn":"10736"},{"crn":"10737"},{"crn":"10738"},{"crn":"10739"},{"crn":"10740"},{"crn":"10741"},{"crn":"10742"},{"crn":"10743"},{"crn":"10744"},{"crn":"10745"},{"crn":"10746"},{"crn":"10747"},{"crn":"10748"},{"crn":"10749"},{"crn":"10750"},{"crn":"10751"},{"crn":"10752"},{"crn":"10753"},{"crn":"10754"},{"crn":"10755"},{"crn":"10756"},{"crn":"10757"},{"crn":"10758"},{"crn":"10759"},{"crn":"10760"},{"crn":"10761"},{"crn":"10762"},{"crn":"10763"},{"crn":"10764"},{"crn":"10765"},{"crn":"10766"},{"crn":"10767"},{"crn":"10768"},{"crn":"10769"},{"crn":"10770"},{"crn":"10771"},{"crn":"10772"},{"crn":"10773"}]}];
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
