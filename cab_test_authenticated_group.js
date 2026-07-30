(() => {
  const sections = ["15141"];
  const rows = [];

  return sections
    .reduce(
      (previous, crn) =>
        previous.then(() =>
          fose.detailsAPI
            .fetchFor("code:AFRI 0090", `crn:${crn}`, `crn:${crn}`, "202610")
            .then((detail) => {
              rows.push({
                crn: detail.crn,
                meeting_html: detail.meeting_html,
              });
            }),
        ),
      Promise.resolve(),
    )
    .then(() => JSON.stringify(rows));
})();
