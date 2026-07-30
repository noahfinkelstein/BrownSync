(() => {
  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const xmlText = document.body?.innerText || "";
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const sourceUrl = "https://www.browndailyherald.com/feed";
  const items = [...xml.querySelectorAll("channel > item")].map((item) => {
    const categories = [...item.querySelectorAll("category")]
      .map((category) => normalizeText(category.textContent))
      .filter(Boolean);
    const descriptionHtml =
      item.querySelector("description")?.textContent || "";
    const descriptionDocument = new DOMParser().parseFromString(
      descriptionHtml,
      "text/html",
    );
    const media =
      item.querySelector("content[url]") ||
      item.querySelector("thumbnail[url]") ||
      item.querySelector("[url][type^='image']");
    const summaryText = normalizeText(
      descriptionDocument.body?.textContent,
    );
    return {
      title: normalizeText(item.querySelector("title")?.textContent),
      categories: [...new Set(categories)].join(" | "),
      author: normalizeText(item.querySelector("author")?.textContent),
      published_at: normalizeText(item.querySelector("pubDate")?.textContent),
      article_url: normalizeText(
        item.querySelector("link")?.textContent ||
          item.querySelector("guid")?.textContent,
      ),
      summary_excerpt:
        summaryText.length > 500
          ? `${summaryText.slice(0, 497).trimEnd()}...`
          : summaryText,
      image_url: media?.getAttribute("url") || "",
      source_url: sourceUrl,
    };
  });
  return JSON.stringify({
    feed_title: normalizeText(xml.querySelector("channel > title")?.textContent),
    last_build_date: normalizeText(
      xml.querySelector("channel > lastBuildDate")?.textContent,
    ),
    items,
  });
})()
