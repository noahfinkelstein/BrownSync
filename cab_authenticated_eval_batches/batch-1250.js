(() => {
  const groups = [{"group":"code:PHIL 2000","srcdb":"202610","sections":[{"crn":"13709"}]},{"group":"code:PHIL 2020","srcdb":"202610","sections":[{"crn":"13710"}]},{"group":"code:PHIL 2142","srcdb":"202610","sections":[{"crn":"13695"}]},{"group":"code:PHIL 2520","srcdb":"202610","sections":[{"crn":"14641"}]},{"group":"code:PHIL 2530","srcdb":"202610","sections":[{"crn":"14176"}]},{"group":"code:PHIL 2720","srcdb":"202610","sections":[{"crn":"13775"}]},{"group":"code:PHIL 2970","srcdb":"202610","sections":[{"crn":"13358"}]},{"group":"code:PHIL 2980","srcdb":"202610","sections":[{"crn":"12508"},{"crn":"12509"},{"crn":"12510"},{"crn":"12511"},{"crn":"12512"},{"crn":"12513"},{"crn":"12514"},{"crn":"12515"},{"crn":"12516"},{"crn":"12517"},{"crn":"12518"},{"crn":"14516"}]},{"group":"code:PHIL 2990","srcdb":"202610","sections":[{"crn":"13359"}]},{"group":"code:PHIL XLIST","srcdb":"202610","sections":[{"crn":"15963"}]},{"group":"code:PHP 0060","srcdb":"202610","sections":[{"crn":"14067"}]},{"group":"code:PHP 0080","srcdb":"202610","sections":[{"crn":"15396"}]},{"group":"code:PHP 0090","srcdb":"202610","sections":[{"crn":"16276"}]},{"group":"code:PHP 1070","srcdb":"202610","sections":[{"crn":"14757"}]},{"group":"code:PHP 1410","srcdb":"202610","sections":[{"crn":"15754"}]},{"group":"code:PHP 1796","srcdb":"202610","sections":[{"crn":"15490"}]},{"group":"code:PHP 1910","srcdb":"202610","sections":[{"crn":"14755"},{"crn":"14756"}]},{"group":"code:PHP 1915","srcdb":"202610","sections":[{"crn":"15556"}]},{"group":"code:PHP 1920","srcdb":"202610","sections":[{"crn":"15566"}]},{"group":"code:PHP 1970","srcdb":"202610","sections":[{"crn":"12519"},{"crn":"12520"},{"crn":"12521"},{"crn":"12522"},{"crn":"12523"},{"crn":"12524"},{"crn":"12525"},{"crn":"12526"},{"crn":"12527"},{"crn":"12528"},{"crn":"12529"},{"crn":"12530"},{"crn":"12531"},{"crn":"12532"},{"crn":"12533"},{"crn":"12534"},{"crn":"12535"},{"crn":"12536"},{"crn":"12537"},{"crn":"12538"},{"crn":"12539"},{"crn":"12540"},{"crn":"12541"},{"crn":"12542"},{"crn":"12543"},{"crn":"12544"},{"crn":"12545"},{"crn":"12546"},{"crn":"12547"},{"crn":"12548"},{"crn":"12549"},{"crn":"13516"},{"crn":"13548"},{"crn":"14321"},{"crn":"14322"},{"crn":"14390"},{"crn":"14395"},{"crn":"14851"},{"crn":"16190"}]},{"group":"code:PHP 1980","srcdb":"202610","sections":[{"crn":"12550"},{"crn":"12551"},{"crn":"12552"},{"crn":"12553"},{"crn":"12554"},{"crn":"12555"},{"crn":"12556"},{"crn":"12557"},{"crn":"12558"},{"crn":"12559"},{"crn":"12560"},{"crn":"12561"},{"crn":"12562"},{"crn":"12563"},{"crn":"12564"},{"crn":"12565"},{"crn":"12566"},{"crn":"12567"},{"crn":"12568"},{"crn":"12569"},{"crn":"12570"},{"crn":"12571"},{"crn":"12572"},{"crn":"12573"},{"crn":"12574"},{"crn":"12575"},{"crn":"12576"},{"crn":"12577"},{"crn":"12578"},{"crn":"12579"},{"crn":"12580"},{"crn":"12581"},{"crn":"12582"},{"crn":"12583"},{"crn":"12584"},{"crn":"12585"},{"crn":"12586"},{"crn":"12587"},{"crn":"12588"},{"crn":"12589"},{"crn":"12590"},{"crn":"12591"},{"crn":"12592"},{"crn":"12593"},{"crn":"12594"},{"crn":"12595"},{"crn":"12596"},{"crn":"12597"},{"crn":"12598"},{"crn":"14385"},{"crn":"14396"},{"crn":"16067"},{"crn":"16069"},{"crn":"16076"}]},{"group":"code:PHP 2000","srcdb":"202610","sections":[{"crn":"16052"}]},{"group":"code:PHP 2023","srcdb":"202610","sections":[{"crn":"15491"}]},{"group":"code:PHP 2072","srcdb":"202610","sections":[{"crn":"15296"},{"crn":"15297"},{"crn":"15493"}]},{"group":"code:PHP 2079","srcdb":"202610","sections":[{"crn":"15701"}]}];
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
