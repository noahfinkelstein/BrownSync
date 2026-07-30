(() => {
  const groups = [{"group":"code:ARCH 2975","srcdb":"202610","sections":[{"crn":"10373"},{"crn":"10374"},{"crn":"10375"},{"crn":"10376"},{"crn":"10377"},{"crn":"10378"},{"crn":"10379"},{"crn":"10380"},{"crn":"10381"}]},{"group":"code:ARCH 2976","srcdb":"202610","sections":[{"crn":"10382"},{"crn":"10383"},{"crn":"10384"},{"crn":"10385"},{"crn":"10386"},{"crn":"10387"},{"crn":"10388"},{"crn":"10389"},{"crn":"10390"},{"crn":"10391"}]},{"group":"code:ARCH 2980","srcdb":"202610","sections":[{"crn":"10392"},{"crn":"10393"},{"crn":"10394"},{"crn":"10395"},{"crn":"10396"},{"crn":"10397"},{"crn":"10398"},{"crn":"10399"}]},{"group":"code:ARCH 2982","srcdb":"202610","sections":[{"crn":"10400"},{"crn":"10401"},{"crn":"10402"},{"crn":"10403"},{"crn":"10404"},{"crn":"10405"}]},{"group":"code:ARCH 2983","srcdb":"202610","sections":[{"crn":"10406"},{"crn":"10407"},{"crn":"10408"},{"crn":"10409"},{"crn":"10410"},{"crn":"10411"},{"crn":"10412"},{"crn":"10413"},{"crn":"10414"}]},{"group":"code:ARTS 1018","srcdb":"202610","sections":[{"crn":"15790"}]},{"group":"code:ARTS 1019","srcdb":"202610","sections":[{"crn":"15725"}]},{"group":"code:ARTS 1020","srcdb":"202610","sections":[{"crn":"16034"}]},{"group":"code:ARTS 1970","srcdb":"202610","sections":[{"crn":"10415"},{"crn":"10416"},{"crn":"10417"},{"crn":"10418"},{"crn":"10419"}]},{"group":"code:ASYR 0510","srcdb":"202610","sections":[{"crn":"15089"}]},{"group":"code:ASYR 0800","srcdb":"202610","sections":[{"crn":"15087"}]},{"group":"code:ASYR 1020","srcdb":"202610","sections":[{"crn":"15100"}]},{"group":"code:ASYR 1990","srcdb":"202610","sections":[{"crn":"10420"},{"crn":"10421"},{"crn":"10422"}]},{"group":"code:ASYR 2310A","srcdb":"202610","sections":[{"crn":"15099"}]},{"group":"code:ASYR 2980","srcdb":"202610","sections":[{"crn":"10423"},{"crn":"13480"},{"crn":"13481"}]},{"group":"code:ASYR 2990","srcdb":"202610","sections":[{"crn":"13284"}]},{"group":"code:BHDS 2000","srcdb":"202610","sections":[{"crn":"16294"}]},{"group":"code:BHDS 2010","srcdb":"202610","sections":[{"crn":"16293"}]},{"group":"code:BHDS 2030","srcdb":"202610","sections":[{"crn":"16289"}]},{"group":"code:BHDS 2040","srcdb":"202610","sections":[{"crn":"16292"}]},{"group":"code:BHDS 2120","srcdb":"202610","sections":[{"crn":"16287"}]},{"group":"code:BHDS 2130","srcdb":"202610","sections":[{"crn":"16291"}]},{"group":"code:BIOL 0170","srcdb":"202610","sections":[{"crn":"10054"},{"crn":"14845"}]},{"group":"code:BIOL 0190P","srcdb":"202610","sections":[{"crn":"10081"},{"crn":"14863"}]},{"group":"code:BIOL 0200","srcdb":"202610","sections":[{"crn":"10082"},{"crn":"14847"}]}];
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
