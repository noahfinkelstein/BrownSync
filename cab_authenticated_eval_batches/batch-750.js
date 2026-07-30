(() => {
  const groups = [{"group":"code:GREK 0100","srcdb":"202610","sections":[{"crn":"13854"}]},{"group":"code:GREK 0300","srcdb":"202610","sections":[{"crn":"13855"}]},{"group":"code:GREK 1010","srcdb":"202610","sections":[{"crn":"14005"}]},{"group":"code:GREK 1110I","srcdb":"202610","sections":[{"crn":"13856"}]},{"group":"code:GREK 1150","srcdb":"202610","sections":[{"crn":"13857"}]},{"group":"code:GREK 1910","srcdb":"202610","sections":[{"crn":"11952"},{"crn":"11953"},{"crn":"11954"},{"crn":"11955"},{"crn":"11956"}]},{"group":"code:GREK 1990","srcdb":"202610","sections":[{"crn":"11957"}]},{"group":"code:GREK 2110A","srcdb":"202610","sections":[{"crn":"14007"}]},{"group":"code:GREK 2970","srcdb":"202610","sections":[{"crn":"13322"}]},{"group":"code:GREK 2980","srcdb":"202610","sections":[{"crn":"11958"},{"crn":"11959"},{"crn":"11960"},{"crn":"11961"},{"crn":"11962"},{"crn":"11963"},{"crn":"11964"}]},{"group":"code:GREK 2990","srcdb":"202610","sections":[{"crn":"13323"}]},{"group":"code:GRMN 0100","srcdb":"202610","sections":[{"crn":"14354"},{"crn":"14355"},{"crn":"14356"},{"crn":"14358"},{"crn":"14359"}]},{"group":"code:GRMN 0300","srcdb":"202610","sections":[{"crn":"14374"},{"crn":"14375"},{"crn":"14376"},{"crn":"14377"}]},{"group":"code:GRMN 0500F","srcdb":"202610","sections":[{"crn":"14369"}]},{"group":"code:GRMN 1000B","srcdb":"202610","sections":[{"crn":"15039"}]},{"group":"code:GRMN 1321E","srcdb":"202610","sections":[{"crn":"14962"}]},{"group":"code:GRMN 1341H","srcdb":"202610","sections":[{"crn":"15278"}]},{"group":"code:GRMN 1441S","srcdb":"202610","sections":[{"crn":"14963"}]},{"group":"code:GRMN 1441T","srcdb":"202610","sections":[{"crn":"15254"}]},{"group":"code:GRMN 1441U","srcdb":"202610","sections":[{"crn":"16107"}]},{"group":"code:GRMN 1661Q","srcdb":"202610","sections":[{"crn":"15983"}]},{"group":"code:GRMN 1970","srcdb":"202610","sections":[{"crn":"11965"},{"crn":"11966"},{"crn":"11967"}]},{"group":"code:GRMN 1990","srcdb":"202610","sections":[{"crn":"11968"},{"crn":"11969"},{"crn":"11970"},{"crn":"11971"},{"crn":"11972"}]},{"group":"code:GRMN 2663D","srcdb":"202610","sections":[{"crn":"14964"}]},{"group":"code:GRMN 2663E","srcdb":"202610","sections":[{"crn":"15570"}]}];
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
