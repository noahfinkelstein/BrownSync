(() => {
  const groups = [{"group":"code:ENGN 2980","srcdb":"202610","sections":[{"crn":"11757"},{"crn":"11758"},{"crn":"11759"},{"crn":"11760"},{"crn":"11761"},{"crn":"11762"},{"crn":"11763"},{"crn":"11764"},{"crn":"11765"},{"crn":"11766"},{"crn":"11767"},{"crn":"11768"},{"crn":"11769"},{"crn":"11770"},{"crn":"11771"},{"crn":"11772"},{"crn":"11773"},{"crn":"11774"},{"crn":"11775"},{"crn":"11776"},{"crn":"11777"},{"crn":"11778"},{"crn":"11779"},{"crn":"11780"},{"crn":"11781"},{"crn":"11782"},{"crn":"11783"},{"crn":"11784"},{"crn":"11785"},{"crn":"11786"},{"crn":"11787"},{"crn":"11788"},{"crn":"11789"},{"crn":"11790"},{"crn":"11791"},{"crn":"11792"},{"crn":"11793"},{"crn":"11794"},{"crn":"11795"},{"crn":"11796"},{"crn":"11797"},{"crn":"11798"},{"crn":"11799"},{"crn":"11800"},{"crn":"11801"},{"crn":"11802"},{"crn":"11803"},{"crn":"11804"},{"crn":"11805"},{"crn":"11806"}]}];
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
