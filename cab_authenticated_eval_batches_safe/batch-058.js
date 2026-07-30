(() => {
  const groups = [{"group":"code:HIAA 1202","srcdb":"202610","sections":[{"crn":"14735"}]},{"group":"code:HIAA 1433","srcdb":"202610","sections":[{"crn":"16306"}]},{"group":"code:HIAA 1888","srcdb":"202610","sections":[{"crn":"14718"}]},{"group":"code:HIAA 1920","srcdb":"202610","sections":[{"crn":"11978"},{"crn":"11979"},{"crn":"11980"},{"crn":"11981"},{"crn":"11982"},{"crn":"11983"},{"crn":"11984"},{"crn":"11985"},{"crn":"11986"},{"crn":"11987"},{"crn":"11988"},{"crn":"11989"},{"crn":"11990"}]},{"group":"code:HIAA 1990","srcdb":"202610","sections":[{"crn":"11991"},{"crn":"11992"},{"crn":"11993"},{"crn":"11994"},{"crn":"11995"},{"crn":"11996"},{"crn":"11997"},{"crn":"11998"},{"crn":"11999"},{"crn":"12000"},{"crn":"16066"},{"crn":"16068"},{"crn":"16084"}]},{"group":"code:HIAA 1992A","srcdb":"202610","sections":[{"crn":"16126"}]},{"group":"code:HIAA 2301","srcdb":"202610","sections":[{"crn":"14715"}]},{"group":"code:HIAA 2920","srcdb":"202610","sections":[{"crn":"14729"}]},{"group":"code:HIAA 2940","srcdb":"202610","sections":[{"crn":"12001"},{"crn":"12002"},{"crn":"12003"},{"crn":"12004"},{"crn":"12005"},{"crn":"12006"}]},{"group":"code:HIAA 2980","srcdb":"202610","sections":[{"crn":"12007"},{"crn":"12008"},{"crn":"12009"},{"crn":"12010"},{"crn":"12011"},{"crn":"12012"},{"crn":"12013"},{"crn":"12014"},{"crn":"12015"}]},{"group":"code:HIAA 2981","srcdb":"202610","sections":[{"crn":"12016"},{"crn":"12017"},{"crn":"12018"},{"crn":"12019"},{"crn":"12020"},{"crn":"12021"}]},{"group":"code:HIAA 2982","srcdb":"202610","sections":[{"crn":"12022"},{"crn":"12023"},{"crn":"12024"},{"crn":"12025"},{"crn":"12026"},{"crn":"12027"},{"crn":"12028"},{"crn":"12029"},{"crn":"12030"}]},{"group":"code:HIAA 2983","srcdb":"202610","sections":[{"crn":"12031"},{"crn":"12032"},{"crn":"12033"},{"crn":"12034"},{"crn":"12035"},{"crn":"12036"}]},{"group":"code:HIAA 2990","srcdb":"202610","sections":[{"crn":"13329"}]},{"group":"code:HIAA 2991","srcdb":"202610","sections":[{"crn":"13330"}]},{"group":"code:HIAA 2992","srcdb":"202610","sections":[{"crn":"12037"},{"crn":"12038"},{"crn":"12039"},{"crn":"12040"}]},{"group":"code:HIAA XLIST","srcdb":"202610","sections":[{"crn":"16106"}]},{"group":"code:HISP 0100","srcdb":"202610","sections":[{"crn":"15384"},{"crn":"15385"},{"crn":"15386"},{"crn":"15387"}]},{"group":"code:HISP 0200","srcdb":"202610","sections":[{"crn":"15388"}]},{"group":"code:HISP 0300","srcdb":"202610","sections":[{"crn":"15389"},{"crn":"15390"},{"crn":"15391"}]},{"group":"code:HISP 0400","srcdb":"202610","sections":[{"crn":"15392"},{"crn":"15393"}]},{"group":"code:HISP 0500A","srcdb":"202610","sections":[{"crn":"15336"},{"crn":"15337"},{"crn":"15338"},{"crn":"15339"}]},{"group":"code:HISP 0500B","srcdb":"202610","sections":[{"crn":"15340"}]},{"group":"code:HISP 0550","srcdb":"202610","sections":[{"crn":"15976"}]},{"group":"code:HISP 0610N","srcdb":"202610","sections":[{"crn":"15977"}]}];
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
