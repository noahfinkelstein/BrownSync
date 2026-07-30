(() => {
  const groups = [{"group":"code:MATH 0100","srcdb":"202610","sections":[{"crn":"14448"},{"crn":"14449"},{"crn":"14450"},{"crn":"14451"},{"crn":"14452"},{"crn":"14719"},{"crn":"14720"},{"crn":"14721"},{"crn":"14722"},{"crn":"14723"},{"crn":"14724"},{"crn":"14725"},{"crn":"14726"},{"crn":"14727"},{"crn":"14728"}]},{"group":"code:MATH 0180","srcdb":"202610","sections":[{"crn":"14453"},{"crn":"14454"},{"crn":"14455"},{"crn":"14456"},{"crn":"14457"},{"crn":"14458"},{"crn":"14459"},{"crn":"14460"},{"crn":"14461"},{"crn":"14462"}]},{"group":"code:MATH 0190","srcdb":"202610","sections":[{"crn":"14463"},{"crn":"14464"},{"crn":"14465"},{"crn":"14466"},{"crn":"14467"},{"crn":"14468"}]},{"group":"code:MATH 0200","srcdb":"202610","sections":[{"crn":"14469"},{"crn":"14470"},{"crn":"14471"},{"crn":"14472"},{"crn":"14473"},{"crn":"14474"},{"crn":"14475"},{"crn":"14476"},{"crn":"14477"}]},{"group":"code:MATH 0350","srcdb":"202610","sections":[{"crn":"14478"},{"crn":"14479"}]},{"group":"code:MATH 0520","srcdb":"202610","sections":[{"crn":"14480"},{"crn":"14481"},{"crn":"14482"},{"crn":"14483"},{"crn":"14484"},{"crn":"14485"}]},{"group":"code:MATH 0530","srcdb":"202610","sections":[{"crn":"14760"}]},{"group":"code:MATH 0540","srcdb":"202610","sections":[{"crn":"14486"}]},{"group":"code:MATH 1010","srcdb":"202610","sections":[{"crn":"14488"}]},{"group":"code:MATH 1020","srcdb":"202610","sections":[{"crn":"14639"}]},{"group":"code:MATH 1060","srcdb":"202610","sections":[{"crn":"14489"}]},{"group":"code:MATH 1110","srcdb":"202610","sections":[{"crn":"14490"}]},{"group":"code:MATH 1210","srcdb":"202610","sections":[{"crn":"14491"}]},{"group":"code:MATH 1460","srcdb":"202610","sections":[{"crn":"14492"}]},{"group":"code:MATH 1530","srcdb":"202610","sections":[{"crn":"14493"}]},{"group":"code:MATH 1560","srcdb":"202610","sections":[{"crn":"14494"}]},{"group":"code:MATH 1630","srcdb":"202610","sections":[{"crn":"14495"}]},{"group":"code:MATH 1710","srcdb":"202610","sections":[{"crn":"14496"}]},{"group":"code:MATH 1970","srcdb":"202610","sections":[{"crn":"12236"},{"crn":"12237"},{"crn":"12238"},{"crn":"12239"},{"crn":"12240"},{"crn":"12241"},{"crn":"12242"},{"crn":"12243"},{"crn":"12244"},{"crn":"12245"},{"crn":"12246"},{"crn":"12247"},{"crn":"14386"}]},{"group":"code:MATH 2060","srcdb":"202610","sections":[{"crn":"14497"}]},{"group":"code:MATH 2110","srcdb":"202610","sections":[{"crn":"14498"}]},{"group":"code:MATH 2250","srcdb":"202610","sections":[{"crn":"14499"}]},{"group":"code:MATH 2370","srcdb":"202610","sections":[{"crn":"14500"}]},{"group":"code:MATH 2410","srcdb":"202610","sections":[{"crn":"14501"}]},{"group":"code:MATH 2510","srcdb":"202610","sections":[{"crn":"14502"}]}];
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
