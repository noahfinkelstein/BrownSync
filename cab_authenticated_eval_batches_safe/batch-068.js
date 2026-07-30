(() => {
  const groups = [{"group":"code:LITR 1220L","srcdb":"202610","sections":[{"crn":"15868"}]},{"group":"code:LITR 1231E","srcdb":"202610","sections":[{"crn":"14373"}]},{"group":"code:LITR 1300","srcdb":"202610","sections":[{"crn":"12162"},{"crn":"12163"},{"crn":"12164"},{"crn":"12165"},{"crn":"12166"},{"crn":"12167"},{"crn":"12168"},{"crn":"12169"}]},{"group":"code:LITR 1310","srcdb":"202610","sections":[{"crn":"12170"},{"crn":"12171"},{"crn":"12172"},{"crn":"12173"},{"crn":"12174"},{"crn":"12175"},{"crn":"12176"},{"crn":"12177"},{"crn":"12178"},{"crn":"12179"},{"crn":"12180"}]},{"group":"code:LITR 1510","srcdb":"202610","sections":[{"crn":"12181"},{"crn":"12182"},{"crn":"12183"},{"crn":"12184"},{"crn":"12185"},{"crn":"12186"},{"crn":"12187"},{"crn":"12188"},{"crn":"12189"},{"crn":"12190"},{"crn":"12191"},{"crn":"12192"},{"crn":"12193"},{"crn":"12194"},{"crn":"12195"},{"crn":"12196"},{"crn":"12197"},{"crn":"12198"},{"crn":"12199"},{"crn":"12200"},{"crn":"13459"}]},{"group":"code:LITR 2010A","srcdb":"202610","sections":[{"crn":"13798"}]},{"group":"code:LITR 2010B","srcdb":"202610","sections":[{"crn":"13805"}]},{"group":"code:LITR 2230","srcdb":"202610","sections":[{"crn":"12201"},{"crn":"12202"},{"crn":"12203"},{"crn":"12204"},{"crn":"12205"},{"crn":"12206"},{"crn":"12207"},{"crn":"12208"}]},{"group":"code:LITR 2310","srcdb":"202610","sections":[{"crn":"12209"},{"crn":"12210"},{"crn":"12211"},{"crn":"12212"},{"crn":"12213"},{"crn":"12214"},{"crn":"12215"},{"crn":"12216"},{"crn":"12217"}]},{"group":"code:LITR 2410","srcdb":"202610","sections":[{"crn":"12218"},{"crn":"12219"},{"crn":"12220"},{"crn":"12221"},{"crn":"12222"},{"crn":"12223"},{"crn":"12224"},{"crn":"12225"},{"crn":"12226"},{"crn":"12227"},{"crn":"12228"},{"crn":"12229"},{"crn":"12230"},{"crn":"12231"},{"crn":"12232"},{"crn":"12233"},{"crn":"12234"}]},{"group":"code:LITR 2710","srcdb":"202610","sections":[{"crn":"13799"}]},{"group":"code:LITR 2780","srcdb":"202610","sections":[{"crn":"12235"}]},{"group":"code:MATH 0050","srcdb":"202610","sections":[{"crn":"14426"},{"crn":"14427"}]},{"group":"code:MATH 0081","srcdb":"202610","sections":[{"crn":"14661"}]},{"group":"code:MATH 0090","srcdb":"202610","sections":[{"crn":"14428"},{"crn":"14429"},{"crn":"14430"},{"crn":"14431"},{"crn":"14432"},{"crn":"14433"},{"crn":"14434"},{"crn":"14435"},{"crn":"14436"},{"crn":"14437"},{"crn":"14438"},{"crn":"14439"},{"crn":"14440"},{"crn":"14441"},{"crn":"14442"}]}];
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
