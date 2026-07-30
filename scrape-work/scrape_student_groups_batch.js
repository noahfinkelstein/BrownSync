(() => {
  const batchStart = Number(
    localStorage.getItem("brownsync_groups_start") || "0",
  );
  const batchSize = Number(
    localStorage.getItem("brownsync_groups_batch_size") || "50",
  );
  const groups = [...document.querySelectorAll("main h3 a")]
    .map((anchor) => {
      const article = anchor.closest("article") || anchor.parentElement;
      const email =
        (article?.parentElement?.querySelector("p")?.textContent || "").trim();
      return {
        name: anchor.textContent.replace(/\s+/g, " ").trim(),
        email,
        source_url: anchor.href,
      };
    })
    .slice(batchStart, batchStart + batchSize);

  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const extractOne = (group) =>
    fetch(group.source_url).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    }).then((html) => {
      const documentCopy = new DOMParser().parseFromString(html, "text/html");
    const detailFields = Object.fromEntries(
      [...documentCopy.querySelectorAll(".page_detail")]
        .map((detail) => {
          const label = normalizeText(
            detail.querySelector(".page_detail_label")?.textContent,
          ).toLowerCase();
          const values = [
            ...detail.querySelectorAll(
              ".page_detail_name, .flex_tag_item, a[itemprop='email']",
            ),
          ]
            .map((element) => normalizeText(element.textContent))
            .filter(Boolean);
          return [label, [...new Set(values)].join(" | ")];
        })
        .filter(([label]) => label),
    );
    const socialLinks = [
      ...documentCopy.querySelectorAll(".social-media-icons a"),
    ].map((anchor) => ({
      platform:
        normalizeText(anchor.getAttribute("aria-label")) ||
        normalizeText(anchor.textContent) ||
        "website",
      url: new URL(anchor.getAttribute("href"), group.source_url).href,
    }));
    const socialByPlatform = (platform) =>
      socialLinks
        .filter((link) => link.platform.toLowerCase().includes(platform))
        .map((link) => link.url)
        .join(" | ");
    const knownSocialUrls = new Set(
      socialLinks
        .filter((link) =>
          /instagram|facebook|linkedin|youtube|twitter|tiktok|website/i.test(
            link.platform,
          ),
        )
        .map((link) => link.url),
    );

      return {
        name:
          normalizeText(
            documentCopy.querySelector(".page_title")?.textContent,
          ) || group.name,
        email: detailFields.email || group.email,
        advisor: detailFields.advisor || "",
        funding_category: detailFields.funding || "",
        tags: detailFields.tags || "",
        description: normalizeText(
          documentCopy.querySelector(".flex-intro")?.textContent,
        ),
        additional_information: normalizeText(
          documentCopy.querySelector(".flex-body")?.textContent,
        ),
        instagram_url: socialByPlatform("instagram"),
        facebook_url: socialByPlatform("facebook"),
        linkedin_url: socialByPlatform("linkedin"),
        youtube_url: socialByPlatform("youtube"),
        twitter_url: socialByPlatform("twitter"),
        tiktok_url: socialByPlatform("tiktok"),
        website_url: socialByPlatform("website"),
        other_social_urls: socialLinks
          .filter((link) => !knownSocialUrls.has(link.url))
          .map((link) => `${link.platform}: ${link.url}`)
          .join(" | "),
        source_url: group.source_url,
        directory_source_url:
          "https://studentactivities.brown.edu/student-groups/undergraduate-student-groups",
      };
    });

  const results = [];
  const starts = Array.from(
    { length: Math.ceil(groups.length / 6) },
    (_, index) => index * 6,
  );

  return starts
    .reduce(
      (previous, start) =>
        previous
          .then(() =>
            Promise.all(
              groups.slice(start, start + 6).map((group) =>
                extractOne(group).catch((error) => ({
                  ...group,
                  error: String(error),
                  directory_source_url:
                    "https://studentactivities.brown.edu/student-groups/undergraduate-student-groups",
                })),
              ),
            ),
          )
          .then((batch) => results.push(...batch)),
      Promise.resolve(),
    )
    .then(() => JSON.stringify(results));
})()
