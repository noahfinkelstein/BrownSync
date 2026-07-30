(() => {
  const groups = [{"group":"code:EEPS 0830","srcdb":"202610","sections":[{"crn":"14954"}]},{"group":"code:EEPS 1130","srcdb":"202610","sections":[{"crn":"15016"}]},{"group":"code:EEPS 1240","srcdb":"202610","sections":[{"crn":"15528"}]},{"group":"code:EEPS 1320","srcdb":"202610","sections":[{"crn":"15018"}]},{"group":"code:EEPS 1370","srcdb":"202610","sections":[{"crn":"15017"}]},{"group":"code:EEPS 1400","srcdb":"202610","sections":[{"crn":"14747"}]},{"group":"code:EEPS 1420","srcdb":"202610","sections":[{"crn":"14740"}]},{"group":"code:EEPS 1430","srcdb":"202610","sections":[{"crn":"15230"}]},{"group":"code:EEPS 1615","srcdb":"202610","sections":[{"crn":"14945"}]},{"group":"code:EEPS 1670","srcdb":"202610","sections":[{"crn":"14952"}]},{"group":"code:EEPS 1690","srcdb":"202610","sections":[{"crn":"14744"}]},{"group":"code:EEPS 1710","srcdb":"202610","sections":[{"crn":"14738"}]},{"group":"code:EEPS 1730","srcdb":"202610","sections":[{"crn":"15992"}]},{"group":"code:EEPS 1940","srcdb":"202610","sections":[{"crn":"11605"},{"crn":"11606"},{"crn":"11607"},{"crn":"11608"},{"crn":"11609"},{"crn":"11610"},{"crn":"11611"},{"crn":"11612"},{"crn":"11613"},{"crn":"11614"},{"crn":"11615"},{"crn":"11616"},{"crn":"11617"},{"crn":"11618"},{"crn":"11619"},{"crn":"11620"},{"crn":"11621"},{"crn":"11622"},{"crn":"11623"},{"crn":"11624"},{"crn":"11625"},{"crn":"11626"},{"crn":"11627"},{"crn":"11628"},{"crn":"11629"},{"crn":"11630"},{"crn":"11631"},{"crn":"11632"},{"crn":"11633"},{"crn":"11634"},{"crn":"11635"}]},{"group":"code:EEPS 1970","srcdb":"202610","sections":[{"crn":"11636"},{"crn":"11637"},{"crn":"11638"},{"crn":"11639"},{"crn":"11640"},{"crn":"11641"},{"crn":"11642"},{"crn":"11643"},{"crn":"11644"},{"crn":"11645"},{"crn":"11646"},{"crn":"11647"},{"crn":"11648"},{"crn":"11649"},{"crn":"11650"},{"crn":"11651"},{"crn":"11652"},{"crn":"11653"},{"crn":"11654"},{"crn":"11655"},{"crn":"11656"},{"crn":"11657"},{"crn":"11658"},{"crn":"11659"},{"crn":"11660"},{"crn":"11661"},{"crn":"11662"},{"crn":"14515"},{"crn":"14630"},{"crn":"16070"}]},{"group":"code:EEPS 2910N","srcdb":"202610","sections":[{"crn":"15612"}]},{"group":"code:EEPS 2920D","srcdb":"202610","sections":[{"crn":"14943"}]},{"group":"code:EEPS 2980","srcdb":"202610","sections":[{"crn":"11663"},{"crn":"11664"},{"crn":"11665"},{"crn":"11666"},{"crn":"11667"},{"crn":"11668"},{"crn":"11669"},{"crn":"11670"},{"crn":"11671"},{"crn":"11672"},{"crn":"11673"},{"crn":"11674"},{"crn":"11675"},{"crn":"11676"},{"crn":"11677"},{"crn":"11678"},{"crn":"11679"},{"crn":"11680"},{"crn":"11681"},{"crn":"11682"},{"crn":"11683"},{"crn":"11684"},{"crn":"11685"},{"crn":"11686"},{"crn":"11687"},{"crn":"11688"},{"crn":"11689"},{"crn":"11690"},{"crn":"11691"},{"crn":"11692"},{"crn":"11693"},{"crn":"11694"},{"crn":"11695"},{"crn":"11696"}]},{"group":"code:EEPS 2990","srcdb":"202610","sections":[{"crn":"13309"}]},{"group":"code:EGYT 1050","srcdb":"202610","sections":[{"crn":"15625"}]},{"group":"code:EGYT 1310","srcdb":"202610","sections":[{"crn":"15088"}]},{"group":"code:EGYT 1435","srcdb":"202610","sections":[{"crn":"15626"}]},{"group":"code:EGYT 1910","srcdb":"202610","sections":[{"crn":"11697"},{"crn":"11698"},{"crn":"11699"},{"crn":"11700"},{"crn":"11701"}]},{"group":"code:EGYT 1990","srcdb":"202610","sections":[{"crn":"11702"},{"crn":"11703"},{"crn":"11704"}]},{"group":"code:EGYT 2450","srcdb":"202610","sections":[{"crn":"13310"}]}];
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
