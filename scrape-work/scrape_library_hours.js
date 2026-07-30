(() => {
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const table = document.querySelector("main table.s-lc-whw");
  const dates = [...(table?.querySelectorAll("thead th[id^='s-lc-whw-date-']") || [])].map(
    (header) => {
      const compact = header.id.replace("s-lc-whw-date-", "");
      return {
        date: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`,
        day: normalizeText(header.textContent).replace(
          normalizeText(header.querySelector(".s-lc-whw-head-date")?.textContent),
          "",
        ).trim(),
      };
    },
  );
  const sourceUrl = location.href;
  const items = [];
  for (const row of table?.querySelectorAll("tbody tr") || []) {
    const nameCell = row.querySelector("th");
    const name = normalizeText(nameCell?.textContent);
    const locationUrl = nameCell?.querySelector("a[href]")?.href || sourceUrl;
    const hoursCells = [...row.querySelectorAll("td")];
    dates.forEach((dateInfo, index) => {
      items.push({
        location: name,
        date: dateInfo.date,
        day_of_week: dateInfo.day,
        hours: normalizeText(hoursCells[index]?.textContent),
        location_url: locationUrl,
        source_url: sourceUrl,
        snapshot_note:
          "Weekly display captured from Brown Library; hours are subject to change.",
      });
    });
  }
  return JSON.stringify(items);
})()
