(() => {
  const groups = [{"group":"code:HIST 1964I","srcdb":"202610","sections":[{"crn":"15636"}]},{"group":"code:HIST 1980C","srcdb":"202610","sections":[{"crn":"15818"}]},{"group":"code:HIST 1981T","srcdb":"202610","sections":[{"crn":"16195"}]},{"group":"code:HIST 1990","srcdb":"202610","sections":[{"crn":"12054"},{"crn":"12055"},{"crn":"12056"},{"crn":"12057"},{"crn":"12058"},{"crn":"12059"},{"crn":"12060"},{"crn":"12061"},{"crn":"12062"},{"crn":"12063"},{"crn":"12064"},{"crn":"12065"},{"crn":"12066"},{"crn":"12067"},{"crn":"14506"},{"crn":"14523"},{"crn":"14553"},{"crn":"16015"}]},{"group":"code:HIST 1992","srcdb":"202610","sections":[{"crn":"15076"}]},{"group":"code:HIST 1993","srcdb":"202610","sections":[{"crn":"15077"}]},{"group":"code:HIST 1994","srcdb":"202610","sections":[{"crn":"15079"}]},{"group":"code:HIST 2890","srcdb":"202610","sections":[{"crn":"13336"}]},{"group":"code:HIST 2910","srcdb":"202610","sections":[{"crn":"12068"},{"crn":"12069"},{"crn":"12070"},{"crn":"12071"},{"crn":"12072"},{"crn":"12073"},{"crn":"12074"},{"crn":"12075"},{"crn":"12076"},{"crn":"12077"},{"crn":"12078"},{"crn":"12079"},{"crn":"12080"},{"crn":"12081"},{"crn":"12082"},{"crn":"12083"},{"crn":"12084"},{"crn":"12085"},{"crn":"12086"},{"crn":"12087"},{"crn":"12088"},{"crn":"12089"},{"crn":"12090"},{"crn":"12091"},{"crn":"12092"},{"crn":"12093"},{"crn":"14392"},{"crn":"14507"}]},{"group":"code:HIST 2920","srcdb":"202610","sections":[{"crn":"13828"}]},{"group":"code:HIST 2940","srcdb":"202610","sections":[{"crn":"13823"}]},{"group":"code:HIST 2970K","srcdb":"202610","sections":[{"crn":"14133"}]},{"group":"code:HIST 2971J","srcdb":"202610","sections":[{"crn":"13838"}]},{"group":"code:HIST 2982C","srcdb":"202610","sections":[{"crn":"14841"}]},{"group":"code:HIST 2982E","srcdb":"202610","sections":[{"crn":"13974"}]},{"group":"code:HIST 2990","srcdb":"202610","sections":[{"crn":"13337"}]},{"group":"code:HIST 2991","srcdb":"202610","sections":[{"crn":"16216"}]},{"group":"code:HIST 2992N","srcdb":"202610","sections":[{"crn":"16340"}]},{"group":"code:HMAN 0800B","srcdb":"202610","sections":[{"crn":"13648"}]},{"group":"code:HMAN 0900Y","srcdb":"202610","sections":[{"crn":"15962"}]},{"group":"code:HMAN 0901","srcdb":"202610","sections":[{"crn":"16226"}]},{"group":"code:HMAN 1000A","srcdb":"202610","sections":[{"crn":"13489"}]},{"group":"code:HMAN 1201","srcdb":"202610","sections":[{"crn":"15030"}]},{"group":"code:HMAN 1201A","srcdb":"202610","sections":[{"crn":"15104"}]},{"group":"code:HMAN 1300B","srcdb":"202610","sections":[{"crn":"15352"}]}];
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
