(() => {
  const groups = [{"group":"code:CLAS 1240","srcdb":"202610","sections":[{"crn":"14927"}]},{"group":"code:CLAS 1320","srcdb":"202610","sections":[{"crn":"13852"}]},{"group":"code:CLAS 1450","srcdb":"202610","sections":[{"crn":"14237"}]},{"group":"code:CLAS 1520","srcdb":"202610","sections":[{"crn":"15234"}]},{"group":"code:CLAS 1970","srcdb":"202610","sections":[{"crn":"11019"},{"crn":"11020"},{"crn":"11021"},{"crn":"11022"},{"crn":"11023"},{"crn":"11024"}]},{"group":"code:CLAS 1990","srcdb":"202610","sections":[{"crn":"11025"},{"crn":"11026"},{"crn":"11027"},{"crn":"11028"},{"crn":"11029"},{"crn":"11030"},{"crn":"11031"},{"crn":"11032"},{"crn":"11033"},{"crn":"11034"},{"crn":"13711"},{"crn":"14399"}]},{"group":"code:CLAS 2011","srcdb":"202610","sections":[{"crn":"13853"}]},{"group":"code:CLAS 2970","srcdb":"202610","sections":[{"crn":"13293"}]},{"group":"code:CLAS 2980","srcdb":"202610","sections":[{"crn":"11035"},{"crn":"11036"},{"crn":"11037"}]},{"group":"code:CLAS 2990","srcdb":"202610","sections":[{"crn":"13294"}]},{"group":"code:COLT 0610C","srcdb":"202610","sections":[{"crn":"14904"}]},{"group":"code:COLT 0610L","srcdb":"202610","sections":[{"crn":"14302"}]},{"group":"code:COLT 0710Q","srcdb":"202610","sections":[{"crn":"15255"}]},{"group":"code:COLT 0711W","srcdb":"202610","sections":[{"crn":"15937"}]},{"group":"code:COLT 0711Z","srcdb":"202610","sections":[{"crn":"16370"}]},{"group":"code:COLT 1310Z","srcdb":"202610","sections":[{"crn":"15251"}]},{"group":"code:COLT 1421V","srcdb":"202610","sections":[{"crn":"15184"},{"crn":"15354"}]},{"group":"code:COLT 1431J","srcdb":"202610","sections":[{"crn":"15707"}]},{"group":"code:COLT 1431L","srcdb":"202610","sections":[{"crn":"15445"}]},{"group":"code:COLT 1431N","srcdb":"202610","sections":[{"crn":"15102"}]},{"group":"code:COLT 1710A","srcdb":"202610","sections":[{"crn":"15252"}]},{"group":"code:COLT 1814S","srcdb":"202610","sections":[{"crn":"15275"}]},{"group":"code:COLT 1970","srcdb":"202610","sections":[{"crn":"11038"},{"crn":"11039"},{"crn":"11040"},{"crn":"11041"},{"crn":"11042"},{"crn":"11043"},{"crn":"11044"},{"crn":"11045"},{"crn":"11046"},{"crn":"11047"},{"crn":"11048"},{"crn":"11049"},{"crn":"11050"},{"crn":"11051"}]},{"group":"code:COLT 1990","srcdb":"202610","sections":[{"crn":"11052"},{"crn":"11053"},{"crn":"11054"},{"crn":"11055"},{"crn":"11056"},{"crn":"11057"},{"crn":"11058"},{"crn":"11059"},{"crn":"11060"},{"crn":"11061"},{"crn":"11062"},{"crn":"11063"},{"crn":"11064"},{"crn":"11065"},{"crn":"11066"},{"crn":"11067"},{"crn":"16130"},{"crn":"16131"},{"crn":"16132"},{"crn":"16133"},{"crn":"16134"},{"crn":"16135"},{"crn":"16136"},{"crn":"16161"},{"crn":"16162"},{"crn":"16163"},{"crn":"16164"},{"crn":"16165"},{"crn":"16166"}]},{"group":"code:COLT 2540P","srcdb":"202610","sections":[{"crn":"15101"}]}];
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
