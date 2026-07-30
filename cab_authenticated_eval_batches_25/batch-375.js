(() => {
  const groups = [{"group":"code:CSCI 2640","srcdb":"202610","sections":[{"crn":"14279"},{"crn":"15954"}]},{"group":"code:CSCI 2670","srcdb":"202610","sections":[{"crn":"14280"}]},{"group":"code:CSCI 2810","srcdb":"202610","sections":[{"crn":"14282"}]},{"group":"code:CSCI 2890","srcdb":"202610","sections":[{"crn":"13300"}]},{"group":"code:CSCI 2951X","srcdb":"202610","sections":[{"crn":"16026"}]},{"group":"code:CSCI 2952C","srcdb":"202610","sections":[{"crn":"14284"}]},{"group":"code:CSCI 2952L","srcdb":"202610","sections":[{"crn":"15634"}]},{"group":"code:CSCI 2952X","srcdb":"202610","sections":[{"crn":"14286"}]},{"group":"code:CSCI 2952Y","srcdb":"202610","sections":[{"crn":"15687"}]},{"group":"code:CSCI 2953B","srcdb":"202610","sections":[{"crn":"14926"}]},{"group":"code:CSCI 2980","srcdb":"202610","sections":[{"crn":"11451"},{"crn":"11452"},{"crn":"11453"},{"crn":"11454"},{"crn":"11455"},{"crn":"11456"},{"crn":"11457"},{"crn":"11458"},{"crn":"11459"},{"crn":"11460"},{"crn":"11461"},{"crn":"11462"},{"crn":"11463"},{"crn":"11464"},{"crn":"11465"},{"crn":"11466"},{"crn":"11467"},{"crn":"11468"},{"crn":"11469"},{"crn":"11470"},{"crn":"11471"},{"crn":"11472"},{"crn":"11473"},{"crn":"11474"},{"crn":"11475"},{"crn":"11476"},{"crn":"11477"},{"crn":"11478"},{"crn":"11479"},{"crn":"11480"},{"crn":"11481"},{"crn":"11482"},{"crn":"11483"},{"crn":"11484"},{"crn":"11485"},{"crn":"11486"},{"crn":"11487"},{"crn":"11488"},{"crn":"11489"},{"crn":"11490"},{"crn":"11491"},{"crn":"11492"},{"crn":"11493"},{"crn":"11494"},{"crn":"11495"},{"crn":"11496"},{"crn":"11497"},{"crn":"11498"},{"crn":"11499"},{"crn":"11500"},{"crn":"11501"},{"crn":"11502"},{"crn":"11503"},{"crn":"11504"},{"crn":"11505"},{"crn":"11506"},{"crn":"11507"},{"crn":"11508"},{"crn":"11509"},{"crn":"11510"},{"crn":"11511"},{"crn":"11512"},{"crn":"11513"},{"crn":"11514"},{"crn":"11515"},{"crn":"11516"},{"crn":"11517"},{"crn":"11518"},{"crn":"11519"},{"crn":"15811"},{"crn":"16255"}]},{"group":"code:CSCI 2990","srcdb":"202610","sections":[{"crn":"13301"}]},{"group":"code:CSCI 2999A","srcdb":"202610","sections":[{"crn":"14288"},{"crn":"15940"}]},{"group":"code:CZCH 0100","srcdb":"202610","sections":[{"crn":"14308"},{"crn":"14309"}]},{"group":"code:DATA 0080","srcdb":"202610","sections":[{"crn":"14681"}]},{"group":"code:DATA 0150","srcdb":"202610","sections":[{"crn":"15268"}]},{"group":"code:DATA 1030","srcdb":"202610","sections":[{"crn":"14835"}]},{"group":"code:DATA 1050","srcdb":"202610","sections":[{"crn":"14959"}]},{"group":"code:DATA 1150","srcdb":"202610","sections":[{"crn":"14957"}]},{"group":"code:DATA 1250","srcdb":"202610","sections":[{"crn":"15641"}]},{"group":"code:DATA 1954S","srcdb":"202610","sections":[{"crn":"15860"}]},{"group":"code:DATA 2060","srcdb":"202610","sections":[{"crn":"14686"}]},{"group":"code:DATA 2450","srcdb":"202610","sections":[{"crn":"13302"}]},{"group":"code:DATA 2980","srcdb":"202610","sections":[{"crn":"11520"}]},{"group":"code:DSIO 2000","srcdb":"202610","sections":[{"crn":"13409"}]}];
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
