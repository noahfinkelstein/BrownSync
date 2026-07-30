(() => {
  const groups = [{"group":"code:ARCH 0524","srcdb":"202610","sections":[{"crn":"15998"}]},{"group":"code:ARCH 0775","srcdb":"202610","sections":[{"crn":"15623"}]},{"group":"code:ARCH 1051","srcdb":"202610","sections":[{"crn":"15999"}]},{"group":"code:ARCH 1128","srcdb":"202610","sections":[{"crn":"16000"}]},{"group":"code:ARCH 1208","srcdb":"202610","sections":[{"crn":"16011"}]},{"group":"code:ARCH 1272","srcdb":"202610","sections":[{"crn":"16008"}]},{"group":"code:ARCH 1273","srcdb":"202610","sections":[{"crn":"16009"}]},{"group":"code:ARCH 1544","srcdb":"202610","sections":[{"crn":"16002"}]},{"group":"code:ARCH 1626","srcdb":"202610","sections":[{"crn":"16004"}]},{"group":"code:ARCH 1634","srcdb":"202610","sections":[{"crn":"16005"}]},{"group":"code:ARCH 1773","srcdb":"202610","sections":[{"crn":"15709"}]},{"group":"code:ARCH 1775","srcdb":"202610","sections":[{"crn":"15428"}]},{"group":"code:ARCH 1845","srcdb":"202610","sections":[{"crn":"15513"}]},{"group":"code:ARCH 1872","srcdb":"202610","sections":[{"crn":"16006"}]},{"group":"code:ARCH 1886","srcdb":"202610","sections":[{"crn":"16059"}]},{"group":"code:ARCH 1891","srcdb":"202610","sections":[{"crn":"16007"}]},{"group":"code:ARCH 1900","srcdb":"202610","sections":[{"crn":"15424"},{"crn":"15425"}]},{"group":"code:ARCH 1970","srcdb":"202610","sections":[{"crn":"10348"},{"crn":"10349"},{"crn":"10350"},{"crn":"10351"},{"crn":"10352"},{"crn":"10353"},{"crn":"10354"},{"crn":"13517"},{"crn":"13518"}]},{"group":"code:ARCH 1990","srcdb":"202610","sections":[{"crn":"10355"},{"crn":"10356"},{"crn":"10357"},{"crn":"10358"},{"crn":"10359"},{"crn":"10360"},{"crn":"10361"},{"crn":"10362"}]},{"group":"code:ARCH 2112","srcdb":"202610","sections":[{"crn":"16003"}]},{"group":"code:ARCH 2153","srcdb":"202610","sections":[{"crn":"16103"}]},{"group":"code:ARCH 2157","srcdb":"202610","sections":[{"crn":"15427"}]},{"group":"code:ARCH 2858","srcdb":"202610","sections":[{"crn":"16010"}]},{"group":"code:ARCH 2950","srcdb":"202610","sections":[{"crn":"10363"}]},{"group":"code:ARCH 2970","srcdb":"202610","sections":[{"crn":"10364"},{"crn":"10365"},{"crn":"10366"},{"crn":"10367"},{"crn":"10368"},{"crn":"10369"},{"crn":"10370"},{"crn":"10371"},{"crn":"10372"}]}];
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
