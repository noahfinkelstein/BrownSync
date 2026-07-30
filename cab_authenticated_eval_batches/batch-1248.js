(() => {
  const groups = [{"group":"code:PHIL 1990","srcdb":"202610","sections":[{"crn":"12484"},{"crn":"12485"},{"crn":"12486"},{"crn":"12487"},{"crn":"12488"},{"crn":"12489"},{"crn":"12490"},{"crn":"12491"},{"crn":"12492"},{"crn":"12493"},{"crn":"12494"},{"crn":"14394"},{"crn":"14517"},{"crn":"14898"}]},{"group":"code:PHIL 1995","srcdb":"202610","sections":[{"crn":"12495"},{"crn":"12496"},{"crn":"12497"},{"crn":"12498"},{"crn":"12499"},{"crn":"12500"},{"crn":"12501"},{"crn":"12502"},{"crn":"12503"},{"crn":"12504"},{"crn":"12505"},{"crn":"12506"},{"crn":"12507"},{"crn":"14388"},{"crn":"14389"}]},{"group":"code:PHIL 2000","srcdb":"202610","sections":[{"crn":"13709"}]},{"group":"code:PHIL 2020","srcdb":"202610","sections":[{"crn":"13710"}]}];
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
