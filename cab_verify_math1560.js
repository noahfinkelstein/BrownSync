(() =>
  fose.detailsAPI.fetchFor("code:MATH 1560", "crn:14494", "crn:14494", "202610").then((detail) =>
    JSON.stringify({
      code: detail.code,
      crn: detail.crn,
      meetingHtml: detail.meeting_html,
    }),
  ))();
