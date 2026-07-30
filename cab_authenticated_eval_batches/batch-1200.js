(() => {
  const groups = [{"group":"code:NAIS 0300","srcdb":"202610","sections":[{"crn":"15679"}]},{"group":"code:NAIS 1209","srcdb":"202610","sections":[{"crn":"16167"},{"crn":"16274"}]},{"group":"code:NAIS XLIST","srcdb":"202610","sections":[{"crn":"16062"}]},{"group":"code:NEUR 0010","srcdb":"202610","sections":[{"crn":"10065"},{"crn":"14968"},{"crn":"15820"},{"crn":"15821"},{"crn":"15822"},{"crn":"15823"},{"crn":"15824"},{"crn":"15825"},{"crn":"15826"},{"crn":"15827"},{"crn":"15828"},{"crn":"15829"},{"crn":"15830"},{"crn":"15831"}]},{"group":"code:NEUR 1030","srcdb":"202610","sections":[{"crn":"10066"},{"crn":"10067"},{"crn":"14969"},{"crn":"14970"},{"crn":"14972"},{"crn":"14973"},{"crn":"14974"},{"crn":"14975"},{"crn":"14976"},{"crn":"16105"}]},{"group":"code:NEUR 1410","srcdb":"202610","sections":[{"crn":"15762"}]},{"group":"code:NEUR 1440","srcdb":"202610","sections":[{"crn":"10068"},{"crn":"14977"}]},{"group":"code:NEUR 1530","srcdb":"202610","sections":[{"crn":"10069"},{"crn":"14978"}]},{"group":"code:NEUR 1550","srcdb":"202610","sections":[{"crn":"15544"}]},{"group":"code:NEUR 1650","srcdb":"202610","sections":[{"crn":"10071"},{"crn":"14980"}]},{"group":"code:NEUR 1900","srcdb":"202610","sections":[{"crn":"15666"}]},{"group":"code:NEUR 1930L","srcdb":"202610","sections":[{"crn":"10072"},{"crn":"14982"}]},{"group":"code:NEUR 1970","srcdb":"202610","sections":[{"crn":"12391"},{"crn":"12392"},{"crn":"12393"},{"crn":"12394"},{"crn":"12395"},{"crn":"12396"},{"crn":"12397"},{"crn":"12398"},{"crn":"12399"},{"crn":"12400"},{"crn":"12401"},{"crn":"12402"},{"crn":"12403"},{"crn":"12404"},{"crn":"12405"},{"crn":"12406"},{"crn":"12407"},{"crn":"12408"},{"crn":"12409"},{"crn":"12410"},{"crn":"12411"},{"crn":"12412"},{"crn":"12413"},{"crn":"12414"},{"crn":"12415"},{"crn":"12416"},{"crn":"12417"},{"crn":"12418"},{"crn":"12419"},{"crn":"12420"},{"crn":"12421"},{"crn":"12422"},{"crn":"12423"},{"crn":"12424"},{"crn":"12425"},{"crn":"12426"},{"crn":"12427"},{"crn":"12428"},{"crn":"12429"},{"crn":"12430"},{"crn":"12431"},{"crn":"12432"},{"crn":"12433"},{"crn":"12434"},{"crn":"12435"},{"crn":"12436"},{"crn":"12437"},{"crn":"12438"},{"crn":"12439"},{"crn":"12440"},{"crn":"12441"},{"crn":"12442"},{"crn":"12443"},{"crn":"12444"},{"crn":"12445"},{"crn":"12446"},{"crn":"12447"},{"crn":"12448"},{"crn":"12449"},{"crn":"12450"},{"crn":"12451"},{"crn":"12452"},{"crn":"12453"},{"crn":"12454"},{"crn":"12455"},{"crn":"12456"},{"crn":"14532"},{"crn":"14763"},{"crn":"16152"}]},{"group":"code:NEUR 2010","srcdb":"202610","sections":[{"crn":"10076"},{"crn":"15202"}]},{"group":"code:NEUR 2030","srcdb":"202610","sections":[{"crn":"10073"},{"crn":"14983"}]},{"group":"code:NEUR 2050","srcdb":"202610","sections":[{"crn":"10074"},{"crn":"14987"}]},{"group":"code:NEUR 2110","srcdb":"202610","sections":[{"crn":"10075"},{"crn":"15066"},{"crn":"15071"},{"crn":"15072"},{"crn":"15073"}]},{"group":"code:NEUR 2970","srcdb":"202610","sections":[{"crn":"13353"}]},{"group":"code:NEUR 2980","srcdb":"202610","sections":[{"crn":"12457"},{"crn":"12458"},{"crn":"12459"},{"crn":"12460"},{"crn":"12461"},{"crn":"12462"},{"crn":"12463"},{"crn":"12464"},{"crn":"12465"},{"crn":"12466"},{"crn":"12467"},{"crn":"12468"},{"crn":"12469"},{"crn":"12470"},{"crn":"12471"},{"crn":"12472"},{"crn":"12473"},{"crn":"12474"},{"crn":"12475"},{"crn":"12476"},{"crn":"12477"},{"crn":"12478"},{"crn":"12479"},{"crn":"12480"},{"crn":"12481"},{"crn":"12482"},{"crn":"12483"},{"crn":"13485"},{"crn":"13507"},{"crn":"13508"},{"crn":"16151"}]},{"group":"code:NEUR 2990","srcdb":"202610","sections":[{"crn":"13354"}]},{"group":"code:OBAN 2000","srcdb":"202610","sections":[{"crn":"13402"}]},{"group":"code:OBAN 2120","srcdb":"202610","sections":[{"crn":"13497"}]},{"group":"code:OMIM 2020","srcdb":"202610","sections":[{"crn":"13401"}]},{"group":"code:OMIM 2100","srcdb":"202610","sections":[{"crn":"13448"}]},{"group":"code:OMIM 2110","srcdb":"202610","sections":[{"crn":"13449"}]}];
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
