(() => {
  const totalText = document.body.textContent || "";
  const totalMatch = totalText.match(/([\d,]+)\s+Results based on/i);
  const totalResults = totalMatch
    ? Number(totalMatch[1].replaceAll(",", ""))
    : 0;
  const perPage = document.querySelectorAll("main article").length || 50;
  const pageCount = Math.ceil(totalResults / perPage);
  const pageUrls = Array.from(
    { length: pageCount },
    (_, page) => `https://www.brown.edu/news/all?page=${page}`,
  );

  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const parsePage = (html, pageUrl) => {
    const documentCopy = new DOMParser().parseFromString(html, "text/html");
    return [...documentCopy.querySelectorAll("main article")].map((article) => {
      const link =
        article.querySelector(".component_title_link") ||
        article.querySelector(".component_figure_link");
      const background = article.querySelector("[data-background-options]");
      let imageUrl = "";
      let imageAlt = "";
      if (background) {
        try {
          const options = JSON.parse(
            background.getAttribute("data-background-options") || "{}",
          );
          const sources = options.source || {};
          imageUrl = Object.values(sources)[0] || "";
          imageAlt = normalizeText(options.alt);
        } catch {
          imageUrl = "";
        }
      }
      const innerTime = article.querySelector("time[datetime]");
      return {
        content_id: article.dataset.id || "",
        title: normalizeText(
          article.querySelector(".component_title")?.textContent ||
            link?.textContent,
        ),
        category: normalizeText(
          article.querySelector(".component_label_pre")?.textContent,
        ),
        published_at: innerTime?.getAttribute("datetime") || "",
        published_date: normalizeText(innerTime?.textContent),
        article_url: link
          ? new URL(link.getAttribute("href"), pageUrl).href
          : "",
        image_url: imageUrl
          ? new URL(imageUrl, "https://www.brown.edu/").href
          : "",
        image_alt: imageAlt,
        archive_page_url: pageUrl,
        archive_source_url: "https://www.brown.edu/news/all",
      };
    });
  };

  const results = [];
  const starts = Array.from(
    { length: Math.ceil(pageUrls.length / 8) },
    (_, index) => index * 8,
  );

  return starts
    .reduce(
      (previous, start) =>
        previous
          .then(() =>
            Promise.all(
              pageUrls.slice(start, start + 8).map((pageUrl) =>
                fetch(pageUrl)
                  .then((response) => {
                    if (!response.ok) {
                      throw new Error(
                        `${pageUrl}: HTTP ${response.status}`,
                      );
                    }
                    return response.text();
                  })
                  .then((html) => parsePage(html, pageUrl)),
              ),
            ),
          )
          .then((pages) => results.push(...pages.flat())),
      Promise.resolve(),
    )
    .then(() =>
      JSON.stringify({
        expected_count: totalResults,
        page_count: pageCount,
        items: results,
      }),
    );
})()
