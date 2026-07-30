(() => {
  const groups = [{"group":"code:MCM 1505B","srcdb":"202610","sections":[{"crn":"15399"},{"crn":"15401"}]},{"group":"code:MCM 1505P","srcdb":"202610","sections":[{"crn":"15374"},{"crn":"15376"}]},{"group":"code:MCM 1507R","srcdb":"202610","sections":[{"crn":"15967"}]},{"group":"code:MCM 1507U","srcdb":"202610","sections":[{"crn":"16350"},{"crn":"16352"}]},{"group":"code:MCM 1700F","srcdb":"202610","sections":[{"crn":"15377"},{"crn":"15379"}]},{"group":"code:MCM 1702E","srcdb":"202610","sections":[{"crn":"15832"},{"crn":"15834"}]},{"group":"code:MCM 1702M","srcdb":"202610","sections":[{"crn":"15966"}]},{"group":"code:MCM 1970","srcdb":"202610","sections":[{"crn":"12261"},{"crn":"12262"},{"crn":"12263"},{"crn":"12264"},{"crn":"12265"},{"crn":"12266"},{"crn":"12267"},{"crn":"12268"},{"crn":"12269"},{"crn":"12270"},{"crn":"12271"}]},{"group":"code:MCM 1980","srcdb":"202610","sections":[{"crn":"12272"},{"crn":"12273"},{"crn":"12274"},{"crn":"12275"},{"crn":"12276"},{"crn":"12277"},{"crn":"12278"},{"crn":"12279"},{"crn":"12280"},{"crn":"12281"},{"crn":"12282"},{"crn":"12283"},{"crn":"12284"},{"crn":"12285"},{"crn":"12286"},{"crn":"12287"},{"crn":"12288"},{"crn":"12289"},{"crn":"12290"},{"crn":"12291"},{"crn":"12292"},{"crn":"12293"},{"crn":"12294"},{"crn":"12295"},{"crn":"16326"},{"crn":"16329"}]},{"group":"code:MCM 1990","srcdb":"202610","sections":[{"crn":"12296"},{"crn":"12297"},{"crn":"12298"},{"crn":"12299"},{"crn":"12300"},{"crn":"12301"},{"crn":"12302"},{"crn":"12303"},{"crn":"12304"},{"crn":"12305"},{"crn":"12306"},{"crn":"12307"},{"crn":"12308"},{"crn":"12309"},{"crn":"12310"},{"crn":"12311"},{"crn":"12312"},{"crn":"12313"},{"crn":"12314"},{"crn":"12315"},{"crn":"12316"},{"crn":"12317"},{"crn":"12318"},{"crn":"16072"},{"crn":"16327"},{"crn":"16328"}]},{"group":"code:MCM 2100O","srcdb":"202610","sections":[{"crn":"15402"}]},{"group":"code:MCM 2300K","srcdb":"202610","sections":[{"crn":"16341"}]},{"group":"code:MCM 2980","srcdb":"202610","sections":[{"crn":"12319"},{"crn":"12320"},{"crn":"12321"},{"crn":"12322"},{"crn":"12323"},{"crn":"12324"},{"crn":"12325"}]},{"group":"code:MCM 2990","srcdb":"202610","sections":[{"crn":"13347"}]},{"group":"code:MDVL 1970","srcdb":"202610","sections":[{"crn":"12326"},{"crn":"12327"},{"crn":"12328"},{"crn":"12329"}]},{"group":"code:MDVL 1990","srcdb":"202610","sections":[{"crn":"12330"},{"crn":"12331"},{"crn":"12332"},{"crn":"12333"}]},{"group":"code:MDVL XLIST","srcdb":"202610","sections":[{"crn":"16331"}]},{"group":"code:MED 2010","srcdb":"202610","sections":[{"crn":"16271"}]},{"group":"code:MED 2030","srcdb":"202610","sections":[{"crn":"16272"}]},{"group":"code:MED 2045","srcdb":"202610","sections":[{"crn":"16214"}]},{"group":"code:MED 2046","srcdb":"202610","sections":[{"crn":"16245"}]},{"group":"code:MED 2060","srcdb":"202610","sections":[{"crn":"16246"}]},{"group":"code:MED 2110","srcdb":"202610","sections":[{"crn":"16319"}]},{"group":"code:MED 2120","srcdb":"202610","sections":[{"crn":"16320"}]},{"group":"code:MED 2145","srcdb":"202610","sections":[{"crn":"16321"}]}];
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
