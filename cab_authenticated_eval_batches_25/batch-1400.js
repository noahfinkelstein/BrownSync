(() => {
  const groups = [{"group":"code:RELS 1050I","srcdb":"202610","sections":[{"crn":"16187"}]},{"group":"code:RELS 1195","srcdb":"202610","sections":[{"crn":"15696"}]},{"group":"code:RELS 1530H","srcdb":"202610","sections":[{"crn":"13962"}]},{"group":"code:RELS 1604","srcdb":"202610","sections":[{"crn":"16192"}]},{"group":"code:RELS 1705B","srcdb":"202610","sections":[{"crn":"15803"}]},{"group":"code:RELS 1977E","srcdb":"202610","sections":[{"crn":"16138"}]},{"group":"code:RELS 1990","srcdb":"202610","sections":[{"crn":"13012"},{"crn":"13013"},{"crn":"13014"}]},{"group":"code:RELS 1995","srcdb":"202610","sections":[{"crn":"13966"}]},{"group":"code:RELS 1999","srcdb":"202610","sections":[{"crn":"13015"},{"crn":"13016"},{"crn":"13017"},{"crn":"13018"},{"crn":"13019"},{"crn":"13531"}]},{"group":"code:RELS 2000B","srcdb":"202610","sections":[{"crn":"13954"}]},{"group":"code:RELS 2890","srcdb":"202610","sections":[{"crn":"13374"}]},{"group":"code:RELS 2910","srcdb":"202610","sections":[{"crn":"13020"},{"crn":"13021"},{"crn":"13022"},{"crn":"13023"},{"crn":"13024"},{"crn":"13025"},{"crn":"13026"},{"crn":"13027"},{"crn":"13028"},{"crn":"13029"},{"crn":"13470"},{"crn":"14401"},{"crn":"14514"}]},{"group":"code:RELS 2990","srcdb":"202610","sections":[{"crn":"13375"}]},{"group":"code:RUSS 0100","srcdb":"202610","sections":[{"crn":"14365"},{"crn":"16149"}]},{"group":"code:RUSS 0300","srcdb":"202610","sections":[{"crn":"14101"}]},{"group":"code:RUSS 0320A","srcdb":"202610","sections":[{"crn":"13981"}]},{"group":"code:RUSS 0500","srcdb":"202610","sections":[{"crn":"14311"},{"crn":"14312"}]},{"group":"code:RUSS 1110","srcdb":"202610","sections":[{"crn":"14305"}]},{"group":"code:RUSS 1240","srcdb":"202610","sections":[{"crn":"15763"}]},{"group":"code:RUSS 1250","srcdb":"202610","sections":[{"crn":"14166"}]},{"group":"code:RUSS 1840","srcdb":"202610","sections":[{"crn":"14170"}]},{"group":"code:RUSS 1895","srcdb":"202610","sections":[{"crn":"14110"}]},{"group":"code:RUSS 1960","srcdb":"202610","sections":[{"crn":"13030"},{"crn":"13031"},{"crn":"13032"},{"crn":"13033"},{"crn":"13034"},{"crn":"13035"},{"crn":"13036"}]},{"group":"code:RUSS 2970","srcdb":"202610","sections":[{"crn":"13376"}]},{"group":"code:RUSS 2980","srcdb":"202610","sections":[{"crn":"13037"},{"crn":"13038"},{"crn":"13039"}]}];
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
