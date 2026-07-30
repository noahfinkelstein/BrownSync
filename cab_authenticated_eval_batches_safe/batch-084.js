(() => {
  const groups = [{"group":"code:PHP 2980","srcdb":"202610","sections":[{"crn":"12599"},{"crn":"12600"},{"crn":"12601"},{"crn":"12602"},{"crn":"12603"},{"crn":"12604"},{"crn":"12605"},{"crn":"12606"},{"crn":"12607"},{"crn":"12608"},{"crn":"12609"},{"crn":"12610"},{"crn":"12611"},{"crn":"12612"},{"crn":"12613"},{"crn":"12614"},{"crn":"12615"},{"crn":"12616"},{"crn":"12617"},{"crn":"12618"},{"crn":"12619"},{"crn":"12620"},{"crn":"12621"},{"crn":"12622"},{"crn":"12623"},{"crn":"12624"},{"crn":"12625"},{"crn":"12626"},{"crn":"12627"},{"crn":"12628"},{"crn":"12629"},{"crn":"12630"},{"crn":"12631"},{"crn":"12632"},{"crn":"12633"},{"crn":"12634"},{"crn":"12635"},{"crn":"12636"},{"crn":"12637"},{"crn":"12638"},{"crn":"12639"},{"crn":"12640"},{"crn":"12641"},{"crn":"12642"},{"crn":"12643"},{"crn":"12644"},{"crn":"12645"},{"crn":"12646"},{"crn":"12647"},{"crn":"12648"}]}];
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
