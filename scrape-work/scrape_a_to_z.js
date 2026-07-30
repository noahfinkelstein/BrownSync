(() => {
  const totalText = document.body.textContent || "";
  const totalMatch = totalText.match(/([\d,]+)\s+Results based on/i);
  const totalResults = totalMatch
    ? Number(totalMatch[1].replaceAll(",", ""))
    : 0;
  const perPage = document.querySelectorAll("main article").length || 25;
  const pageCount = Math.ceil(totalResults / perPage);
  const pageUrls = Array.from(
    { length: pageCount },
    (_, page) => `https://www.brown.edu/a-z?page=${page}`,
  );

  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const decodeCloudflareEmail = (encoded) => {
    if (!encoded || encoded.length < 4) return "";
    const key = Number.parseInt(encoded.slice(0, 2), 16);
    let decoded = "";
    for (let index = 2; index < encoded.length; index += 2) {
      decoded += String.fromCharCode(
        Number.parseInt(encoded.slice(index, index + 2), 16) ^ key,
      );
    }
    return decoded;
  };

  const parsePage = (html, pageUrl) => {
    const documentCopy = new DOMParser().parseFromString(html, "text/html");
    return [...documentCopy.querySelectorAll("main article")].map((article) => {
      const link = article.querySelector(".component_title_link");
      const email = article.querySelector("a[href^='mailto:']");
      const protectedEmail = article.querySelector(
        ".__cf_email__[data-cfemail]",
      );
      const phone = article.querySelector("a[href^='tel:']");
      const addressAnchor = article.querySelector(
        "a[href*='google.com/maps/dir']",
      );
      const address = addressAnchor
        ? [...addressAnchor.querySelectorAll(".contact_item_detail_hint")]
            .map((element) => normalizeText(element.textContent))
            .filter(Boolean)
            .join(" | ")
        : "";
      return {
        content_id: article.dataset.id || "",
        name: normalizeText(link?.textContent),
        directory_entry_url: link
          ? new URL(link.getAttribute("href"), pageUrl).href
          : "",
        email:
          normalizeText(email?.textContent) ||
          decodeCloudflareEmail(
            protectedEmail?.getAttribute("data-cfemail") || "",
          ),
        phone: normalizeText(phone?.textContent),
        address,
        map_url: addressAnchor?.href || "",
        directory_source_url: "https://www.brown.edu/a-z",
      };
    });
  };

  return Promise.all(
    pageUrls.map((pageUrl) =>
      fetch(pageUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`${pageUrl}: HTTP ${response.status}`);
          }
          return response.text();
        })
        .then((html) => parsePage(html, pageUrl)),
    ),
  ).then((pages) =>
    JSON.stringify({
      expected_count: totalResults,
      page_count: pageCount,
      items: pages.flat(),
    }),
  );
})()
