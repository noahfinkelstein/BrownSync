(() => {
  const groups = [{"group":"code:CSCI 1510","srcdb":"202610","sections":[{"crn":"14256"}]},{"group":"code:CSCI 1550","srcdb":"202610","sections":[{"crn":"14258"}]},{"group":"code:CSCI 1570","srcdb":"202610","sections":[{"crn":"14259"}]},{"group":"code:CSCI 1600","srcdb":"202610","sections":[{"crn":"14260"},{"crn":"16057"},{"crn":"16058"}]},{"group":"code:CSCI 1640","srcdb":"202610","sections":[{"crn":"14261"}]},{"group":"code:CSCI 1670","srcdb":"202610","sections":[{"crn":"14263"}]},{"group":"code:CSCI 1675","srcdb":"202610","sections":[{"crn":"14265"}]},{"group":"code:CSCI 1690","srcdb":"202610","sections":[{"crn":"14266"}]},{"group":"code:CSCI 1715","srcdb":"202610","sections":[{"crn":"14267"}]},{"group":"code:CSCI 1730","srcdb":"202610","sections":[{"crn":"14268"},{"crn":"16025"}]},{"group":"code:CSCI 1810","srcdb":"202610","sections":[{"crn":"14269"}]},{"group":"code:CSCI 1870","srcdb":"202610","sections":[{"crn":"14270"},{"crn":"15941"}]},{"group":"code:CSCI 1950N","srcdb":"202610","sections":[{"crn":"14370"}]},{"group":"code:CSCI 1951R","srcdb":"202610","sections":[{"crn":"14271"}]},{"group":"code:CSCI 1952A","srcdb":"202610","sections":[{"crn":"15957"}]},{"group":"code:CSCI 1953A","srcdb":"202610","sections":[{"crn":"14273"}]},{"group":"code:CSCI 1953C","srcdb":"202610","sections":[{"crn":"16235"}]},{"group":"code:CSCI 1970","srcdb":"202610","sections":[{"crn":"11294"},{"crn":"11295"},{"crn":"11296"},{"crn":"11297"},{"crn":"11298"},{"crn":"11299"},{"crn":"11300"},{"crn":"11301"},{"crn":"11302"},{"crn":"11303"},{"crn":"11304"},{"crn":"11305"},{"crn":"11306"},{"crn":"11307"},{"crn":"11308"},{"crn":"11309"},{"crn":"11310"},{"crn":"11311"},{"crn":"11312"},{"crn":"11313"},{"crn":"11314"},{"crn":"11315"},{"crn":"11316"},{"crn":"11317"},{"crn":"11318"},{"crn":"11319"},{"crn":"11320"},{"crn":"11321"},{"crn":"11322"},{"crn":"11323"},{"crn":"11324"},{"crn":"11325"},{"crn":"11326"},{"crn":"11327"},{"crn":"11328"},{"crn":"11329"},{"crn":"11330"},{"crn":"11331"},{"crn":"11332"},{"crn":"11333"},{"crn":"11334"},{"crn":"11335"},{"crn":"11336"},{"crn":"11337"},{"crn":"11338"},{"crn":"11339"},{"crn":"11340"},{"crn":"11341"},{"crn":"11342"},{"crn":"11343"},{"crn":"11344"},{"crn":"11345"},{"crn":"11346"},{"crn":"11347"},{"crn":"11348"},{"crn":"11349"},{"crn":"11350"},{"crn":"11351"},{"crn":"11352"},{"crn":"11353"},{"crn":"11354"},{"crn":"11355"},{"crn":"11356"},{"crn":"11357"},{"crn":"11358"},{"crn":"11359"},{"crn":"11360"},{"crn":"11361"},{"crn":"11362"},{"crn":"11363"},{"crn":"11364"},{"crn":"11365"},{"crn":"11366"}]},{"group":"code:CSCI 1971","srcdb":"202610","sections":[{"crn":"11367"},{"crn":"11368"},{"crn":"11369"},{"crn":"11370"},{"crn":"11371"},{"crn":"11372"},{"crn":"11373"},{"crn":"11374"},{"crn":"11375"},{"crn":"11376"},{"crn":"11377"},{"crn":"11378"},{"crn":"11379"},{"crn":"11380"},{"crn":"11381"},{"crn":"11382"},{"crn":"11383"},{"crn":"11384"},{"crn":"11385"},{"crn":"11386"},{"crn":"11387"},{"crn":"11388"},{"crn":"11389"},{"crn":"11390"},{"crn":"11391"},{"crn":"11392"},{"crn":"11393"},{"crn":"11394"},{"crn":"11395"},{"crn":"11396"},{"crn":"11397"}]},{"group":"code:CSCI 1973","srcdb":"202610","sections":[{"crn":"11398"},{"crn":"11399"},{"crn":"11400"},{"crn":"11401"},{"crn":"11402"},{"crn":"11403"},{"crn":"11404"},{"crn":"11405"},{"crn":"11406"},{"crn":"11407"},{"crn":"11408"},{"crn":"11409"},{"crn":"11410"},{"crn":"11411"},{"crn":"11412"},{"crn":"11413"},{"crn":"11414"},{"crn":"11415"},{"crn":"11416"},{"crn":"11417"},{"crn":"11418"},{"crn":"11419"},{"crn":"11420"},{"crn":"11421"},{"crn":"11422"},{"crn":"11423"},{"crn":"11424"},{"crn":"11425"},{"crn":"11426"},{"crn":"11427"},{"crn":"11428"},{"crn":"11429"},{"crn":"11430"},{"crn":"11431"},{"crn":"11432"},{"crn":"11433"},{"crn":"11434"},{"crn":"11435"},{"crn":"11436"},{"crn":"11437"},{"crn":"11438"},{"crn":"11439"},{"crn":"11440"},{"crn":"11441"},{"crn":"11442"},{"crn":"11443"},{"crn":"11444"},{"crn":"11445"},{"crn":"11446"},{"crn":"11447"},{"crn":"11448"},{"crn":"11449"},{"crn":"11450"},{"crn":"13514"}]},{"group":"code:CSCI 2200","srcdb":"202610","sections":[{"crn":"14274"},{"crn":"15881"},{"crn":"15939"}]},{"group":"code:CSCI 2230","srcdb":"202610","sections":[{"crn":"14276"}]},{"group":"code:CSCI 2370","srcdb":"202610","sections":[{"crn":"14277"}]},{"group":"code:CSCI 2470","srcdb":"202610","sections":[{"crn":"14278"}]},{"group":"code:CSCI 2540","srcdb":"202610","sections":[{"crn":"15948"}]}];
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
