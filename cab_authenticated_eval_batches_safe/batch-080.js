(() => {
  const groups = [{"group":"code:PHP 1070","srcdb":"202610","sections":[{"crn":"14757"}]},{"group":"code:PHP 1410","srcdb":"202610","sections":[{"crn":"15754"}]},{"group":"code:PHP 1796","srcdb":"202610","sections":[{"crn":"15490"}]},{"group":"code:PHP 1910","srcdb":"202610","sections":[{"crn":"14755"},{"crn":"14756"}]},{"group":"code:PHP 1915","srcdb":"202610","sections":[{"crn":"15556"}]},{"group":"code:PHP 1920","srcdb":"202610","sections":[{"crn":"15566"}]},{"group":"code:PHP 1970","srcdb":"202610","sections":[{"crn":"12519"},{"crn":"12520"},{"crn":"12521"},{"crn":"12522"},{"crn":"12523"},{"crn":"12524"},{"crn":"12525"},{"crn":"12526"},{"crn":"12527"},{"crn":"12528"},{"crn":"12529"},{"crn":"12530"},{"crn":"12531"},{"crn":"12532"},{"crn":"12533"},{"crn":"12534"},{"crn":"12535"},{"crn":"12536"},{"crn":"12537"},{"crn":"12538"},{"crn":"12539"},{"crn":"12540"},{"crn":"12541"},{"crn":"12542"},{"crn":"12543"},{"crn":"12544"},{"crn":"12545"},{"crn":"12546"},{"crn":"12547"},{"crn":"12548"},{"crn":"12549"},{"crn":"13516"},{"crn":"13548"},{"crn":"14321"},{"crn":"14322"},{"crn":"14390"},{"crn":"14395"},{"crn":"14851"},{"crn":"16190"}]}];
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
