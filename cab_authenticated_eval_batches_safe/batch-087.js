(() => {
  const groups = [{"group":"code:PHP 2981","srcdb":"202610","sections":[{"crn":"12717"},{"crn":"12718"}]},{"group":"code:PHP 2985","srcdb":"202610","sections":[{"crn":"12719"},{"crn":"12720"},{"crn":"12721"},{"crn":"12722"},{"crn":"12723"},{"crn":"12724"},{"crn":"12725"},{"crn":"12726"},{"crn":"12727"},{"crn":"12728"},{"crn":"12729"},{"crn":"12730"},{"crn":"12731"},{"crn":"12732"},{"crn":"12733"},{"crn":"12734"},{"crn":"12735"},{"crn":"12736"},{"crn":"12737"}]},{"group":"code:PHP 2988","srcdb":"202610","sections":[{"crn":"12738"},{"crn":"12739"},{"crn":"12740"},{"crn":"12741"},{"crn":"12742"},{"crn":"12743"},{"crn":"12744"},{"crn":"12745"},{"crn":"12746"},{"crn":"12747"},{"crn":"12748"},{"crn":"12749"},{"crn":"12750"},{"crn":"12751"},{"crn":"12752"},{"crn":"12753"},{"crn":"12754"},{"crn":"12755"},{"crn":"12756"},{"crn":"12757"},{"crn":"12758"},{"crn":"12759"},{"crn":"12760"},{"crn":"12761"},{"crn":"12762"}]},{"group":"code:PHP 2990","srcdb":"202610","sections":[{"crn":"13361"}]},{"group":"code:PHUM 2010","srcdb":"202610","sections":[{"crn":"15285"}]},{"group":"code:PHUM 2011","srcdb":"202610","sections":[{"crn":"16288"}]},{"group":"code:PHUM 2018","srcdb":"202610","sections":[{"crn":"16337"}]},{"group":"code:PHUM 2060","srcdb":"202610","sections":[{"crn":"12763"},{"crn":"12764"},{"crn":"12765"}]},{"group":"code:PHUM 2065","srcdb":"202610","sections":[{"crn":"12766"},{"crn":"12767"},{"crn":"12768"},{"crn":"12769"},{"crn":"12770"},{"crn":"12771"}]},{"group":"code:PHUM XLIST","srcdb":"202610","sections":[{"crn":"10145"}]},{"group":"code:PHYS 0030","srcdb":"202610","sections":[{"crn":"10044"},{"crn":"10045"},{"crn":"10111"},{"crn":"10112"},{"crn":"13904"},{"crn":"13905"},{"crn":"13906"},{"crn":"13907"},{"crn":"13908"},{"crn":"13909"},{"crn":"13910"},{"crn":"13911"},{"crn":"13912"},{"crn":"13913"},{"crn":"13914"},{"crn":"13915"}]},{"group":"code:PHYS 0040","srcdb":"202610","sections":[{"crn":"10046"},{"crn":"13917"},{"crn":"13918"},{"crn":"13919"}]},{"group":"code:PHYS 0050","srcdb":"202610","sections":[{"crn":"10047"},{"crn":"13920"},{"crn":"13921"},{"crn":"13922"},{"crn":"13923"},{"crn":"13924"},{"crn":"13925"},{"crn":"13926"}]},{"group":"code:PHYS 0070","srcdb":"202610","sections":[{"crn":"10048"},{"crn":"13927"},{"crn":"13928"},{"crn":"13929"},{"crn":"13930"},{"crn":"13931"},{"crn":"13932"},{"crn":"13933"}]},{"group":"code:PHYS 0270","srcdb":"202610","sections":[{"crn":"10049"}]}];
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
