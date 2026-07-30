(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10524"},{"crn":"10525"},{"crn":"10526"},{"crn":"10527"},{"crn":"10528"},{"crn":"10529"},{"crn":"10530"},{"crn":"10531"},{"crn":"10532"},{"crn":"10533"},{"crn":"10534"},{"crn":"10535"},{"crn":"10536"},{"crn":"10537"},{"crn":"10538"},{"crn":"10539"},{"crn":"10540"},{"crn":"10541"},{"crn":"10542"},{"crn":"10543"},{"crn":"10544"},{"crn":"10545"},{"crn":"10546"},{"crn":"10547"},{"crn":"10548"},{"crn":"10549"},{"crn":"10550"},{"crn":"10551"},{"crn":"10552"},{"crn":"10553"},{"crn":"10554"},{"crn":"10555"},{"crn":"10556"},{"crn":"10557"},{"crn":"10558"},{"crn":"10559"},{"crn":"10560"},{"crn":"10561"},{"crn":"10562"},{"crn":"10563"},{"crn":"10564"},{"crn":"10565"},{"crn":"10566"},{"crn":"10567"},{"crn":"10568"},{"crn":"10569"},{"crn":"10570"},{"crn":"10571"},{"crn":"10572"},{"crn":"10573"}]}];
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
