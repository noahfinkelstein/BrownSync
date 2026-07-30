(() => {
  const groups = [{"group":"code:SOC 0300","srcdb":"202610","sections":[{"crn":"14152"}]},{"group":"code:SOC 0310","srcdb":"202610","sections":[{"crn":"14655"}]},{"group":"code:SOC 1010","srcdb":"202610","sections":[{"crn":"14154"}]},{"group":"code:SOC 1040","srcdb":"202610","sections":[{"crn":"14144"}]},{"group":"code:SOC 1100","srcdb":"202610","sections":[{"crn":"14128"},{"crn":"14135"},{"crn":"14136"},{"crn":"14137"},{"crn":"14138"},{"crn":"14139"},{"crn":"14140"},{"crn":"16207"},{"crn":"16208"},{"crn":"16209"},{"crn":"16210"},{"crn":"16211"},{"crn":"16212"},{"crn":"16213"}]},{"group":"code:SOC 1117","srcdb":"202610","sections":[{"crn":"14129"}]},{"group":"code:SOC 1120","srcdb":"202610","sections":[{"crn":"14141"}]},{"group":"code:SOC 1270","srcdb":"202610","sections":[{"crn":"14156"}]},{"group":"code:SOC 1315","srcdb":"202610","sections":[{"crn":"14143"}]},{"group":"code:SOC 1450","srcdb":"202610","sections":[{"crn":"14157"},{"crn":"16051"}]},{"group":"code:SOC 1871D","srcdb":"202610","sections":[{"crn":"14161"}]},{"group":"code:SOC 1873G","srcdb":"202610","sections":[{"crn":"14159"}]},{"group":"code:SOC 1874I","srcdb":"202610","sections":[{"crn":"15462"}]},{"group":"code:SOC 1970","srcdb":"202610","sections":[{"crn":"13061"},{"crn":"13062"},{"crn":"13063"},{"crn":"13064"},{"crn":"13065"},{"crn":"13066"},{"crn":"13067"},{"crn":"13068"},{"crn":"13069"},{"crn":"13070"},{"crn":"13071"},{"crn":"13072"},{"crn":"13073"},{"crn":"13074"},{"crn":"13075"},{"crn":"13076"},{"crn":"15895"},{"crn":"15896"},{"crn":"15897"},{"crn":"15898"}]},{"group":"code:SOC 1980","srcdb":"202610","sections":[{"crn":"13077"},{"crn":"13078"},{"crn":"13079"},{"crn":"13080"},{"crn":"13081"},{"crn":"13082"},{"crn":"13083"},{"crn":"13084"},{"crn":"13085"},{"crn":"13086"},{"crn":"13087"},{"crn":"13088"},{"crn":"13089"},{"crn":"13090"},{"crn":"13091"},{"crn":"13092"},{"crn":"13093"},{"crn":"13094"},{"crn":"13095"},{"crn":"13096"},{"crn":"13097"},{"crn":"13098"},{"crn":"13099"},{"crn":"13100"},{"crn":"13101"},{"crn":"13102"},{"crn":"13103"},{"crn":"13104"},{"crn":"13109"}]},{"group":"code:SOC 2010","srcdb":"202610","sections":[{"crn":"14165"}]},{"group":"code:SOC 2040","srcdb":"202610","sections":[{"crn":"14164"}]},{"group":"code:SOC 2080","srcdb":"202610","sections":[{"crn":"14179"}]},{"group":"code:SOC 2260K","srcdb":"202610","sections":[{"crn":"14177"}]},{"group":"code:SOC 2325","srcdb":"202610","sections":[{"crn":"16172"}]},{"group":"code:SOC 2420","srcdb":"202610","sections":[{"crn":"14178"}]},{"group":"code:SOC 2500","srcdb":"202610","sections":[{"crn":"14300"}]},{"group":"code:SOC 2610","srcdb":"202610","sections":[{"crn":"14180"}]},{"group":"code:SOC 2960Y","srcdb":"202610","sections":[{"crn":"14130"}]},{"group":"code:SOC 2961E","srcdb":"202610","sections":[{"crn":"16081"}]}];
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
