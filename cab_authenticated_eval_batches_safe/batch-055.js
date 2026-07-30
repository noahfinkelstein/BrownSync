(() => {
  const groups = [{"group":"code:FREN 0600","srcdb":"202610","sections":[{"crn":"13722"},{"crn":"13725"},{"crn":"13726"}]},{"group":"code:FREN 0720G","srcdb":"202610","sections":[{"crn":"13879"}]},{"group":"code:FREN 1040B","srcdb":"202610","sections":[{"crn":"13876"}]},{"group":"code:FREN 1130G","srcdb":"202610","sections":[{"crn":"16050"}]},{"group":"code:FREN 1330G","srcdb":"202610","sections":[{"crn":"14773"}]},{"group":"code:FREN 1970","srcdb":"202610","sections":[{"crn":"11912"},{"crn":"11913"},{"crn":"11914"},{"crn":"11915"},{"crn":"11916"}]},{"group":"code:FREN 1990","srcdb":"202610","sections":[{"crn":"11917"},{"crn":"11918"},{"crn":"11919"},{"crn":"11920"},{"crn":"11921"},{"crn":"11922"},{"crn":"11923"}]},{"group":"code:FREN 2600Q","srcdb":"202610","sections":[{"crn":"16280"}]},{"group":"code:FREN 2970","srcdb":"202610","sections":[{"crn":"13320"}]},{"group":"code:FREN 2980","srcdb":"202610","sections":[{"crn":"11924"},{"crn":"11925"},{"crn":"11926"},{"crn":"11927"},{"crn":"11928"},{"crn":"11929"}]},{"group":"code:FREN 2990","srcdb":"202610","sections":[{"crn":"13321"}]},{"group":"code:GNSS 0120","srcdb":"202610","sections":[{"crn":"13940"}]},{"group":"code:GNSS 1410","srcdb":"202610","sections":[{"crn":"14913"}]},{"group":"code:GNSS 1535","srcdb":"202610","sections":[{"crn":"13996"}]},{"group":"code:GNSS 1810","srcdb":"202610","sections":[{"crn":"11930"},{"crn":"11931"},{"crn":"11932"},{"crn":"11933"},{"crn":"11934"},{"crn":"11935"},{"crn":"11936"}]},{"group":"code:GNSS 1970","srcdb":"202610","sections":[{"crn":"11937"},{"crn":"11938"},{"crn":"11939"},{"crn":"11940"},{"crn":"11941"},{"crn":"11942"},{"crn":"11943"},{"crn":"11944"},{"crn":"11945"},{"crn":"11946"},{"crn":"11947"},{"crn":"11948"},{"crn":"11949"},{"crn":"11950"}]},{"group":"code:GNSS 1990","srcdb":"202610","sections":[{"crn":"13941"}]},{"group":"code:GNSS 2001","srcdb":"202610","sections":[{"crn":"16278"}]},{"group":"code:GNSS 2010T","srcdb":"202610","sections":[{"crn":"13950"}]},{"group":"code:GNSS 2720","srcdb":"202610","sections":[{"crn":"11951"}]},{"group":"code:GNSS XLIST","srcdb":"202610","sections":[{"crn":"16019"}]},{"group":"code:GPHP 2010","srcdb":"202610","sections":[{"crn":"16302"}]},{"group":"code:GPHP 2020","srcdb":"202610","sections":[{"crn":"16314"}]},{"group":"code:GPHP 2300","srcdb":"202610","sections":[{"crn":"16298"}]},{"group":"code:GPHP 2310","srcdb":"202610","sections":[{"crn":"16297"}]}];
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
