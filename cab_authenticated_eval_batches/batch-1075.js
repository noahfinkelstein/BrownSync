(() => {
  const groups = [{"group":"code:MATH 1530","srcdb":"202610","sections":[{"crn":"14493"}]},{"group":"code:MATH 1560","srcdb":"202610","sections":[{"crn":"14494"}]},{"group":"code:MATH 1630","srcdb":"202610","sections":[{"crn":"14495"}]},{"group":"code:MATH 1710","srcdb":"202610","sections":[{"crn":"14496"}]},{"group":"code:MATH 1970","srcdb":"202610","sections":[{"crn":"12236"},{"crn":"12237"},{"crn":"12238"},{"crn":"12239"},{"crn":"12240"},{"crn":"12241"},{"crn":"12242"},{"crn":"12243"},{"crn":"12244"},{"crn":"12245"},{"crn":"12246"},{"crn":"12247"},{"crn":"14386"}]},{"group":"code:MATH 2060","srcdb":"202610","sections":[{"crn":"14497"}]},{"group":"code:MATH 2110","srcdb":"202610","sections":[{"crn":"14498"}]},{"group":"code:MATH 2250","srcdb":"202610","sections":[{"crn":"14499"}]},{"group":"code:MATH 2370","srcdb":"202610","sections":[{"crn":"14500"}]},{"group":"code:MATH 2410","srcdb":"202610","sections":[{"crn":"14501"}]},{"group":"code:MATH 2510","srcdb":"202610","sections":[{"crn":"14502"}]},{"group":"code:MATH 2530","srcdb":"202610","sections":[{"crn":"14503"}]},{"group":"code:MATH 2720F","srcdb":"202610","sections":[{"crn":"14504"}]},{"group":"code:MATH 2970","srcdb":"202610","sections":[{"crn":"13344"}]},{"group":"code:MATH 2980","srcdb":"202610","sections":[{"crn":"12248"},{"crn":"12249"},{"crn":"12250"},{"crn":"12251"},{"crn":"12252"},{"crn":"12253"},{"crn":"12254"},{"crn":"12255"},{"crn":"12256"},{"crn":"12257"},{"crn":"12258"},{"crn":"12259"},{"crn":"12260"}]},{"group":"code:MATH 2990","srcdb":"202610","sections":[{"crn":"13345"}]},{"group":"code:MATH XLIST","srcdb":"202610","sections":[{"crn":"15909"}]},{"group":"code:MCM 0150","srcdb":"202610","sections":[{"crn":"15361"},{"crn":"15363"},{"crn":"15364"},{"crn":"15365"},{"crn":"15366"},{"crn":"15367"},{"crn":"15368"}]},{"group":"code:MCM 0700A","srcdb":"202610","sections":[{"crn":"14827"},{"crn":"14829"}]},{"group":"code:MCM 0710A","srcdb":"202610","sections":[{"crn":"15419"},{"crn":"15421"}]},{"group":"code:MCM 0780A","srcdb":"202610","sections":[{"crn":"15369"},{"crn":"15371"}]},{"group":"code:MCM 0903K","srcdb":"202610","sections":[{"crn":"14830"},{"crn":"14832"}]},{"group":"code:MCM 0903O","srcdb":"202610","sections":[{"crn":"15853"},{"crn":"15855"}]},{"group":"code:MCM 1201T","srcdb":"202610","sections":[{"crn":"16186"}]},{"group":"code:MCM 1205Z","srcdb":"202610","sections":[{"crn":"15965"}]}];
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
