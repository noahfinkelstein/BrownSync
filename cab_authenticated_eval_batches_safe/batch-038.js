(() => {
  const groups = [{"group":"code:CSCI 2990","srcdb":"202610","sections":[{"crn":"13301"}]},{"group":"code:CSCI 2999A","srcdb":"202610","sections":[{"crn":"14288"},{"crn":"15940"}]},{"group":"code:CZCH 0100","srcdb":"202610","sections":[{"crn":"14308"},{"crn":"14309"}]},{"group":"code:DATA 0080","srcdb":"202610","sections":[{"crn":"14681"}]},{"group":"code:DATA 0150","srcdb":"202610","sections":[{"crn":"15268"}]},{"group":"code:DATA 1030","srcdb":"202610","sections":[{"crn":"14835"}]},{"group":"code:DATA 1050","srcdb":"202610","sections":[{"crn":"14959"}]},{"group":"code:DATA 1150","srcdb":"202610","sections":[{"crn":"14957"}]},{"group":"code:DATA 1250","srcdb":"202610","sections":[{"crn":"15641"}]},{"group":"code:DATA 1954S","srcdb":"202610","sections":[{"crn":"15860"}]},{"group":"code:DATA 2060","srcdb":"202610","sections":[{"crn":"14686"}]},{"group":"code:DATA 2450","srcdb":"202610","sections":[{"crn":"13302"}]},{"group":"code:DATA 2980","srcdb":"202610","sections":[{"crn":"11520"}]},{"group":"code:DSIO 2000","srcdb":"202610","sections":[{"crn":"13409"}]},{"group":"code:DSIO 2020","srcdb":"202610","sections":[{"crn":"13407"}]},{"group":"code:DSIO 2030","srcdb":"202610","sections":[{"crn":"13406"}]},{"group":"code:DSIO 2100","srcdb":"202610","sections":[{"crn":"13410"}]},{"group":"code:DSIO 2120","srcdb":"202610","sections":[{"crn":"13408"}]},{"group":"code:DSIO 2130","srcdb":"202610","sections":[{"crn":"13405"}]},{"group":"code:EAST 0152","srcdb":"202610","sections":[{"crn":"13813"}]},{"group":"code:EAST 0305","srcdb":"202610","sections":[{"crn":"13572"}]},{"group":"code:EAST 0401","srcdb":"202610","sections":[{"crn":"15766"}]},{"group":"code:EAST 0415","srcdb":"202610","sections":[{"crn":"13983"},{"crn":"14299"}]},{"group":"code:EAST 0535","srcdb":"202610","sections":[{"crn":"13492"}]},{"group":"code:EAST 0560","srcdb":"202610","sections":[{"crn":"13952"}]}];
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
