(() => {
  const groups = [{"group":"code:BIOL 2990","srcdb":"202610","sections":[{"crn":"13288"}]},{"group":"code:BIOL XLIST","srcdb":"202610","sections":[{"crn":"15933"}]},{"group":"code:BSS 1550","srcdb":"202610","sections":[{"crn":"15799"}]},{"group":"code:BSS 1690","srcdb":"202610","sections":[{"crn":"15551"}]},{"group":"code:BSS 1890","srcdb":"202610","sections":[{"crn":"15567"}]},{"group":"code:BSS 1998","srcdb":"202610","sections":[{"crn":"15565"}]},{"group":"code:BSS 2060","srcdb":"202610","sections":[{"crn":"15492"}]},{"group":"code:BSS 2061","srcdb":"202610","sections":[{"crn":"15568"}]},{"group":"code:BSS 2300","srcdb":"202610","sections":[{"crn":"15564"}]},{"group":"code:BSS 2310","srcdb":"202610","sections":[{"crn":"15543"}]},{"group":"code:BSS 2340","srcdb":"202610","sections":[{"crn":"15563"}]},{"group":"code:BSS 2355","srcdb":"202610","sections":[{"crn":"15562"}]},{"group":"code:BSS 2361","srcdb":"202610","sections":[{"crn":"15561"}]},{"group":"code:BSS 2371","srcdb":"202610","sections":[{"crn":"15560"}]},{"group":"code:BSS 2710","srcdb":"202610","sections":[{"crn":"15990"}]},{"group":"code:BSS 2727","srcdb":"202610","sections":[{"crn":"15527"}]},{"group":"code:CATL 1910","srcdb":"202610","sections":[{"crn":"10975"}]},{"group":"code:CHEM 0100","srcdb":"202610","sections":[{"crn":"13521"},{"crn":"15055"},{"crn":"15056"},{"crn":"15057"}]},{"group":"code:CHEM 0330","srcdb":"202610","sections":[{"crn":"13527"},{"crn":"13528"},{"crn":"15061"},{"crn":"15062"},{"crn":"15063"},{"crn":"15064"},{"crn":"15090"},{"crn":"15091"},{"crn":"15092"}]},{"group":"code:CHEM 0330L","srcdb":"202610","sections":[{"crn":"15514"},{"crn":"15515"},{"crn":"15516"},{"crn":"15517"},{"crn":"15518"},{"crn":"15519"},{"crn":"15520"},{"crn":"15521"},{"crn":"15522"},{"crn":"15524"},{"crn":"15611"}]},{"group":"code:CHEM 0350","srcdb":"202610","sections":[{"crn":"13551"}]},{"group":"code:CHEM 0360","srcdb":"202610","sections":[{"crn":"13433"}]},{"group":"code:CHEM 0361","srcdb":"202610","sections":[{"crn":"15850"}]},{"group":"code:CHEM 0370","srcdb":"202610","sections":[{"crn":"15065"},{"crn":"15067"},{"crn":"15068"},{"crn":"15070"},{"crn":"15075"},{"crn":"15084"}]},{"group":"code:CHEM 0980","srcdb":"202610","sections":[{"crn":"10976"},{"crn":"10977"},{"crn":"10978"},{"crn":"10979"},{"crn":"10980"},{"crn":"10981"},{"crn":"10982"},{"crn":"10983"},{"crn":"10984"},{"crn":"10985"},{"crn":"10986"},{"crn":"10987"},{"crn":"10988"},{"crn":"10989"},{"crn":"10990"},{"crn":"10991"},{"crn":"10992"},{"crn":"10993"},{"crn":"10994"},{"crn":"10995"},{"crn":"10996"},{"crn":"10997"}]}];
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
