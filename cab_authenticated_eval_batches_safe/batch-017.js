(() => {
  const groups = [{"group":"code:BIOL 1970A","srcdb":"202610","sections":[{"crn":"10096"},{"crn":"14872"}]},{"group":"code:BIOL 2010A","srcdb":"202610","sections":[{"crn":"10097"},{"crn":"14873"}]},{"group":"code:BIOL 2020","srcdb":"202610","sections":[{"crn":"10061"},{"crn":"14875"}]},{"group":"code:BIOL 2024","srcdb":"202610","sections":[{"crn":"10062"},{"crn":"14876"}]},{"group":"code:BIOL 2030","srcdb":"202610","sections":[{"crn":"10098"},{"crn":"14877"}]},{"group":"code:BIOL 2050","srcdb":"202610","sections":[{"crn":"10059"},{"crn":"14571"},{"crn":"14867"}]},{"group":"code:BIOL 2089","srcdb":"202610","sections":[{"crn":"10064"},{"crn":"14878"}]},{"group":"code:BIOL 2110","srcdb":"202610","sections":[{"crn":"10104"},{"crn":"14879"}]},{"group":"code:BIOL 2115","srcdb":"202610","sections":[{"crn":"14999"}]},{"group":"code:BIOL 2150","srcdb":"202610","sections":[{"crn":"10099"},{"crn":"10100"},{"crn":"14158"},{"crn":"14880"}]},{"group":"code:BIOL 2180","srcdb":"202610","sections":[{"crn":"10063"}]},{"group":"code:BIOL 2220","srcdb":"202610","sections":[{"crn":"10056"},{"crn":"14853"}]},{"group":"code:BIOL 2230","srcdb":"202610","sections":[{"crn":"10105"},{"crn":"14881"}]},{"group":"code:BIOL 2250","srcdb":"202610","sections":[{"crn":"10103"},{"crn":"14883"}]},{"group":"code:BIOL 2260","srcdb":"202610","sections":[{"crn":"10089"},{"crn":"14856"}]},{"group":"code:BIOL 2270","srcdb":"202610","sections":[{"crn":"10091"},{"crn":"14858"}]},{"group":"code:BIOL 2300","srcdb":"202610","sections":[{"crn":"10093"},{"crn":"14860"}]},{"group":"code:BIOL 2310","srcdb":"202610","sections":[{"crn":"10095"},{"crn":"14882"}]},{"group":"code:BIOL 2370","srcdb":"202610","sections":[{"crn":"13574"}]},{"group":"code:BIOL 2400","srcdb":"202610","sections":[{"crn":"10843"}]},{"group":"code:BIOL 2430","srcdb":"202610","sections":[{"crn":"14324"}]},{"group":"code:BIOL 2460","srcdb":"202610","sections":[{"crn":"10844"}]},{"group":"code:BIOL 2520","srcdb":"202610","sections":[{"crn":"14664"}]},{"group":"code:BIOL 2535","srcdb":"202610","sections":[{"crn":"15683"}]},{"group":"code:BIOL 2560","srcdb":"202610","sections":[{"crn":"14862"}]}];
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
