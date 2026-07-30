(() => {
  const groups = [{"group":"code:GRMN 2970","srcdb":"202610","sections":[{"crn":"13326"}]},{"group":"code:GRMN 2980","srcdb":"202610","sections":[{"crn":"11973"},{"crn":"11974"},{"crn":"11975"},{"crn":"11976"},{"crn":"11977"}]},{"group":"code:GRMN 2990","srcdb":"202610","sections":[{"crn":"13327"}]},{"group":"code:HCL 2000","srcdb":"202610","sections":[{"crn":"16090"}]},{"group":"code:HCL 2010","srcdb":"202610","sections":[{"crn":"16088"}]},{"group":"code:HCL 2080A","srcdb":"202610","sections":[{"crn":"16094"}]},{"group":"code:HCL 2080B","srcdb":"202610","sections":[{"crn":"16101"}]},{"group":"code:HCL 2090A","srcdb":"202610","sections":[{"crn":"16096"}]},{"group":"code:HCL 2090B","srcdb":"202610","sections":[{"crn":"16102"}]},{"group":"code:HCL 2150","srcdb":"202610","sections":[{"crn":"16092"}]},{"group":"code:HEBR 0100","srcdb":"202610","sections":[{"crn":"13500"}]},{"group":"code:HEBR 0300","srcdb":"202610","sections":[{"crn":"13501"}]},{"group":"code:HEBR 0500","srcdb":"202610","sections":[{"crn":"13502"}]},{"group":"code:HIAA 0010","srcdb":"202610","sections":[{"crn":"14697"},{"crn":"14698"},{"crn":"14699"},{"crn":"14700"},{"crn":"14701"},{"crn":"14702"},{"crn":"14703"},{"crn":"14704"},{"crn":"14705"},{"crn":"16086"}]},{"group":"code:HIAA 0023","srcdb":"202610","sections":[{"crn":"14710"},{"crn":"14711"},{"crn":"15739"},{"crn":"15740"},{"crn":"15741"}]},{"group":"code:HIAA 0032","srcdb":"202610","sections":[{"crn":"14706"},{"crn":"14707"},{"crn":"14708"},{"crn":"14709"},{"crn":"15220"}]},{"group":"code:HIAA 0052","srcdb":"202610","sections":[{"crn":"15697"},{"crn":"15698"},{"crn":"15699"},{"crn":"15700"},{"crn":"16087"}]},{"group":"code:HIAA 0140","srcdb":"202610","sections":[{"crn":"15196"}]},{"group":"code:HIAA 0190","srcdb":"202610","sections":[{"crn":"15195"}]},{"group":"code:HIAA 1152","srcdb":"202610","sections":[{"crn":"15690"}]},{"group":"code:HIAA 1171","srcdb":"202610","sections":[{"crn":"15434"}]},{"group":"code:HIAA 1202","srcdb":"202610","sections":[{"crn":"14735"}]},{"group":"code:HIAA 1433","srcdb":"202610","sections":[{"crn":"16306"}]},{"group":"code:HIAA 1888","srcdb":"202610","sections":[{"crn":"14718"}]},{"group":"code:HIAA 1920","srcdb":"202610","sections":[{"crn":"11978"},{"crn":"11979"},{"crn":"11980"},{"crn":"11981"},{"crn":"11982"},{"crn":"11983"},{"crn":"11984"},{"crn":"11985"},{"crn":"11986"},{"crn":"11987"},{"crn":"11988"},{"crn":"11989"},{"crn":"11990"}]}];
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
