(() => {
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const seen = new Set();
  const items = [...document.querySelectorAll("main a[href]")]
    .map((anchor) => ({
      dining_location: "Brown Faculty Club",
      menu_name: normalizeText(anchor.textContent),
      menu_url: anchor.href,
      menu_instructions: "",
      source_url: location.href,
    }))
    .filter(
      (item) =>
        /menu|breakfast|lunch|luncheon|dinner|brunch/i.test(item.menu_name) &&
        !seen.has(item.menu_url) &&
        seen.add(item.menu_url),
    );
  return JSON.stringify(items);
})()
