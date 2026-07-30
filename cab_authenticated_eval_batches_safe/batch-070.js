(() => {
  const groups = [{"group":"code:MATH 2530","srcdb":"202610","sections":[{"crn":"14503"}]},{"group":"code:MATH 2720F","srcdb":"202610","sections":[{"crn":"14504"}]},{"group":"code:MATH 2970","srcdb":"202610","sections":[{"crn":"13344"}]},{"group":"code:MATH 2980","srcdb":"202610","sections":[{"crn":"12248"},{"crn":"12249"},{"crn":"12250"},{"crn":"12251"},{"crn":"12252"},{"crn":"12253"},{"crn":"12254"},{"crn":"12255"},{"crn":"12256"},{"crn":"12257"},{"crn":"12258"},{"crn":"12259"},{"crn":"12260"}]},{"group":"code:MATH 2990","srcdb":"202610","sections":[{"crn":"13345"}]},{"group":"code:MATH XLIST","srcdb":"202610","sections":[{"crn":"15909"}]},{"group":"code:MCM 0150","srcdb":"202610","sections":[{"crn":"15361"},{"crn":"15363"},{"crn":"15364"},{"crn":"15365"},{"crn":"15366"},{"crn":"15367"},{"crn":"15368"}]},{"group":"code:MCM 0700A","srcdb":"202610","sections":[{"crn":"14827"},{"crn":"14829"}]},{"group":"code:MCM 0710A","srcdb":"202610","sections":[{"crn":"15419"},{"crn":"15421"}]},{"group":"code:MCM 0780A","srcdb":"202610","sections":[{"crn":"15369"},{"crn":"15371"}]},{"group":"code:MCM 0903K","srcdb":"202610","sections":[{"crn":"14830"},{"crn":"14832"}]},{"group":"code:MCM 0903O","srcdb":"202610","sections":[{"crn":"15853"},{"crn":"15855"}]},{"group":"code:MCM 1201T","srcdb":"202610","sections":[{"crn":"16186"}]},{"group":"code:MCM 1205Z","srcdb":"202610","sections":[{"crn":"15965"}]},{"group":"code:MCM 1505B","srcdb":"202610","sections":[{"crn":"15399"},{"crn":"15401"}]},{"group":"code:MCM 1505P","srcdb":"202610","sections":[{"crn":"15374"},{"crn":"15376"}]},{"group":"code:MCM 1507R","srcdb":"202610","sections":[{"crn":"15967"}]},{"group":"code:MCM 1507U","srcdb":"202610","sections":[{"crn":"16350"},{"crn":"16352"}]},{"group":"code:MCM 1700F","srcdb":"202610","sections":[{"crn":"15377"},{"crn":"15379"}]},{"group":"code:MCM 1702E","srcdb":"202610","sections":[{"crn":"15832"},{"crn":"15834"}]},{"group":"code:MCM 1702M","srcdb":"202610","sections":[{"crn":"15966"}]},{"group":"code:MCM 1970","srcdb":"202610","sections":[{"crn":"12261"},{"crn":"12262"},{"crn":"12263"},{"crn":"12264"},{"crn":"12265"},{"crn":"12266"},{"crn":"12267"},{"crn":"12268"},{"crn":"12269"},{"crn":"12270"},{"crn":"12271"}]},{"group":"code:MCM 1980","srcdb":"202610","sections":[{"crn":"12272"},{"crn":"12273"},{"crn":"12274"},{"crn":"12275"},{"crn":"12276"},{"crn":"12277"},{"crn":"12278"},{"crn":"12279"},{"crn":"12280"},{"crn":"12281"},{"crn":"12282"},{"crn":"12283"},{"crn":"12284"},{"crn":"12285"},{"crn":"12286"},{"crn":"12287"},{"crn":"12288"},{"crn":"12289"},{"crn":"12290"},{"crn":"12291"},{"crn":"12292"},{"crn":"12293"},{"crn":"12294"},{"crn":"12295"},{"crn":"16326"},{"crn":"16329"}]}];
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
