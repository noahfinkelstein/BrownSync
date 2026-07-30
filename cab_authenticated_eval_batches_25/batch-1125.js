(() => {
  const groups = [{"group":"code:MED 2160","srcdb":"202610","sections":[{"crn":"16322"}]},{"group":"code:MED 2170","srcdb":"202610","sections":[{"crn":"16323"}]},{"group":"code:MED 2190","srcdb":"202610","sections":[{"crn":"16325"}]},{"group":"code:MED 2980","srcdb":"202610","sections":[{"crn":"12334"},{"crn":"12335"},{"crn":"16230"},{"crn":"16273"}]},{"group":"code:MES 0415","srcdb":"202610","sections":[{"crn":"15681"}]},{"group":"code:MES 1051","srcdb":"202610","sections":[{"crn":"15458"}]},{"group":"code:MES 1970","srcdb":"202610","sections":[{"crn":"12336"},{"crn":"12337"},{"crn":"12338"},{"crn":"12339"},{"crn":"12340"},{"crn":"12341"},{"crn":"13488"},{"crn":"14522"}]},{"group":"code:MES 1971","srcdb":"202610","sections":[{"crn":"12342"}]},{"group":"code:MGRK 0100","srcdb":"202610","sections":[{"crn":"13866"}]},{"group":"code:MGRK 0300","srcdb":"202610","sections":[{"crn":"13867"}]},{"group":"code:MGRK 0500","srcdb":"202610","sections":[{"crn":"13868"}]},{"group":"code:MGRK 1800","srcdb":"202610","sections":[{"crn":"13869"}]},{"group":"code:MGRK 1910","srcdb":"202610","sections":[{"crn":"12343"},{"crn":"12344"},{"crn":"12345"}]},{"group":"code:MGRK 2200","srcdb":"202610","sections":[{"crn":"13870"}]},{"group":"code:MPA 2020","srcdb":"202610","sections":[{"crn":"15034"}]},{"group":"code:MPA 2221","srcdb":"202610","sections":[{"crn":"15139"}]},{"group":"code:MPA 2226","srcdb":"202610","sections":[{"crn":"15032"}]},{"group":"code:MPA 2229","srcdb":"202610","sections":[{"crn":"15033"}]},{"group":"code:MPA 2445","srcdb":"202610","sections":[{"crn":"15031"}]},{"group":"code:MPA 2476","srcdb":"202610","sections":[{"crn":"16040"}]},{"group":"code:MPA 2478","srcdb":"202610","sections":[{"crn":"16349"}]},{"group":"code:MPA 2479","srcdb":"202610","sections":[{"crn":"16355"}]},{"group":"code:MPA 2540","srcdb":"202610","sections":[{"crn":"16017"}]},{"group":"code:MPA 2607","srcdb":"202610","sections":[{"crn":"15716"}]},{"group":"code:MPA 2610","srcdb":"202610","sections":[{"crn":"16305"}]}];
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
