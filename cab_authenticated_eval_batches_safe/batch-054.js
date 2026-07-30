(() => {
  const groups = [{"group":"code:EPI 1720","srcdb":"202610","sections":[{"crn":"15348"}]},{"group":"code:EPI 2120","srcdb":"202610","sections":[{"crn":"15294"}]},{"group":"code:EPI 2140","srcdb":"202610","sections":[{"crn":"15293"},{"crn":"15893"}]},{"group":"code:EPI 2150","srcdb":"202610","sections":[{"crn":"15292"}]},{"group":"code:EPI 2180","srcdb":"202610","sections":[{"crn":"15287"}]},{"group":"code:EPI 2220B","srcdb":"202610","sections":[{"crn":"15286"}]},{"group":"code:EPI 2220F","srcdb":"202610","sections":[{"crn":"15291"}]},{"group":"code:EPI 2232","srcdb":"202610","sections":[{"crn":"15290"}]},{"group":"code:EPI 2250","srcdb":"202610","sections":[{"crn":"15289"}]},{"group":"code:EPI 2490","srcdb":"202610","sections":[{"crn":"15288"}]},{"group":"code:ERLY 1970","srcdb":"202610","sections":[{"crn":"11900"}]},{"group":"code:ERLY 1990","srcdb":"202610","sections":[{"crn":"11901"}]},{"group":"code:ETHN 0090A","srcdb":"202610","sections":[{"crn":"13985"}]},{"group":"code:ETHN 1200K","srcdb":"202610","sections":[{"crn":"13988"}]},{"group":"code:ETHN 1209","srcdb":"202610","sections":[{"crn":"16342"}]},{"group":"code:ETHN 1751G","srcdb":"202610","sections":[{"crn":"15753"}]},{"group":"code:ETHN 1751K","srcdb":"202610","sections":[{"crn":"13989"}]},{"group":"code:ETHN 1751L","srcdb":"202610","sections":[{"crn":"16184"}]},{"group":"code:ETHN 1751M","srcdb":"202610","sections":[{"crn":"16124"}]},{"group":"code:ETHN 1910","srcdb":"202610","sections":[{"crn":"11902"},{"crn":"11903"},{"crn":"11904"},{"crn":"11905"},{"crn":"11906"},{"crn":"11907"},{"crn":"11908"}]},{"group":"code:ETHN 1920","srcdb":"202610","sections":[{"crn":"11909"},{"crn":"11910"},{"crn":"11911"},{"crn":"14518"},{"crn":"14519"}]},{"group":"code:FREN 0100","srcdb":"202610","sections":[{"crn":"13713"},{"crn":"13714"},{"crn":"13715"}]},{"group":"code:FREN 0300","srcdb":"202610","sections":[{"crn":"13716"}]},{"group":"code:FREN 0400","srcdb":"202610","sections":[{"crn":"13718"},{"crn":"13727"}]},{"group":"code:FREN 0500","srcdb":"202610","sections":[{"crn":"13719"},{"crn":"13720"},{"crn":"13721"}]}];
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
