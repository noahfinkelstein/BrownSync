(() => {
  const groups = [{"group":"code:RUSS 1840","srcdb":"202610","sections":[{"crn":"14170"}]},{"group":"code:RUSS 1895","srcdb":"202610","sections":[{"crn":"14110"}]},{"group":"code:RUSS 1960","srcdb":"202610","sections":[{"crn":"13030"},{"crn":"13031"},{"crn":"13032"},{"crn":"13033"},{"crn":"13034"},{"crn":"13035"},{"crn":"13036"}]},{"group":"code:RUSS 2970","srcdb":"202610","sections":[{"crn":"13376"}]},{"group":"code:RUSS 2980","srcdb":"202610","sections":[{"crn":"13037"},{"crn":"13038"},{"crn":"13039"}]},{"group":"code:RUSS 2990","srcdb":"202610","sections":[{"crn":"13377"}]},{"group":"code:SANS 0100","srcdb":"202610","sections":[{"crn":"13871"}]},{"group":"code:SANS 0300","srcdb":"202610","sections":[{"crn":"13872"}]},{"group":"code:SANS 1600","srcdb":"202610","sections":[{"crn":"13873"}]},{"group":"code:SANS 1970","srcdb":"202610","sections":[{"crn":"13040"},{"crn":"13041"}]},{"group":"code:SANS 1990","srcdb":"202610","sections":[{"crn":"13042"}]},{"group":"code:SANS 2970","srcdb":"202610","sections":[{"crn":"13378"}]},{"group":"code:SAST 1970","srcdb":"202610","sections":[{"crn":"13043"}]},{"group":"code:SIGN 0100","srcdb":"202610","sections":[{"crn":"13439"},{"crn":"13440"},{"crn":"13441"}]},{"group":"code:SIGN 0300","srcdb":"202610","sections":[{"crn":"13523"},{"crn":"13524"}]},{"group":"code:SIGN 0500","srcdb":"202610","sections":[{"crn":"13526"}]},{"group":"code:SIGN 1910","srcdb":"202610","sections":[{"crn":"13044"},{"crn":"13045"}]},{"group":"code:SLAV 1950","srcdb":"202610","sections":[{"crn":"13046"},{"crn":"13047"},{"crn":"13048"},{"crn":"13049"},{"crn":"13050"},{"crn":"13051"}]},{"group":"code:SLAV 1981","srcdb":"202610","sections":[{"crn":"13052"},{"crn":"13053"},{"crn":"16150"}]},{"group":"code:SLAV 1990","srcdb":"202610","sections":[{"crn":"13054"},{"crn":"13055"}]},{"group":"code:SLAV 2970","srcdb":"202610","sections":[{"crn":"13380"}]},{"group":"code:SLAV 2980","srcdb":"202610","sections":[{"crn":"13056"},{"crn":"13057"},{"crn":"13058"},{"crn":"13059"},{"crn":"13060"}]},{"group":"code:SLAV 2990","srcdb":"202610","sections":[{"crn":"13381"}]},{"group":"code:SOC 0010","srcdb":"202610","sections":[{"crn":"14145"},{"crn":"14146"},{"crn":"14147"},{"crn":"14148"},{"crn":"14149"},{"crn":"14150"},{"crn":"14151"}]},{"group":"code:SOC 0210","srcdb":"202610","sections":[{"crn":"14142"}]}];
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
