(() => {
  const groups = [{"group":"code:BIOL 0220","srcdb":"202610","sections":[{"crn":"10083"},{"crn":"14864"}]},{"group":"code:BIOL 0380","srcdb":"202610","sections":[{"crn":"14326"}]},{"group":"code:BIOL 0410","srcdb":"202610","sections":[{"crn":"14327"},{"crn":"14328"}]},{"group":"code:BIOL 0445","srcdb":"202610","sections":[{"crn":"16240"}]},{"group":"code:BIOL 0470","srcdb":"202610","sections":[{"crn":"10084"},{"crn":"10085"},{"crn":"14874"}]},{"group":"code:BIOL 0480","srcdb":"202610","sections":[{"crn":"14329"}]},{"group":"code:BIOL 0530","srcdb":"202610","sections":[{"crn":"10107"},{"crn":"13536"},{"crn":"13537"},{"crn":"13538"},{"crn":"13539"},{"crn":"13540"},{"crn":"13541"},{"crn":"13542"},{"crn":"13543"},{"crn":"13544"},{"crn":"13545"},{"crn":"13546"},{"crn":"13547"},{"crn":"14848"}]},{"group":"code:BIOL 0940A","srcdb":"202610","sections":[{"crn":"10086"},{"crn":"14849"}]},{"group":"code:BIOL 0940D","srcdb":"202610","sections":[{"crn":"10101"},{"crn":"14865"}]},{"group":"code:BIOL 0946","srcdb":"202610","sections":[{"crn":"13575"}]},{"group":"code:BIOL 1050","srcdb":"202610","sections":[{"crn":"10058"},{"crn":"14570"},{"crn":"14866"}]},{"group":"code:BIOL 1070","srcdb":"202610","sections":[{"crn":"10060"},{"crn":"14850"}]},{"group":"code:BIOL 1100","srcdb":"202610","sections":[{"crn":"10102"},{"crn":"14839"}]},{"group":"code:BIOL 1110","srcdb":"202610","sections":[{"crn":"10055"},{"crn":"14852"}]},{"group":"code:BIOL 1140","srcdb":"202610","sections":[{"crn":"10077"},{"crn":"14868"}]},{"group":"code:BIOL 1260","srcdb":"202610","sections":[{"crn":"10087"},{"crn":"10088"},{"crn":"14854"}]},{"group":"code:BIOL 1270","srcdb":"202610","sections":[{"crn":"10090"},{"crn":"14857"}]},{"group":"code:BIOL 1290","srcdb":"202610","sections":[{"crn":"14572"}]},{"group":"code:BIOL 1300","srcdb":"202610","sections":[{"crn":"10092"},{"crn":"14859"}]},{"group":"code:BIOL 1310","srcdb":"202610","sections":[{"crn":"10094"},{"crn":"13529"},{"crn":"14869"}]},{"group":"code:BIOL 1470","srcdb":"202610","sections":[{"crn":"14323"}]},{"group":"code:BIOL 1535","srcdb":"202610","sections":[{"crn":"13612"}]},{"group":"code:BIOL 1560","srcdb":"202610","sections":[{"crn":"10109"},{"crn":"14861"}]},{"group":"code:BIOL 1575","srcdb":"202610","sections":[{"crn":"13614"}]},{"group":"code:BIOL 1580","srcdb":"202610","sections":[{"crn":"14998"}]}];
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
