(() => {
  const groups = [{"group":"code:PHYS 2990","srcdb":"202610","sections":[{"crn":"13366"}]},{"group":"code:PLME 0250","srcdb":"202610","sections":[{"crn":"14173"}]},{"group":"code:PLME 0400","srcdb":"202610","sections":[{"crn":"14174"}]},{"group":"code:PLME 1000","srcdb":"202610","sections":[{"crn":"14175"}]},{"group":"code:PLSH 0100","srcdb":"202610","sections":[{"crn":"14315"}]},{"group":"code:PLSH 0300","srcdb":"202610","sections":[{"crn":"14313"}]},{"group":"code:PLSH 0500","srcdb":"202610","sections":[{"crn":"14314"}]},{"group":"code:POBS 0105","srcdb":"202610","sections":[{"crn":"13472"},{"crn":"13473"},{"crn":"13474"},{"crn":"13475"}]},{"group":"code:POBS 0400","srcdb":"202610","sections":[{"crn":"13476"},{"crn":"13477"},{"crn":"13478"},{"crn":"13479"}]},{"group":"code:POBS 0630I","srcdb":"202610","sections":[{"crn":"15054"}]},{"group":"code:POBS 1602C","srcdb":"202610","sections":[{"crn":"14675"}]},{"group":"code:POBS 1602D","srcdb":"202610","sections":[{"crn":"15706"}]},{"group":"code:POBS 1970","srcdb":"202610","sections":[{"crn":"12923"},{"crn":"12924"},{"crn":"12925"},{"crn":"12926"},{"crn":"12927"},{"crn":"12928"},{"crn":"12929"},{"crn":"12930"}]},{"group":"code:POBS 1990","srcdb":"202610","sections":[{"crn":"12931"},{"crn":"12932"},{"crn":"12933"},{"crn":"12934"},{"crn":"12935"},{"crn":"12936"},{"crn":"12937"},{"crn":"12938"},{"crn":"12939"}]},{"group":"code:POBS 2600K","srcdb":"202610","sections":[{"crn":"15685"}]},{"group":"code:POBS 2970","srcdb":"202610","sections":[{"crn":"13368"}]},{"group":"code:POBS 2980","srcdb":"202610","sections":[{"crn":"12940"},{"crn":"12941"},{"crn":"12942"},{"crn":"12943"},{"crn":"12944"},{"crn":"12945"},{"crn":"12946"}]},{"group":"code:POBS 2990","srcdb":"202610","sections":[{"crn":"13369"}]},{"group":"code:POBS XLIST","srcdb":"202610","sections":[{"crn":"16071"}]},{"group":"code:POLS 0010","srcdb":"202610","sections":[{"crn":"14025"},{"crn":"15298"},{"crn":"15299"},{"crn":"15300"},{"crn":"15301"}]},{"group":"code:POLS 0110","srcdb":"202610","sections":[{"crn":"14031"},{"crn":"15302"},{"crn":"15303"},{"crn":"15304"},{"crn":"15305"}]},{"group":"code:POLS 0500","srcdb":"202610","sections":[{"crn":"14033"},{"crn":"15306"},{"crn":"15307"}]},{"group":"code:POLS 0821E","srcdb":"202610","sections":[{"crn":"16174"}]},{"group":"code:POLS 0821F","srcdb":"202610","sections":[{"crn":"14979"}]},{"group":"code:POLS 0920N","srcdb":"202610","sections":[{"crn":"14981"}]}];
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
