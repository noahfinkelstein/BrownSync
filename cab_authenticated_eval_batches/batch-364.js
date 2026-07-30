(() => {
  const groups = [{"group":"code:CSCI 1952A","srcdb":"202610","sections":[{"crn":"15957"}]},{"group":"code:CSCI 1953A","srcdb":"202610","sections":[{"crn":"14273"}]},{"group":"code:CSCI 1953C","srcdb":"202610","sections":[{"crn":"16235"}]},{"group":"code:CSCI 1970","srcdb":"202610","sections":[{"crn":"11294"},{"crn":"11295"},{"crn":"11296"},{"crn":"11297"},{"crn":"11298"},{"crn":"11299"},{"crn":"11300"},{"crn":"11301"},{"crn":"11302"},{"crn":"11303"},{"crn":"11304"},{"crn":"11305"},{"crn":"11306"},{"crn":"11307"},{"crn":"11308"},{"crn":"11309"},{"crn":"11310"},{"crn":"11311"},{"crn":"11312"},{"crn":"11313"},{"crn":"11314"},{"crn":"11315"},{"crn":"11316"},{"crn":"11317"},{"crn":"11318"},{"crn":"11319"},{"crn":"11320"},{"crn":"11321"},{"crn":"11322"},{"crn":"11323"},{"crn":"11324"},{"crn":"11325"},{"crn":"11326"},{"crn":"11327"},{"crn":"11328"},{"crn":"11329"},{"crn":"11330"},{"crn":"11331"},{"crn":"11332"},{"crn":"11333"},{"crn":"11334"},{"crn":"11335"},{"crn":"11336"},{"crn":"11337"},{"crn":"11338"},{"crn":"11339"},{"crn":"11340"},{"crn":"11341"},{"crn":"11342"},{"crn":"11343"},{"crn":"11344"},{"crn":"11345"},{"crn":"11346"},{"crn":"11347"},{"crn":"11348"},{"crn":"11349"},{"crn":"11350"},{"crn":"11351"},{"crn":"11352"},{"crn":"11353"},{"crn":"11354"},{"crn":"11355"},{"crn":"11356"},{"crn":"11357"},{"crn":"11358"},{"crn":"11359"},{"crn":"11360"},{"crn":"11361"},{"crn":"11362"},{"crn":"11363"},{"crn":"11364"},{"crn":"11365"},{"crn":"11366"}]}];
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
