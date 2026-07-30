(() => {
  const groups = [{"group":"code:ANTH 1970","srcdb":"202610","sections":[{"crn":"10242"},{"crn":"10243"},{"crn":"10244"},{"crn":"10245"},{"crn":"10246"},{"crn":"10247"},{"crn":"10248"},{"crn":"10249"},{"crn":"10250"},{"crn":"10251"},{"crn":"10252"},{"crn":"10253"},{"crn":"10254"},{"crn":"10255"},{"crn":"10256"},{"crn":"10257"},{"crn":"10258"},{"crn":"16153"}]},{"group":"code:ANTH 2001","srcdb":"202610","sections":[{"crn":"16339"}]},{"group":"code:ANTH 2045","srcdb":"202610","sections":[{"crn":"13728"}]},{"group":"code:ANTH 2060","srcdb":"202610","sections":[{"crn":"13730"}]},{"group":"code:ANTH 2150","srcdb":"202610","sections":[{"crn":"14382"}]},{"group":"code:ANTH 2202","srcdb":"202610","sections":[{"crn":"14648"}]},{"group":"code:ANTH 2253","srcdb":"202610","sections":[{"crn":"15852"}]},{"group":"code:ANTH 2970","srcdb":"202610","sections":[{"crn":"13278"}]},{"group":"code:ANTH 2980","srcdb":"202610","sections":[{"crn":"10259"},{"crn":"10260"},{"crn":"10261"},{"crn":"10262"},{"crn":"10263"},{"crn":"10264"},{"crn":"10265"},{"crn":"10266"},{"crn":"10267"},{"crn":"10268"},{"crn":"10269"},{"crn":"10270"},{"crn":"10271"},{"crn":"10272"},{"crn":"10273"},{"crn":"10274"},{"crn":"10275"},{"crn":"10276"},{"crn":"10277"},{"crn":"10278"},{"crn":"16154"}]},{"group":"code:ANTH 2990","srcdb":"202610","sections":[{"crn":"13279"}]},{"group":"code:APMA 0160","srcdb":"202610","sections":[{"crn":"14596"}]},{"group":"code:APMA 0200","srcdb":"202610","sections":[{"crn":"14597"}]},{"group":"code:APMA 0260","srcdb":"202610","sections":[{"crn":"14598"},{"crn":"14600"},{"crn":"14601"}]},{"group":"code:APMA 0350","srcdb":"202610","sections":[{"crn":"14599"}]},{"group":"code:APMA 0355","srcdb":"202610","sections":[{"crn":"14602"},{"crn":"14603"},{"crn":"14604"},{"crn":"14605"}]},{"group":"code:APMA 0360","srcdb":"202610","sections":[{"crn":"14606"}]},{"group":"code:APMA 0365","srcdb":"202610","sections":[{"crn":"14607"},{"crn":"14608"},{"crn":"14609"},{"crn":"14610"}]},{"group":"code:APMA 0650","srcdb":"202610","sections":[{"crn":"14611"}]},{"group":"code:APMA 1080","srcdb":"202610","sections":[{"crn":"14612"}]},{"group":"code:APMA 1170","srcdb":"202610","sections":[{"crn":"14613"}]},{"group":"code:APMA 1210","srcdb":"202610","sections":[{"crn":"14614"}]},{"group":"code:APMA 1330","srcdb":"202610","sections":[{"crn":"14615"}]},{"group":"code:APMA 1650","srcdb":"202610","sections":[{"crn":"14616"}]},{"group":"code:APMA 1655","srcdb":"202610","sections":[{"crn":"14617"}]},{"group":"code:APMA 1690","srcdb":"202610","sections":[{"crn":"14618"}]}];
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
