(() => {
  const groups = [{"group":"code:MCM 1980","srcdb":"202610","sections":[{"crn":"12272"},{"crn":"12273"},{"crn":"12274"},{"crn":"12275"},{"crn":"12276"},{"crn":"12277"},{"crn":"12278"},{"crn":"12279"},{"crn":"12280"},{"crn":"12281"},{"crn":"12282"},{"crn":"12283"},{"crn":"12284"},{"crn":"12285"},{"crn":"12286"},{"crn":"12287"},{"crn":"12288"},{"crn":"12289"},{"crn":"12290"},{"crn":"12291"},{"crn":"12292"},{"crn":"12293"},{"crn":"12294"},{"crn":"12295"},{"crn":"16326"},{"crn":"16329"}]},{"group":"code:MCM 1990","srcdb":"202610","sections":[{"crn":"12296"},{"crn":"12297"},{"crn":"12298"},{"crn":"12299"},{"crn":"12300"},{"crn":"12301"},{"crn":"12302"},{"crn":"12303"},{"crn":"12304"},{"crn":"12305"},{"crn":"12306"},{"crn":"12307"},{"crn":"12308"},{"crn":"12309"},{"crn":"12310"},{"crn":"12311"},{"crn":"12312"},{"crn":"12313"},{"crn":"12314"},{"crn":"12315"},{"crn":"12316"},{"crn":"12317"},{"crn":"12318"},{"crn":"16072"},{"crn":"16327"},{"crn":"16328"}]},{"group":"code:MCM 2100O","srcdb":"202610","sections":[{"crn":"15402"}]},{"group":"code:MCM 2300K","srcdb":"202610","sections":[{"crn":"16341"}]}];
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
