(() => {
  const groups = [{"group":"code:PHYS 1610","srcdb":"202610","sections":[{"crn":"13891"}]},{"group":"code:PHYS 1640","srcdb":"202610","sections":[{"crn":"13893"}]},{"group":"code:PHYS 1720","srcdb":"202610","sections":[{"crn":"10052"}]},{"group":"code:PHYS 1980","srcdb":"202610","sections":[{"crn":"12772"},{"crn":"12773"},{"crn":"12774"},{"crn":"12775"},{"crn":"12776"},{"crn":"12777"},{"crn":"12778"},{"crn":"12779"},{"crn":"12780"},{"crn":"12781"},{"crn":"12782"},{"crn":"12783"},{"crn":"12784"},{"crn":"12785"},{"crn":"12786"},{"crn":"12787"},{"crn":"12788"},{"crn":"12789"},{"crn":"12790"},{"crn":"12791"},{"crn":"12792"},{"crn":"12793"},{"crn":"12794"},{"crn":"12795"},{"crn":"14397"},{"crn":"14398"},{"crn":"16203"}]},{"group":"code:PHYS 1990","srcdb":"202610","sections":[{"crn":"12796"},{"crn":"12797"},{"crn":"12798"},{"crn":"12799"},{"crn":"12800"},{"crn":"12801"},{"crn":"12802"},{"crn":"12803"},{"crn":"12804"},{"crn":"12805"},{"crn":"12806"},{"crn":"12807"},{"crn":"12808"},{"crn":"12809"},{"crn":"12810"},{"crn":"12811"},{"crn":"12812"},{"crn":"12813"},{"crn":"12814"},{"crn":"12815"},{"crn":"12816"},{"crn":"12817"},{"crn":"12818"},{"crn":"12819"},{"crn":"12820"},{"crn":"12821"},{"crn":"13504"},{"crn":"14402"},{"crn":"16204"}]},{"group":"code:PHYS 2010","srcdb":"202610","sections":[{"crn":"13895"}]},{"group":"code:PHYS 2020","srcdb":"202610","sections":[{"crn":"13896"}]},{"group":"code:PHYS 2030","srcdb":"202610","sections":[{"crn":"13897"}]},{"group":"code:PHYS 2050","srcdb":"202610","sections":[{"crn":"13898"}]},{"group":"code:PHYS 2070","srcdb":"202610","sections":[{"crn":"13899"}]},{"group":"code:PHYS 2320","srcdb":"202610","sections":[{"crn":"13900"}]},{"group":"code:PHYS 2410","srcdb":"202610","sections":[{"crn":"13901"}]},{"group":"code:PHYS 2470","srcdb":"202610","sections":[{"crn":"13902"}]},{"group":"code:PHYS 2550","srcdb":"202610","sections":[{"crn":"13903"}]},{"group":"code:PHYS 2630","srcdb":"202610","sections":[{"crn":"13892"}]},{"group":"code:PHYS 2640","srcdb":"202610","sections":[{"crn":"13894"}]},{"group":"code:PHYS 2710","srcdb":"202610","sections":[{"crn":"12822"},{"crn":"12823"},{"crn":"12824"},{"crn":"12825"},{"crn":"12826"},{"crn":"12827"},{"crn":"12828"},{"crn":"12829"},{"crn":"12830"},{"crn":"12831"},{"crn":"12832"},{"crn":"12833"},{"crn":"12834"},{"crn":"12835"},{"crn":"12836"},{"crn":"12837"},{"crn":"12838"},{"crn":"12839"},{"crn":"12840"},{"crn":"12841"},{"crn":"12842"},{"crn":"12843"},{"crn":"12844"},{"crn":"12845"},{"crn":"12846"},{"crn":"12847"},{"crn":"12848"},{"crn":"12849"},{"crn":"12850"},{"crn":"12851"},{"crn":"12852"},{"crn":"12853"},{"crn":"12854"},{"crn":"12855"},{"crn":"12856"},{"crn":"12857"},{"crn":"12858"},{"crn":"12859"},{"crn":"12860"},{"crn":"12861"},{"crn":"12862"},{"crn":"12863"},{"crn":"12864"},{"crn":"12865"}]},{"group":"code:PHYS 2711","srcdb":"202610","sections":[{"crn":"14400"}]},{"group":"code:PHYS 2970","srcdb":"202610","sections":[{"crn":"13364"},{"crn":"13365"}]},{"group":"code:PHYS 2980","srcdb":"202610","sections":[{"crn":"12866"},{"crn":"12867"},{"crn":"12868"},{"crn":"12869"},{"crn":"12870"},{"crn":"12871"},{"crn":"12872"},{"crn":"12873"},{"crn":"12874"},{"crn":"12875"},{"crn":"12876"},{"crn":"12877"},{"crn":"12878"},{"crn":"12879"},{"crn":"12880"},{"crn":"12881"},{"crn":"12882"},{"crn":"12883"},{"crn":"12884"},{"crn":"12885"},{"crn":"12886"},{"crn":"12887"},{"crn":"12888"},{"crn":"12889"},{"crn":"12890"},{"crn":"12891"},{"crn":"12892"},{"crn":"12893"},{"crn":"12894"},{"crn":"12895"},{"crn":"12896"},{"crn":"12897"},{"crn":"12898"},{"crn":"12899"},{"crn":"12900"},{"crn":"12901"},{"crn":"12902"},{"crn":"12903"},{"crn":"12904"},{"crn":"12905"},{"crn":"12906"},{"crn":"12907"},{"crn":"12908"},{"crn":"12909"},{"crn":"12910"},{"crn":"12911"},{"crn":"12912"},{"crn":"12913"},{"crn":"12914"},{"crn":"12915"},{"crn":"12916"},{"crn":"12917"},{"crn":"12918"},{"crn":"12919"},{"crn":"12920"},{"crn":"12921"},{"crn":"12922"}]},{"group":"code:PHYS 2990","srcdb":"202610","sections":[{"crn":"13366"}]},{"group":"code:PLME 0250","srcdb":"202610","sections":[{"crn":"14173"}]},{"group":"code:PLME 0400","srcdb":"202610","sections":[{"crn":"14174"}]},{"group":"code:PLME 1000","srcdb":"202610","sections":[{"crn":"14175"}]},{"group":"code:PLSH 0100","srcdb":"202610","sections":[{"crn":"14315"}]}];
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
