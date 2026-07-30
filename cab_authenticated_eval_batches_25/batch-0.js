(() => {
  const groups = [{"group":"code:AFRI 0090","srcdb":"202610","sections":[{"crn":"15141"}]},{"group":"code:AFRI 1111","srcdb":"202610","sections":[{"crn":"15142"}]},{"group":"code:AFRI 1112","srcdb":"202610","sections":[{"crn":"15622"}]},{"group":"code:AFRI 1232","srcdb":"202610","sections":[{"crn":"15258"}]},{"group":"code:AFRI 1330","srcdb":"202610","sections":[{"crn":"15214"}]},{"group":"code:AFRI 1970","srcdb":"202610","sections":[{"crn":"10162"},{"crn":"10163"},{"crn":"10164"},{"crn":"10165"},{"crn":"10166"},{"crn":"10167"},{"crn":"10168"},{"crn":"10169"},{"crn":"10170"},{"crn":"10171"},{"crn":"10172"},{"crn":"10173"}]},{"group":"code:AFRI 2003","srcdb":"202610","sections":[{"crn":"16065"}]},{"group":"code:AFRI 2970","srcdb":"202610","sections":[{"crn":"13272"}]},{"group":"code:AFRI 2980","srcdb":"202610","sections":[{"crn":"10175"},{"crn":"10176"},{"crn":"10177"},{"crn":"10178"},{"crn":"10179"},{"crn":"10180"},{"crn":"10181"},{"crn":"10182"}]},{"group":"code:AFRI 2990","srcdb":"202610","sections":[{"crn":"13273"}]},{"group":"code:AMST 0192W","srcdb":"202610","sections":[{"crn":"13995"}]},{"group":"code:AMST 0192X","srcdb":"202610","sections":[{"crn":"14938"}]},{"group":"code:AMST 0601J","srcdb":"202610","sections":[{"crn":"14937"}]},{"group":"code:AMST 1900T","srcdb":"202610","sections":[{"crn":"13991"}]},{"group":"code:AMST 1907C","srcdb":"202610","sections":[{"crn":"15752"}]},{"group":"code:AMST 1907L","srcdb":"202610","sections":[{"crn":"13992"}]},{"group":"code:AMST 1907M","srcdb":"202610","sections":[{"crn":"16123"}]},{"group":"code:AMST 1907N","srcdb":"202610","sections":[{"crn":"16183"}]},{"group":"code:AMST 1907P","srcdb":"202610","sections":[{"crn":"16182"}]},{"group":"code:AMST 1970","srcdb":"202610","sections":[{"crn":"10183"},{"crn":"10184"},{"crn":"10185"},{"crn":"10186"},{"crn":"10187"},{"crn":"10188"},{"crn":"10189"},{"crn":"10190"},{"crn":"10191"}]},{"group":"code:AMST 1977H","srcdb":"202610","sections":[{"crn":"16122"}]},{"group":"code:AMST 2010","srcdb":"202610","sections":[{"crn":"13993"}]},{"group":"code:AMST 2221L","srcdb":"202610","sections":[{"crn":"13994"}]},{"group":"code:AMST 2221N","srcdb":"202610","sections":[{"crn":"16121"}]},{"group":"code:AMST 2520","srcdb":"202610","sections":[{"crn":"15530"}]}];
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
