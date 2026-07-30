(() => {
  const groups = [{"group":"code:ENGL 2900X","srcdb":"202610","sections":[{"crn":"15747"},{"crn":"16243"}]},{"group":"code:ENGL 2970","srcdb":"202610","sections":[{"crn":"13314"}]},{"group":"code:ENGL 2990","srcdb":"202610","sections":[{"crn":"13315"}]},{"group":"code:ENGN 0030","srcdb":"202610","sections":[{"crn":"10010"},{"crn":"13650"},{"crn":"13651"},{"crn":"13652"},{"crn":"13653"},{"crn":"13654"},{"crn":"13655"},{"crn":"13656"},{"crn":"13657"},{"crn":"13658"},{"crn":"13659"},{"crn":"13660"},{"crn":"13661"},{"crn":"13662"},{"crn":"13663"},{"crn":"13664"},{"crn":"13676"},{"crn":"13677"},{"crn":"13678"},{"crn":"13679"},{"crn":"13680"}]},{"group":"code:ENGN 0061","srcdb":"202610","sections":[{"crn":"16359"}]},{"group":"code:ENGN 0062","srcdb":"202610","sections":[{"crn":"16360"}]},{"group":"code:ENGN 0090","srcdb":"202610","sections":[{"crn":"15175"},{"crn":"15179"}]},{"group":"code:ENGN 0240","srcdb":"202610","sections":[{"crn":"14425"}]},{"group":"code:ENGN 0310","srcdb":"202610","sections":[{"crn":"14095"},{"crn":"15742"},{"crn":"15743"},{"crn":"15780"},{"crn":"16139"}]},{"group":"code:ENGN 0410","srcdb":"202610","sections":[{"crn":"10008"},{"crn":"15744"},{"crn":"15745"},{"crn":"15746"}]},{"group":"code:ENGN 0510","srcdb":"202610","sections":[{"crn":"10012"},{"crn":"15190"},{"crn":"15191"},{"crn":"15192"},{"crn":"15193"}]},{"group":"code:ENGN 0610","srcdb":"202610","sections":[{"crn":"14896"}]},{"group":"code:ENGN 0790","srcdb":"202610","sections":[{"crn":"15158"}]},{"group":"code:ENGN 0810","srcdb":"202610","sections":[{"crn":"14556"},{"crn":"14558"},{"crn":"14559"},{"crn":"15422"}]},{"group":"code:ENGN 1000","srcdb":"202610","sections":[{"crn":"14638"}]},{"group":"code:ENGN 1010","srcdb":"202610","sections":[{"crn":"15008"},{"crn":"15009"},{"crn":"15894"}]},{"group":"code:ENGN 1120","srcdb":"202610","sections":[{"crn":"14347"}]},{"group":"code:ENGN 1200","srcdb":"202610","sections":[{"crn":"15159"}]},{"group":"code:ENGN 1224","srcdb":"202610","sections":[{"crn":"15029"}]},{"group":"code:ENGN 1225","srcdb":"202610","sections":[{"crn":"15028"}]},{"group":"code:ENGN 1230","srcdb":"202610","sections":[{"crn":"10001"}]},{"group":"code:ENGN 1240","srcdb":"202610","sections":[{"crn":"14885"}]},{"group":"code:ENGN 1410","srcdb":"202610","sections":[{"crn":"10011"}]},{"group":"code:ENGN 1560","srcdb":"202610","sections":[{"crn":"10013"}]},{"group":"code:ENGN 1570","srcdb":"202610","sections":[{"crn":"10014"}]}];
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
