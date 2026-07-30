(() => {
  const groups = [{"group":"code:AMST 2660","srcdb":"202610","sections":[{"crn":"10192"},{"crn":"10193"},{"crn":"10194"},{"crn":"10195"},{"crn":"10196"}]},{"group":"code:AMST 2920","srcdb":"202610","sections":[{"crn":"10197"},{"crn":"10198"},{"crn":"10199"},{"crn":"10200"},{"crn":"10201"},{"crn":"10202"},{"crn":"10203"},{"crn":"10204"},{"crn":"10205"},{"crn":"10206"},{"crn":"10207"},{"crn":"10208"},{"crn":"10209"},{"crn":"10210"},{"crn":"10211"},{"crn":"10212"},{"crn":"10213"},{"crn":"13515"},{"crn":"16137"}]},{"group":"code:AMST 2921","srcdb":"202610","sections":[{"crn":"10214"},{"crn":"10215"},{"crn":"10216"},{"crn":"10217"},{"crn":"10218"},{"crn":"10219"},{"crn":"10220"},{"crn":"10221"},{"crn":"10222"},{"crn":"10223"},{"crn":"10224"},{"crn":"14505"},{"crn":"16100"}]},{"group":"code:AMST 2922","srcdb":"202610","sections":[{"crn":"10225"},{"crn":"10226"},{"crn":"10227"},{"crn":"10228"},{"crn":"10229"},{"crn":"10230"},{"crn":"10231"}]},{"group":"code:AMST 2923","srcdb":"202610","sections":[{"crn":"10232"},{"crn":"10233"},{"crn":"10234"},{"crn":"10235"},{"crn":"10236"},{"crn":"10237"},{"crn":"10238"}]},{"group":"code:AMST 2950","srcdb":"202610","sections":[{"crn":"10239"},{"crn":"10240"},{"crn":"10241"}]},{"group":"code:AMST 2990","srcdb":"202610","sections":[{"crn":"13275"}]},{"group":"code:ANTH 0100","srcdb":"202610","sections":[{"crn":"13685"},{"crn":"13764"},{"crn":"13765"},{"crn":"13766"},{"crn":"13767"},{"crn":"13768"},{"crn":"13769"}]},{"group":"code:ANTH 0112","srcdb":"202610","sections":[{"crn":"13691"}]},{"group":"code:ANTH 0350","srcdb":"202610","sections":[{"crn":"14234"},{"crn":"14294"},{"crn":"14295"},{"crn":"14296"},{"crn":"14297"}]},{"group":"code:ANTH 0500","srcdb":"202610","sections":[{"crn":"13686"},{"crn":"13770"},{"crn":"13771"}]},{"group":"code:ANTH 0775","srcdb":"202610","sections":[{"crn":"15902"}]},{"group":"code:ANTH 1202","srcdb":"202610","sections":[{"crn":"15903"}]},{"group":"code:ANTH 1215","srcdb":"202610","sections":[{"crn":"13692"}]},{"group":"code:ANTH 1242","srcdb":"202610","sections":[{"crn":"13690"}]},{"group":"code:ANTH 1329","srcdb":"202610","sections":[{"crn":"15720"}]},{"group":"code:ANTH 1510A","srcdb":"202610","sections":[{"crn":"15607"}]},{"group":"code:ANTH 1558","srcdb":"202610","sections":[{"crn":"16361"}]},{"group":"code:ANTH 1622","srcdb":"202610","sections":[{"crn":"14233"}]},{"group":"code:ANTH 1760","srcdb":"202610","sections":[{"crn":"13689"}]},{"group":"code:ANTH 1773","srcdb":"202610","sections":[{"crn":"15901"}]},{"group":"code:ANTH 1775","srcdb":"202610","sections":[{"crn":"15900"}]},{"group":"code:ANTH 1930","srcdb":"202610","sections":[{"crn":"13694"}]},{"group":"code:ANTH 1940","srcdb":"202610","sections":[{"crn":"13688"}]}];
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
