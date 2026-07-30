(() => {
  const groups = [{"group":"code:BIOL 2980","srcdb":"202610","sections":[{"crn":"10895"},{"crn":"10896"},{"crn":"10897"},{"crn":"10898"},{"crn":"10899"},{"crn":"10900"},{"crn":"10901"},{"crn":"10902"},{"crn":"10903"},{"crn":"10904"},{"crn":"10905"},{"crn":"10906"},{"crn":"10907"},{"crn":"10908"},{"crn":"10909"},{"crn":"10910"},{"crn":"10911"},{"crn":"10912"},{"crn":"10913"},{"crn":"10914"},{"crn":"10915"},{"crn":"10916"},{"crn":"10917"},{"crn":"10918"},{"crn":"10919"},{"crn":"10920"},{"crn":"10921"},{"crn":"10922"},{"crn":"10923"},{"crn":"10924"},{"crn":"10925"},{"crn":"10926"},{"crn":"10927"},{"crn":"10928"},{"crn":"10929"},{"crn":"10930"},{"crn":"10931"},{"crn":"10932"},{"crn":"10933"},{"crn":"10934"},{"crn":"10935"},{"crn":"10936"},{"crn":"10937"},{"crn":"10938"},{"crn":"10939"},{"crn":"10940"},{"crn":"10941"},{"crn":"10942"},{"crn":"10943"},{"crn":"10944"}]}];
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
