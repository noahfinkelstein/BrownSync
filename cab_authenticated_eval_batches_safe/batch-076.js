(() => {
  const groups = [{"group":"code:NEUR 1970","srcdb":"202610","sections":[{"crn":"12391"},{"crn":"12392"},{"crn":"12393"},{"crn":"12394"},{"crn":"12395"},{"crn":"12396"},{"crn":"12397"},{"crn":"12398"},{"crn":"12399"},{"crn":"12400"},{"crn":"12401"},{"crn":"12402"},{"crn":"12403"},{"crn":"12404"},{"crn":"12405"},{"crn":"12406"},{"crn":"12407"},{"crn":"12408"},{"crn":"12409"},{"crn":"12410"},{"crn":"12411"},{"crn":"12412"},{"crn":"12413"},{"crn":"12414"},{"crn":"12415"},{"crn":"12416"},{"crn":"12417"},{"crn":"12418"},{"crn":"12419"},{"crn":"12420"},{"crn":"12421"},{"crn":"12422"},{"crn":"12423"},{"crn":"12424"},{"crn":"12425"},{"crn":"12426"},{"crn":"12427"},{"crn":"12428"},{"crn":"12429"},{"crn":"12430"},{"crn":"12431"},{"crn":"12432"},{"crn":"12433"},{"crn":"12434"},{"crn":"12435"},{"crn":"12436"},{"crn":"12437"},{"crn":"12438"},{"crn":"12439"},{"crn":"12440"}]}];
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
