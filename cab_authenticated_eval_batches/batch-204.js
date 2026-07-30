(() => {
  const groups = [{"group":"code:BIOL 2580","srcdb":"202610","sections":[{"crn":"15708"}]},{"group":"code:BIOL 2610","srcdb":"202610","sections":[{"crn":"14665"}]},{"group":"code:BIOL 2970","srcdb":"202610","sections":[{"crn":"13287"}]},{"group":"code:BIOL 2980","srcdb":"202610","sections":[{"crn":"10845"},{"crn":"10846"},{"crn":"10847"},{"crn":"10848"},{"crn":"10849"},{"crn":"10850"},{"crn":"10851"},{"crn":"10852"},{"crn":"10853"},{"crn":"10854"},{"crn":"10855"},{"crn":"10856"},{"crn":"10857"},{"crn":"10858"},{"crn":"10859"},{"crn":"10860"},{"crn":"10861"},{"crn":"10862"},{"crn":"10863"},{"crn":"10864"},{"crn":"10865"},{"crn":"10866"},{"crn":"10867"},{"crn":"10868"},{"crn":"10869"},{"crn":"10870"},{"crn":"10871"},{"crn":"10872"},{"crn":"10873"},{"crn":"10874"},{"crn":"10875"},{"crn":"10876"},{"crn":"10877"},{"crn":"10878"},{"crn":"10879"},{"crn":"10880"},{"crn":"10881"},{"crn":"10882"},{"crn":"10883"},{"crn":"10884"},{"crn":"10885"},{"crn":"10886"},{"crn":"10887"},{"crn":"10888"},{"crn":"10889"},{"crn":"10890"},{"crn":"10891"},{"crn":"10892"},{"crn":"10893"},{"crn":"10894"},{"crn":"10895"},{"crn":"10896"},{"crn":"10897"},{"crn":"10898"},{"crn":"10899"},{"crn":"10900"},{"crn":"10901"},{"crn":"10902"},{"crn":"10903"},{"crn":"10904"},{"crn":"10905"},{"crn":"10906"},{"crn":"10907"},{"crn":"10908"},{"crn":"10909"},{"crn":"10910"},{"crn":"10911"},{"crn":"10912"},{"crn":"10913"},{"crn":"10914"},{"crn":"10915"},{"crn":"10916"},{"crn":"10917"},{"crn":"10918"},{"crn":"10919"},{"crn":"10920"},{"crn":"10921"},{"crn":"10922"},{"crn":"10923"},{"crn":"10924"},{"crn":"10925"},{"crn":"10926"},{"crn":"10927"},{"crn":"10928"},{"crn":"10929"},{"crn":"10930"},{"crn":"10931"},{"crn":"10932"},{"crn":"10933"},{"crn":"10934"},{"crn":"10935"},{"crn":"10936"},{"crn":"10937"},{"crn":"10938"},{"crn":"10939"},{"crn":"10940"},{"crn":"10941"},{"crn":"10942"},{"crn":"10943"},{"crn":"10944"},{"crn":"10945"},{"crn":"10946"},{"crn":"10947"},{"crn":"10948"},{"crn":"10949"},{"crn":"10950"},{"crn":"10951"},{"crn":"10952"},{"crn":"10953"},{"crn":"10954"},{"crn":"10955"},{"crn":"10956"},{"crn":"10957"},{"crn":"10958"},{"crn":"10959"},{"crn":"10960"},{"crn":"10961"},{"crn":"10962"},{"crn":"10963"},{"crn":"10964"},{"crn":"10965"},{"crn":"10966"},{"crn":"10967"},{"crn":"10968"},{"crn":"10969"},{"crn":"10970"},{"crn":"10971"},{"crn":"10972"},{"crn":"13463"},{"crn":"13484"},{"crn":"13503"},{"crn":"13532"},{"crn":"13573"},{"crn":"14317"},{"crn":"14318"},{"crn":"14319"},{"crn":"14320"},{"crn":"14528"},{"crn":"14531"},{"crn":"16141"},{"crn":"16176"}]}];
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
