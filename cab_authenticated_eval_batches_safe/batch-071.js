(() => {
  const groups = [{"group":"code:MCM 1990","srcdb":"202610","sections":[{"crn":"12296"},{"crn":"12297"},{"crn":"12298"},{"crn":"12299"},{"crn":"12300"},{"crn":"12301"},{"crn":"12302"},{"crn":"12303"},{"crn":"12304"},{"crn":"12305"},{"crn":"12306"},{"crn":"12307"},{"crn":"12308"},{"crn":"12309"},{"crn":"12310"},{"crn":"12311"},{"crn":"12312"},{"crn":"12313"},{"crn":"12314"},{"crn":"12315"},{"crn":"12316"},{"crn":"12317"},{"crn":"12318"},{"crn":"16072"},{"crn":"16327"},{"crn":"16328"}]},{"group":"code:MCM 2100O","srcdb":"202610","sections":[{"crn":"15402"}]},{"group":"code:MCM 2300K","srcdb":"202610","sections":[{"crn":"16341"}]},{"group":"code:MCM 2980","srcdb":"202610","sections":[{"crn":"12319"},{"crn":"12320"},{"crn":"12321"},{"crn":"12322"},{"crn":"12323"},{"crn":"12324"},{"crn":"12325"}]},{"group":"code:MCM 2990","srcdb":"202610","sections":[{"crn":"13347"}]},{"group":"code:MDVL 1970","srcdb":"202610","sections":[{"crn":"12326"},{"crn":"12327"},{"crn":"12328"},{"crn":"12329"}]},{"group":"code:MDVL 1990","srcdb":"202610","sections":[{"crn":"12330"},{"crn":"12331"},{"crn":"12332"},{"crn":"12333"}]},{"group":"code:MDVL XLIST","srcdb":"202610","sections":[{"crn":"16331"}]},{"group":"code:MED 2010","srcdb":"202610","sections":[{"crn":"16271"}]},{"group":"code:MED 2030","srcdb":"202610","sections":[{"crn":"16272"}]},{"group":"code:MED 2045","srcdb":"202610","sections":[{"crn":"16214"}]},{"group":"code:MED 2046","srcdb":"202610","sections":[{"crn":"16245"}]},{"group":"code:MED 2060","srcdb":"202610","sections":[{"crn":"16246"}]},{"group":"code:MED 2110","srcdb":"202610","sections":[{"crn":"16319"}]},{"group":"code:MED 2120","srcdb":"202610","sections":[{"crn":"16320"}]},{"group":"code:MED 2145","srcdb":"202610","sections":[{"crn":"16321"}]},{"group":"code:MED 2160","srcdb":"202610","sections":[{"crn":"16322"}]},{"group":"code:MED 2170","srcdb":"202610","sections":[{"crn":"16323"}]},{"group":"code:MED 2190","srcdb":"202610","sections":[{"crn":"16325"}]},{"group":"code:MED 2980","srcdb":"202610","sections":[{"crn":"12334"},{"crn":"12335"},{"crn":"16230"},{"crn":"16273"}]},{"group":"code:MES 0415","srcdb":"202610","sections":[{"crn":"15681"}]},{"group":"code:MES 1051","srcdb":"202610","sections":[{"crn":"15458"}]},{"group":"code:MES 1970","srcdb":"202610","sections":[{"crn":"12336"},{"crn":"12337"},{"crn":"12338"},{"crn":"12339"},{"crn":"12340"},{"crn":"12341"},{"crn":"13488"},{"crn":"14522"}]},{"group":"code:MES 1971","srcdb":"202610","sections":[{"crn":"12342"}]},{"group":"code:MGRK 0100","srcdb":"202610","sections":[{"crn":"13866"}]}];
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
