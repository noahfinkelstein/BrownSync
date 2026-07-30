(() => {
  const groups = [{"group":"code:PHP 2950","srcdb":"202610","sections":[{"crn":"15553"},{"crn":"15554"},{"crn":"15555"}]},{"group":"code:PHP 2980","srcdb":"202610","sections":[{"crn":"12599"},{"crn":"12600"},{"crn":"12601"},{"crn":"12602"},{"crn":"12603"},{"crn":"12604"},{"crn":"12605"},{"crn":"12606"},{"crn":"12607"},{"crn":"12608"},{"crn":"12609"},{"crn":"12610"},{"crn":"12611"},{"crn":"12612"},{"crn":"12613"},{"crn":"12614"},{"crn":"12615"},{"crn":"12616"},{"crn":"12617"},{"crn":"12618"},{"crn":"12619"},{"crn":"12620"},{"crn":"12621"},{"crn":"12622"},{"crn":"12623"},{"crn":"12624"},{"crn":"12625"},{"crn":"12626"},{"crn":"12627"},{"crn":"12628"},{"crn":"12629"},{"crn":"12630"},{"crn":"12631"},{"crn":"12632"},{"crn":"12633"},{"crn":"12634"},{"crn":"12635"},{"crn":"12636"},{"crn":"12637"},{"crn":"12638"},{"crn":"12639"},{"crn":"12640"},{"crn":"12641"},{"crn":"12642"},{"crn":"12643"},{"crn":"12644"},{"crn":"12645"},{"crn":"12646"},{"crn":"12647"},{"crn":"12648"},{"crn":"12649"},{"crn":"12650"},{"crn":"12651"},{"crn":"12652"},{"crn":"12653"},{"crn":"12654"},{"crn":"12655"},{"crn":"12656"},{"crn":"12657"},{"crn":"12658"},{"crn":"12659"},{"crn":"12660"},{"crn":"12661"},{"crn":"12662"},{"crn":"12663"},{"crn":"12664"},{"crn":"12665"},{"crn":"12666"},{"crn":"12667"},{"crn":"12668"},{"crn":"12669"},{"crn":"12670"},{"crn":"12671"},{"crn":"12672"},{"crn":"12673"},{"crn":"12674"},{"crn":"12675"},{"crn":"12676"},{"crn":"12677"},{"crn":"12678"},{"crn":"12679"},{"crn":"12680"},{"crn":"12681"},{"crn":"12682"},{"crn":"12683"},{"crn":"12684"},{"crn":"12685"},{"crn":"12686"},{"crn":"12687"},{"crn":"12688"},{"crn":"12689"},{"crn":"12690"},{"crn":"12691"},{"crn":"12692"},{"crn":"12693"},{"crn":"12694"},{"crn":"12695"},{"crn":"12696"},{"crn":"12697"},{"crn":"12698"},{"crn":"12699"},{"crn":"12700"},{"crn":"12701"},{"crn":"12702"},{"crn":"12703"},{"crn":"12704"},{"crn":"12705"},{"crn":"12706"},{"crn":"12707"},{"crn":"12708"},{"crn":"12709"},{"crn":"12710"},{"crn":"12711"},{"crn":"12712"},{"crn":"12713"},{"crn":"12714"},{"crn":"12715"},{"crn":"12716"},{"crn":"13471"},{"crn":"13569"},{"crn":"14526"},{"crn":"16016"}]},{"group":"code:PHP 2981","srcdb":"202610","sections":[{"crn":"12717"},{"crn":"12718"}]},{"group":"code:PHP 2985","srcdb":"202610","sections":[{"crn":"12719"},{"crn":"12720"},{"crn":"12721"},{"crn":"12722"},{"crn":"12723"},{"crn":"12724"},{"crn":"12725"},{"crn":"12726"},{"crn":"12727"},{"crn":"12728"},{"crn":"12729"},{"crn":"12730"},{"crn":"12731"},{"crn":"12732"},{"crn":"12733"},{"crn":"12734"},{"crn":"12735"},{"crn":"12736"},{"crn":"12737"}]}];
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
