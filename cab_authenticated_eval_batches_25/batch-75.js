(() => {
  const groups = [{"group":"code:APMA 1931B","srcdb":"202610","sections":[{"crn":"15961"}]},{"group":"code:APMA 1931C","srcdb":"202610","sections":[{"crn":"14621"}]},{"group":"code:APMA 1970","srcdb":"202610","sections":[{"crn":"10279"},{"crn":"10280"},{"crn":"10281"},{"crn":"10282"},{"crn":"10283"},{"crn":"10284"},{"crn":"10285"},{"crn":"10286"},{"crn":"10287"},{"crn":"10288"},{"crn":"10289"},{"crn":"10290"},{"crn":"10291"},{"crn":"10292"},{"crn":"10293"},{"crn":"10294"},{"crn":"10295"},{"crn":"10296"},{"crn":"10297"},{"crn":"10298"},{"crn":"10299"},{"crn":"10300"}]},{"group":"code:APMA 1971","srcdb":"202610","sections":[{"crn":"10301"},{"crn":"10302"},{"crn":"10303"},{"crn":"10304"},{"crn":"10305"},{"crn":"10306"},{"crn":"10307"},{"crn":"10308"},{"crn":"10309"},{"crn":"10310"},{"crn":"10311"},{"crn":"10312"},{"crn":"10313"},{"crn":"10314"},{"crn":"10315"},{"crn":"10316"},{"crn":"10317"},{"crn":"10318"},{"crn":"10319"},{"crn":"10320"}]},{"group":"code:APMA 2110","srcdb":"202610","sections":[{"crn":"14622"}]},{"group":"code:APMA 2190","srcdb":"202610","sections":[{"crn":"14623"}]},{"group":"code:APMA 2550","srcdb":"202610","sections":[{"crn":"14624"}]},{"group":"code:APMA 2570B","srcdb":"202610","sections":[{"crn":"14625"}]},{"group":"code:APMA 2630","srcdb":"202610","sections":[{"crn":"14626"}]},{"group":"code:APMA 2670","srcdb":"202610","sections":[{"crn":"14627"}]},{"group":"code:APMA 2812K","srcdb":"202610","sections":[{"crn":"14642"}]},{"group":"code:APMA 2980","srcdb":"202610","sections":[{"crn":"10321"},{"crn":"10322"},{"crn":"10323"},{"crn":"10324"},{"crn":"10325"},{"crn":"10326"},{"crn":"10327"},{"crn":"10328"},{"crn":"10329"},{"crn":"10330"},{"crn":"10331"},{"crn":"10332"},{"crn":"10333"},{"crn":"10334"},{"crn":"10335"},{"crn":"10336"},{"crn":"10337"},{"crn":"10338"},{"crn":"10339"},{"crn":"10340"},{"crn":"10341"},{"crn":"10342"},{"crn":"10343"},{"crn":"10344"},{"crn":"10345"}]},{"group":"code:APMA 2990","srcdb":"202610","sections":[{"crn":"13281"}]},{"group":"code:APMA XLIST","srcdb":"202610","sections":[{"crn":"16012"}]},{"group":"code:ARAB 0100","srcdb":"202610","sections":[{"crn":"13436"},{"crn":"13437"},{"crn":"13438"}]},{"group":"code:ARAB 0300","srcdb":"202610","sections":[{"crn":"13562"},{"crn":"13563"}]},{"group":"code:ARAB 0500","srcdb":"202610","sections":[{"crn":"13564"}]},{"group":"code:ARAB 0700","srcdb":"202610","sections":[{"crn":"15837"}]},{"group":"code:ARAB 1990","srcdb":"202610","sections":[{"crn":"10346"},{"crn":"10347"}]},{"group":"code:ARAB 2450","srcdb":"202610","sections":[{"crn":"13283"}]},{"group":"code:ARCH 0100","srcdb":"202610","sections":[{"crn":"15432"},{"crn":"16028"},{"crn":"16029"}]},{"group":"code:ARCH 0172","srcdb":"202610","sections":[{"crn":"15996"}]},{"group":"code:ARCH 0295","srcdb":"202610","sections":[{"crn":"15981"}]},{"group":"code:ARCH 0396","srcdb":"202610","sections":[{"crn":"15997"}]},{"group":"code:ARCH 0524","srcdb":"202610","sections":[{"crn":"15998"}]}];
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
