(() => {
  const groups = [{"group":"code:CPSY 1980","srcdb":"202610","sections":[{"crn":"11142"},{"crn":"11143"},{"crn":"11144"},{"crn":"11145"},{"crn":"11146"},{"crn":"11147"},{"crn":"11148"},{"crn":"11149"},{"crn":"11150"},{"crn":"11151"},{"crn":"11152"},{"crn":"11153"},{"crn":"11154"},{"crn":"11155"},{"crn":"11156"},{"crn":"11158"},{"crn":"11159"},{"crn":"11160"},{"crn":"11161"},{"crn":"11162"},{"crn":"11164"},{"crn":"11165"},{"crn":"11166"},{"crn":"11168"},{"crn":"11169"},{"crn":"11170"},{"crn":"11174"},{"crn":"11175"},{"crn":"11176"},{"crn":"11179"},{"crn":"11184"},{"crn":"11185"},{"crn":"11187"},{"crn":"11190"},{"crn":"11191"},{"crn":"11192"},{"crn":"11193"},{"crn":"11194"},{"crn":"11195"},{"crn":"11196"},{"crn":"11197"},{"crn":"11198"},{"crn":"14886"}]},{"group":"code:CPSY 2091","srcdb":"202610","sections":[{"crn":"11200"},{"crn":"11201"},{"crn":"11202"},{"crn":"11203"},{"crn":"11204"},{"crn":"11205"},{"crn":"11206"},{"crn":"11207"},{"crn":"11208"},{"crn":"11209"},{"crn":"11210"},{"crn":"11211"},{"crn":"11212"},{"crn":"11213"},{"crn":"11214"},{"crn":"11215"},{"crn":"11216"},{"crn":"11217"},{"crn":"11218"},{"crn":"11219"},{"crn":"11220"},{"crn":"11221"},{"crn":"11222"},{"crn":"11223"},{"crn":"11224"},{"crn":"11225"},{"crn":"11226"},{"crn":"11227"},{"crn":"11228"},{"crn":"11229"},{"crn":"11230"}]},{"group":"code:CPSY 2095","srcdb":"202610","sections":[{"crn":"11231"},{"crn":"11232"},{"crn":"11233"},{"crn":"11234"},{"crn":"11235"},{"crn":"11236"},{"crn":"11237"},{"crn":"11238"},{"crn":"11239"},{"crn":"11240"},{"crn":"11241"},{"crn":"11242"},{"crn":"11243"},{"crn":"11244"},{"crn":"11245"},{"crn":"11246"},{"crn":"11247"},{"crn":"11248"},{"crn":"11249"},{"crn":"11250"},{"crn":"11251"},{"crn":"11252"},{"crn":"11253"},{"crn":"11254"},{"crn":"11255"},{"crn":"11256"},{"crn":"11257"},{"crn":"11258"},{"crn":"11259"},{"crn":"11260"},{"crn":"11261"},{"crn":"11262"}]},{"group":"code:CPSY 2096","srcdb":"202610","sections":[{"crn":"11263"},{"crn":"11264"},{"crn":"11265"},{"crn":"11266"},{"crn":"11267"},{"crn":"11268"},{"crn":"11269"},{"crn":"11270"},{"crn":"11271"},{"crn":"11272"},{"crn":"11273"},{"crn":"11274"},{"crn":"11275"},{"crn":"11276"},{"crn":"11277"},{"crn":"11278"},{"crn":"11279"},{"crn":"11280"},{"crn":"11281"},{"crn":"11282"},{"crn":"11283"},{"crn":"11284"},{"crn":"11285"},{"crn":"11286"},{"crn":"11287"},{"crn":"11288"},{"crn":"11289"},{"crn":"11290"},{"crn":"11291"},{"crn":"11292"},{"crn":"11293"},{"crn":"13567"},{"crn":"13568"},{"crn":"14393"}]}];
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
