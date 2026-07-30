(() => {
  const groups = [{"group":"code:BIOL 1950","srcdb":"202610","sections":[{"crn":"10574"},{"crn":"10575"},{"crn":"10576"},{"crn":"10577"},{"crn":"10578"},{"crn":"10579"},{"crn":"10580"},{"crn":"10581"},{"crn":"10582"},{"crn":"10583"},{"crn":"10584"},{"crn":"10585"},{"crn":"10586"},{"crn":"10587"},{"crn":"10588"},{"crn":"10589"},{"crn":"10590"},{"crn":"10591"},{"crn":"10592"},{"crn":"10593"},{"crn":"10594"},{"crn":"10595"},{"crn":"10596"},{"crn":"10597"},{"crn":"10598"},{"crn":"10599"},{"crn":"10600"},{"crn":"10601"},{"crn":"10602"},{"crn":"10603"},{"crn":"10604"},{"crn":"10605"},{"crn":"10606"},{"crn":"10607"},{"crn":"10608"},{"crn":"10609"},{"crn":"10610"},{"crn":"10611"},{"crn":"10612"},{"crn":"10613"},{"crn":"10614"},{"crn":"10615"},{"crn":"10616"},{"crn":"10617"},{"crn":"10618"},{"crn":"10619"},{"crn":"10620"},{"crn":"10621"},{"crn":"10622"},{"crn":"10623"}]}];
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
