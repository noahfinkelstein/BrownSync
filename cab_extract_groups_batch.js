(() => {
  const batchStart = Number(localStorage.getItem("cab_group_batch_start") || "0");
  const batchSize = Number(localStorage.getItem("cab_group_batch_size") || "100");
  const requests = [
    ...new Map(
      [...document.querySelectorAll('[data-action="result-detail"].result__link')]
        .map((anchor) => ({
          group: anchor.dataset.group,
          key: anchor.dataset.key || "",
          matched: anchor.dataset.matched || "",
          srcdb: anchor.dataset.srcdb || "202610",
        }))
        .map((request) => [`${request.group}|${request.srcdb}`, request]),
    ).values(),
  ].slice(batchStart, batchStart + batchSize);
  const groups = [];

  const project = (detail, request) => ({
    term: "Fall 2026",
    term_code: request.srcdb,
    course_code: detail.code || request.group.replace(/^code:/, ""),
    course_title: detail.title || "",
    selected_crn: detail.crn || "",
    selected_meeting_html: detail.meeting_html || "",
    sections: (detail.allInGroup || []).map((section) => ({
      section: section.no || "",
      crn: section.crn || "",
      course_code: section.code || detail.code || "",
      course_title: section.title || detail.title || "",
      schedule_and_location: section.meets || "",
      instructor: section.instr || "",
      schedule_type: section.schd || "",
      class_status: section.stat || "",
      cancelled: Boolean(section.isCancelled),
      start_date: section.start_date || "",
      end_date: section.end_date || "",
    })),
    source_url: "https://cab.brown.edu/",
  });

  const starts = Array.from({ length: Math.ceil(requests.length / 4) }, (_, index) => index * 4);

  return starts
    .reduce(
      (previous, start) =>
        previous
          .then(() =>
            Promise.all(
              requests.slice(start, start + 4).map((request) =>
                fose.detailsAPI
                  .fetchFor(request.group, request.key, request.matched, request.srcdb)
                  .then((detail) => project(detail, request))
                  .catch((error) => ({
                    term: "Fall 2026",
                    term_code: request.srcdb,
                    course_code: request.group.replace(/^code:/, ""),
                    course_title: "",
                    selected_crn: "",
                    selected_meeting_html: "",
                    sections: [],
                    source_url: "https://cab.brown.edu/",
                    error: String(error),
                  })),
              ),
            ),
          )
          .then((batch) => {
            groups.push(...batch);
          }),
      Promise.resolve(),
    )
    .then(() => JSON.stringify(groups));
})();
