(() => {
  const groups = [{"group":"code:CHEM 0980S","srcdb":"202610","sections":[{"crn":"10998"},{"crn":"10999"},{"crn":"11000"}]},{"group":"code:CHEM 0981","srcdb":"202610","sections":[{"crn":"11001"}]},{"group":"code:CHEM 1060","srcdb":"202610","sections":[{"crn":"13530"}]},{"group":"code:CHEM 1140","srcdb":"202610","sections":[{"crn":"14536"}]},{"group":"code:CHEM 1240","srcdb":"202610","sections":[{"crn":"14537"}]},{"group":"code:CHEM 1560H","srcdb":"202610","sections":[{"crn":"14538"}]},{"group":"code:CHEM 1560S","srcdb":"202610","sections":[{"crn":"14540"}]},{"group":"code:CHEM 1700","srcdb":"202610","sections":[{"crn":"14543"}]},{"group":"code:CHEM 1800","srcdb":"202610","sections":[{"crn":"15334"}]},{"group":"code:CHEM 2770","srcdb":"202610","sections":[{"crn":"14547"}]},{"group":"code:CHEM 2870","srcdb":"202610","sections":[{"crn":"14548"},{"crn":"14670"}]},{"group":"code:CHEM 2970","srcdb":"202610","sections":[{"crn":"13289"}]},{"group":"code:CHEM 2980","srcdb":"202610","sections":[{"crn":"11002"},{"crn":"11003"},{"crn":"11004"},{"crn":"11005"},{"crn":"11006"},{"crn":"11007"},{"crn":"11008"},{"crn":"11009"},{"crn":"11010"},{"crn":"11011"},{"crn":"11012"},{"crn":"11013"},{"crn":"11014"},{"crn":"11015"},{"crn":"11016"}]},{"group":"code:CHEM 2981","srcdb":"202610","sections":[{"crn":"11017"},{"crn":"11018"},{"crn":"14416"}]},{"group":"code:CHEM 2990","srcdb":"202610","sections":[{"crn":"13290"}]},{"group":"code:CHIN 0100","srcdb":"202610","sections":[{"crn":"10113"},{"crn":"10114"},{"crn":"10115"},{"crn":"13509"}]},{"group":"code:CHIN 0300","srcdb":"202610","sections":[{"crn":"10116"},{"crn":"10117"},{"crn":"13510"}]},{"group":"code:CHIN 0350","srcdb":"202610","sections":[{"crn":"10118"}]},{"group":"code:CHIN 0500","srcdb":"202610","sections":[{"crn":"10119"},{"crn":"10120"},{"crn":"13511"}]},{"group":"code:CHIN 0700","srcdb":"202610","sections":[{"crn":"10121"},{"crn":"10122"}]},{"group":"code:CHIN 0912","srcdb":"202610","sections":[{"crn":"13519"}]},{"group":"code:CLAS 0150","srcdb":"202610","sections":[{"crn":"13849"}]},{"group":"code:CLAS 0210F","srcdb":"202610","sections":[{"crn":"14003"}]},{"group":"code:CLAS 0765","srcdb":"202610","sections":[{"crn":"13850"}]},{"group":"code:CLAS 0930","srcdb":"202610","sections":[{"crn":"15809"}]}];
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
