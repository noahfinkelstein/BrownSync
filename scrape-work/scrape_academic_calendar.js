(() => {
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const main = document.querySelector("main");
  let term = "";
  let month = "";
  const items = [];

  for (const element of main?.querySelectorAll("h2, h3, article") || []) {
    if (element.matches("h2")) {
      term = normalizeText(element.textContent);
      month = "";
      continue;
    }
    if (element.matches("h3") && !element.closest("article")) {
      month = normalizeText(element.textContent);
      continue;
    }
    const title = normalizeText(element.querySelector("h3")?.textContent);
    const startDate = normalizeText(
      element.querySelector("time")?.textContent,
    );
    const dateElements = [
      ...element.querySelectorAll(".component_date_time .component_date"),
    ];
    const endDate = normalizeText(dateElements[1]?.textContent).replace(
      /^until\s+/i,
      "",
    );
    const eventLink = element.querySelector(".component_title_link");
    if (title || startDate) {
      items.push({
        academic_term: term,
        month,
        start_date_display: startDate,
        end_date_display: endDate,
        event: title,
        event_url: eventLink?.href || "",
        source_url: location.href,
      });
    }
  }

  return JSON.stringify(items);
})()
