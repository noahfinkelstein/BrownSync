(() => {
  const groups = [{"group":"code:EAST 1980","srcdb":"202610","sections":[{"crn":"11528"},{"crn":"11529"},{"crn":"11530"},{"crn":"11531"},{"crn":"11532"},{"crn":"11533"},{"crn":"11534"},{"crn":"11535"},{"crn":"11536"},{"crn":"11537"},{"crn":"11538"},{"crn":"11539"},{"crn":"11540"}]},{"group":"code:ECON 0110","srcdb":"202610","sections":[{"crn":"14197"},{"crn":"14198"},{"crn":"14199"},{"crn":"14200"},{"crn":"14201"},{"crn":"14202"},{"crn":"14203"},{"crn":"14204"},{"crn":"14205"},{"crn":"14206"},{"crn":"14207"},{"crn":"14208"},{"crn":"14209"},{"crn":"14210"},{"crn":"14211"},{"crn":"14212"},{"crn":"14213"},{"crn":"14214"},{"crn":"14215"},{"crn":"14216"},{"crn":"14217"}]},{"group":"code:ECON 0170","srcdb":"202610","sections":[{"crn":"14951"}]},{"group":"code:ECON 0710","srcdb":"202610","sections":[{"crn":"14422"},{"crn":"14950"}]}];
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
