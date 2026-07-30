(() => {
  const groups = [{"group":"code:PHIL 0992A","srcdb":"202610","sections":[{"crn":"13637"}]},{"group":"code:PHIL 1130","srcdb":"202610","sections":[{"crn":"14413"}]},{"group":"code:PHIL 1430","srcdb":"202610","sections":[{"crn":"13704"}]},{"group":"code:PHIL 1470","srcdb":"202610","sections":[{"crn":"13706"}]},{"group":"code:PHIL 1540","srcdb":"202610","sections":[{"crn":"16160"}]},{"group":"code:PHIL 1592","srcdb":"202610","sections":[{"crn":"13638"}]},{"group":"code:PHIL 1630","srcdb":"202610","sections":[{"crn":"13708"}]},{"group":"code:PHIL 1770","srcdb":"202610","sections":[{"crn":"13647"}]},{"group":"code:PHIL 1835","srcdb":"202610","sections":[{"crn":"13772"}]},{"group":"code:PHIL 1845","srcdb":"202610","sections":[{"crn":"14640"}]},{"group":"code:PHIL 1990","srcdb":"202610","sections":[{"crn":"12484"},{"crn":"12485"},{"crn":"12486"},{"crn":"12487"},{"crn":"12488"},{"crn":"12489"},{"crn":"12490"},{"crn":"12491"},{"crn":"12492"},{"crn":"12493"},{"crn":"12494"},{"crn":"14394"},{"crn":"14517"},{"crn":"14898"}]},{"group":"code:PHIL 1995","srcdb":"202610","sections":[{"crn":"12495"},{"crn":"12496"},{"crn":"12497"},{"crn":"12498"},{"crn":"12499"},{"crn":"12500"},{"crn":"12501"},{"crn":"12502"},{"crn":"12503"},{"crn":"12504"},{"crn":"12505"},{"crn":"12506"},{"crn":"12507"},{"crn":"14388"},{"crn":"14389"}]},{"group":"code:PHIL 2000","srcdb":"202610","sections":[{"crn":"13709"}]},{"group":"code:PHIL 2020","srcdb":"202610","sections":[{"crn":"13710"}]},{"group":"code:PHIL 2142","srcdb":"202610","sections":[{"crn":"13695"}]},{"group":"code:PHIL 2520","srcdb":"202610","sections":[{"crn":"14641"}]},{"group":"code:PHIL 2530","srcdb":"202610","sections":[{"crn":"14176"}]},{"group":"code:PHIL 2720","srcdb":"202610","sections":[{"crn":"13775"}]},{"group":"code:PHIL 2970","srcdb":"202610","sections":[{"crn":"13358"}]},{"group":"code:PHIL 2980","srcdb":"202610","sections":[{"crn":"12508"},{"crn":"12509"},{"crn":"12510"},{"crn":"12511"},{"crn":"12512"},{"crn":"12513"},{"crn":"12514"},{"crn":"12515"},{"crn":"12516"},{"crn":"12517"},{"crn":"12518"},{"crn":"14516"}]},{"group":"code:PHIL 2990","srcdb":"202610","sections":[{"crn":"13359"}]},{"group":"code:PHIL XLIST","srcdb":"202610","sections":[{"crn":"15963"}]},{"group":"code:PHP 0060","srcdb":"202610","sections":[{"crn":"14067"}]},{"group":"code:PHP 0080","srcdb":"202610","sections":[{"crn":"15396"}]},{"group":"code:PHP 0090","srcdb":"202610","sections":[{"crn":"16276"}]}];
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
