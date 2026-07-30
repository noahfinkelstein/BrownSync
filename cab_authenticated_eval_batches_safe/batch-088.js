(() => {
  const groups = [{"group":"code:PHYS 0470","srcdb":"202610","sections":[{"crn":"10050"},{"crn":"13934"},{"crn":"13935"},{"crn":"13936"},{"crn":"13937"},{"crn":"13938"},{"crn":"13939"}]},{"group":"code:PHYS 0720","srcdb":"202610","sections":[{"crn":"10051"}]},{"group":"code:PHYS 0790","srcdb":"202610","sections":[{"crn":"10053"}]},{"group":"code:PHYS 1280","srcdb":"202610","sections":[{"crn":"13887"}]},{"group":"code:PHYS 1410","srcdb":"202610","sections":[{"crn":"13888"}]},{"group":"code:PHYS 1510","srcdb":"202610","sections":[{"crn":"13889"}]},{"group":"code:PHYS 1530","srcdb":"202610","sections":[{"crn":"13890"}]},{"group":"code:PHYS 1610","srcdb":"202610","sections":[{"crn":"13891"}]},{"group":"code:PHYS 1640","srcdb":"202610","sections":[{"crn":"13893"}]},{"group":"code:PHYS 1720","srcdb":"202610","sections":[{"crn":"10052"}]},{"group":"code:PHYS 1980","srcdb":"202610","sections":[{"crn":"12772"},{"crn":"12773"},{"crn":"12774"},{"crn":"12775"},{"crn":"12776"},{"crn":"12777"},{"crn":"12778"},{"crn":"12779"},{"crn":"12780"},{"crn":"12781"},{"crn":"12782"},{"crn":"12783"},{"crn":"12784"},{"crn":"12785"},{"crn":"12786"},{"crn":"12787"},{"crn":"12788"},{"crn":"12789"},{"crn":"12790"},{"crn":"12791"},{"crn":"12792"},{"crn":"12793"},{"crn":"12794"},{"crn":"12795"},{"crn":"14397"},{"crn":"14398"},{"crn":"16203"}]},{"group":"code:PHYS 1990","srcdb":"202610","sections":[{"crn":"12796"},{"crn":"12797"},{"crn":"12798"},{"crn":"12799"},{"crn":"12800"},{"crn":"12801"},{"crn":"12802"},{"crn":"12803"},{"crn":"12804"},{"crn":"12805"},{"crn":"12806"},{"crn":"12807"},{"crn":"12808"},{"crn":"12809"},{"crn":"12810"},{"crn":"12811"},{"crn":"12812"},{"crn":"12813"},{"crn":"12814"},{"crn":"12815"},{"crn":"12816"},{"crn":"12817"},{"crn":"12818"},{"crn":"12819"},{"crn":"12820"},{"crn":"12821"},{"crn":"13504"},{"crn":"14402"},{"crn":"16204"}]},{"group":"code:PHYS 2010","srcdb":"202610","sections":[{"crn":"13895"}]},{"group":"code:PHYS 2020","srcdb":"202610","sections":[{"crn":"13896"}]},{"group":"code:PHYS 2030","srcdb":"202610","sections":[{"crn":"13897"}]},{"group":"code:PHYS 2050","srcdb":"202610","sections":[{"crn":"13898"}]},{"group":"code:PHYS 2070","srcdb":"202610","sections":[{"crn":"13899"}]},{"group":"code:PHYS 2320","srcdb":"202610","sections":[{"crn":"13900"}]},{"group":"code:PHYS 2410","srcdb":"202610","sections":[{"crn":"13901"}]},{"group":"code:PHYS 2470","srcdb":"202610","sections":[{"crn":"13902"}]},{"group":"code:PHYS 2550","srcdb":"202610","sections":[{"crn":"13903"}]},{"group":"code:PHYS 2630","srcdb":"202610","sections":[{"crn":"13892"}]},{"group":"code:PHYS 2640","srcdb":"202610","sections":[{"crn":"13894"}]}];
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
