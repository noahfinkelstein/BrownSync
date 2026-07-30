(() => {
  const groups = [{"group":"code:ENGN 2222","srcdb":"202610","sections":[{"crn":"15026"}]},{"group":"code:ENGN 2350","srcdb":"202610","sections":[{"crn":"14099"}]},{"group":"code:ENGN 2410","srcdb":"202610","sections":[{"crn":"14001"}]},{"group":"code:ENGN 2502","srcdb":"202610","sections":[{"crn":"14012"}]},{"group":"code:ENGN 2605","srcdb":"202610","sections":[{"crn":"16099"}]},{"group":"code:ENGN 2625","srcdb":"202610","sections":[{"crn":"10022"},{"crn":"15171"}]},{"group":"code:ENGN 2702","srcdb":"202610","sections":[{"crn":"14667"}]},{"group":"code:ENGN 2703","srcdb":"202610","sections":[{"crn":"15279"}]},{"group":"code:ENGN 2721","srcdb":"202610","sections":[{"crn":"13998"}]},{"group":"code:ENGN 2742","srcdb":"202610","sections":[{"crn":"15025"}]},{"group":"code:ENGN 2800","srcdb":"202610","sections":[{"crn":"14669"}]},{"group":"code:ENGN 2801","srcdb":"202610","sections":[{"crn":"14668"}]},{"group":"code:ENGN 2810","srcdb":"202610","sections":[{"crn":"14560"}]},{"group":"code:ENGN 2911X","srcdb":"202610","sections":[{"crn":"15172"}]},{"group":"code:ENGN 2912B","srcdb":"202610","sections":[{"crn":"10024"},{"crn":"15173"}]},{"group":"code:ENGN 2912E","srcdb":"202610","sections":[{"crn":"15170"}]},{"group":"code:ENGN 2912H","srcdb":"202610","sections":[{"crn":"14554"}]},{"group":"code:ENGN 2912T","srcdb":"202610","sections":[{"crn":"16348"}]},{"group":"code:ENGN 2960","srcdb":"202610","sections":[{"crn":"14424"}]},{"group":"code:ENGN 2970","srcdb":"202610","sections":[{"crn":"13317"}]},{"group":"code:ENGN 2980","srcdb":"202610","sections":[{"crn":"11757"},{"crn":"11758"},{"crn":"11759"},{"crn":"11760"},{"crn":"11761"},{"crn":"11762"},{"crn":"11763"},{"crn":"11764"},{"crn":"11765"},{"crn":"11766"},{"crn":"11767"},{"crn":"11768"},{"crn":"11769"},{"crn":"11770"},{"crn":"11771"},{"crn":"11772"},{"crn":"11773"},{"crn":"11774"},{"crn":"11775"},{"crn":"11776"},{"crn":"11777"},{"crn":"11778"},{"crn":"11779"},{"crn":"11780"},{"crn":"11781"},{"crn":"11782"},{"crn":"11783"},{"crn":"11784"},{"crn":"11785"},{"crn":"11786"},{"crn":"11787"},{"crn":"11788"},{"crn":"11789"},{"crn":"11790"},{"crn":"11791"},{"crn":"11792"},{"crn":"11793"},{"crn":"11794"},{"crn":"11795"},{"crn":"11796"},{"crn":"11797"},{"crn":"11798"},{"crn":"11799"},{"crn":"11800"},{"crn":"11801"},{"crn":"11802"},{"crn":"11803"},{"crn":"11804"},{"crn":"11805"},{"crn":"11806"},{"crn":"11807"},{"crn":"11808"},{"crn":"11809"},{"crn":"11810"},{"crn":"11811"},{"crn":"11812"},{"crn":"11813"},{"crn":"11814"},{"crn":"11815"},{"crn":"11816"},{"crn":"11817"},{"crn":"11818"},{"crn":"11819"},{"crn":"11820"},{"crn":"11821"},{"crn":"11822"},{"crn":"11823"},{"crn":"11824"},{"crn":"11825"},{"crn":"11826"},{"crn":"11827"},{"crn":"11828"},{"crn":"11829"},{"crn":"11830"},{"crn":"11831"},{"crn":"11832"}]},{"group":"code:ENGN 2990","srcdb":"202610","sections":[{"crn":"13318"}]},{"group":"code:ENVS 0070H","srcdb":"202610","sections":[{"crn":"15040"}]},{"group":"code:ENVS 0110","srcdb":"202610","sections":[{"crn":"15041"},{"crn":"15042"},{"crn":"15043"},{"crn":"15044"},{"crn":"15045"},{"crn":"15046"},{"crn":"15047"}]},{"group":"code:ENVS 0465","srcdb":"202610","sections":[{"crn":"15242"}]}];
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
