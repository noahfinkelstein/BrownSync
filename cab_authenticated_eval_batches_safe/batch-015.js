(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10774"},{"crn":"10775"},{"crn":"10776"},{"crn":"10777"},{"crn":"10778"},{"crn":"10779"},{"crn":"10780"},{"crn":"10781"},{"crn":"10782"},{"crn":"10783"},{"crn":"10784"},{"crn":"10785"},{"crn":"10786"},{"crn":"10787"},{"crn":"10788"},{"crn":"10789"},{"crn":"10790"},{"crn":"10791"},{"crn":"10792"},{"crn":"10793"},{"crn":"10794"},{"crn":"10795"},{"crn":"10796"},{"crn":"10797"},{"crn":"10798"},{"crn":"10799"},{"crn":"10800"},{"crn":"10801"},{"crn":"10802"},{"crn":"10803"},{"crn":"10804"},{"crn":"10805"},{"crn":"10806"},{"crn":"10807"},{"crn":"10808"},{"crn":"10809"},{"crn":"10810"},{"crn":"10811"},{"crn":"10812"},{"crn":"10813"},{"crn":"10814"},{"crn":"10815"},{"crn":"10816"},{"crn":"10817"},{"crn":"10818"},{"crn":"10819"},{"crn":"10820"},{"crn":"10821"},{"crn":"10822"},{"crn":"10823"}]}];
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
