(() => {
  const groups = [{"group":"code:SOC 2960Y","srcdb":"202610","sections":[{"crn":"14130"}]},{"group":"code:SOC 2961E","srcdb":"202610","sections":[{"crn":"16081"}]},{"group":"code:SOC 2970","srcdb":"202610","sections":[{"crn":"13383"}]},{"group":"code:SOC 2980","srcdb":"202610","sections":[{"crn":"13110"},{"crn":"13111"},{"crn":"13112"},{"crn":"13113"},{"crn":"13114"},{"crn":"13115"},{"crn":"13116"},{"crn":"13117"},{"crn":"13118"},{"crn":"13119"},{"crn":"13120"},{"crn":"13121"},{"crn":"13123"},{"crn":"13124"},{"crn":"13125"},{"crn":"13126"},{"crn":"13127"},{"crn":"13128"},{"crn":"13129"},{"crn":"13130"},{"crn":"13131"},{"crn":"13132"},{"crn":"13133"},{"crn":"13135"},{"crn":"13136"},{"crn":"13137"},{"crn":"13138"},{"crn":"13139"},{"crn":"13140"},{"crn":"13141"},{"crn":"13142"}]}];
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
