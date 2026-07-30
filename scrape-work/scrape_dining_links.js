(() => {
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const baseUrl = "https://menus.dining.brown.edu/";
  const locations = [...document.querySelectorAll("main button[id]")].map(
    (button) => {
      const label = normalizeText(button.getAttribute("aria-label"));
      const name = normalizeText(button.id);
      const status = label.startsWith(name)
        ? normalizeText(label.slice(name.length))
        : "";
      return {
        dining_location: name,
        current_status: status,
        menu_url: baseUrl,
        menu_instructions: `Open the menu site and select ${name}`,
        source_url: baseUrl,
      };
    },
  );
  const menuNavLinks = [...document.querySelectorAll("a")]
    .filter((anchor) => /menu/i.test(anchor.textContent || ""))
    .map((anchor) => ({
      dining_location: normalizeText(anchor.textContent),
      current_status: "",
      menu_url: anchor.href,
      menu_instructions: "",
      source_url: location.href,
    }));

  return JSON.stringify({
    locations,
    menu_links: menuNavLinks,
  });
})()
