(() => {
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const sourceUrl = location.href;
  const groups = [
    ...document.querySelectorAll(
      ".wp-block-group.has-background.is-layout-constrained",
    ),
  ]
    .map((container) => {
      const name = normalizeText(
        container.querySelector(
          "p.has-medium-font-size strong, p:first-child strong",
        )?.textContent,
      );
      const paragraphs = [...container.querySelectorAll(":scope > p")];
      const fieldParagraph = (label) =>
        paragraphs.find((paragraph) =>
          normalizeText(
            paragraph.querySelector(":scope > strong")?.textContent,
          )
            .toLowerCase()
            .startsWith(label.toLowerCase()),
        );
      const valueAfterLabel = (paragraph, label) =>
        normalizeText(paragraph?.textContent).replace(
          new RegExp(`^${label}:?\\s*`, "i"),
          "",
        );
      const descriptionParagraph = fieldParagraph("Description");
      const contactParagraph = fieldParagraph("Contact");
      const websiteParagraph = fieldParagraph("Website");
      const emails = [
        ...container.querySelectorAll("a[href^='mailto:']"),
      ].map((anchor) =>
        normalizeText(anchor.getAttribute("href")).replace(/^mailto:/i, ""),
      );
      const websiteAnchor = websiteParagraph?.querySelector("a[href]");
      const rawWebsite = valueAfterLabel(websiteParagraph, "Website");
      return {
        name,
        group_type: "Graduate student group",
        description: valueAfterLabel(
          descriptionParagraph,
          "Description",
        ),
        contact_emails: [...new Set(emails)].join(" | "),
        contact_display: valueAfterLabel(contactParagraph, "Contact"),
        website_url:
          websiteAnchor?.href ||
          (/^https?:\/\//i.test(rawWebsite) ? rawWebsite : ""),
        directory_source_url: sourceUrl,
      };
    })
    .filter((group) => group.name);

  return JSON.stringify(groups);
})()
