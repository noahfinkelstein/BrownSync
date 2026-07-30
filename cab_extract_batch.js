(() => {
  const batchStart = Number(localStorage.getItem("cab_batch_start") || "0");
  const batchSize = Number(localStorage.getItem("cab_batch_size") || "200");
  const allRequests = [
    ...new Map(
      [...document.querySelectorAll('[data-action="result-detail"].result__link')]
        .flatMap((anchor) =>
          (anchor.dataset.matched || anchor.dataset.key || "")
            .split(",")
            .filter(Boolean)
            .map((key) => ({
              group: anchor.dataset.group,
              key,
              matched: key,
              srcdb: anchor.dataset.srcdb || "202610",
            })),
        )
        .map((request) => [`${request.group}|${request.key}`, request]),
    ).values(),
  ];
  const requests = allRequests.slice(batchStart, batchStart + batchSize);
  const rows = [];

  const project = (detail, request) => {
    const requestedCrn = request.key.replace(/^crn:/, "");
    const groupRow =
      (detail.allInGroup || []).find((section) => String(section.crn) === requestedCrn) || {};
    const meetingContainer = document.createElement("div");
    meetingContainer.innerHTML = detail.meeting_html || "";
    const htmlText = (meetingContainer.textContent || "").replace(/\s+/g, " ").trim();

    return {
      term: "Fall 2026",
      term_code: request.srcdb,
      course_code: detail.code || groupRow.code || request.group.replace(/^code:/, ""),
      course_title: detail.title || groupRow.title || "",
      section: detail.section ?? groupRow.no ?? "",
      crn: detail.crn || groupRow.crn || requestedCrn,
      schedule_and_location: htmlText || groupRow.meets || "",
      meeting_html: detail.meeting_html || "",
      instructor: groupRow.instr || "",
      schedule_type: groupRow.schd || detail.schd || "",
      class_status: groupRow.stat || detail.stat || "",
      cancelled: Boolean(groupRow.isCancelled || detail.isCancelled),
      start_date: groupRow.start_date || "",
      end_date: groupRow.end_date || "",
      source_url: "https://cab.brown.edu/",
    };
  };

  const starts = Array.from({ length: Math.ceil(requests.length / 8) }, (_, index) => index * 8);

  return starts
    .reduce(
      (previous, start) =>
        previous
          .then(() =>
            Promise.all(
              requests.slice(start, start + 8).map((request) =>
                fose.detailsAPI
                  .fetchFor(request.group, request.key, request.matched, request.srcdb)
                  .then((detail) => project(detail, request))
                  .catch((error) => ({
                    term: "Fall 2026",
                    term_code: request.srcdb,
                    course_code: request.group.replace(/^code:/, ""),
                    course_title: "",
                    section: "",
                    crn: request.key.replace(/^crn:/, ""),
                    schedule_and_location: "",
                    meeting_html: "",
                    instructor: "",
                    schedule_type: "",
                    class_status: "",
                    cancelled: false,
                    start_date: "",
                    end_date: "",
                    source_url: "https://cab.brown.edu/",
                    error: String(error),
                  })),
              ),
            ),
          )
          .then((batch) => {
            rows.push(...batch);
          }),
      Promise.resolve(),
    )
    .then(() => JSON.stringify(rows));
})();
