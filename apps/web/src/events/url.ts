/**
 * `value` as a real absolute http(s) URL, else null.
 *
 * Feeds hand us both complete URLs and scheme-less hosts, alongside `""`,
 * `"#"`, `"TBD"` and site-relative paths. Complete the host-like values with
 * https; reject everything that cannot unambiguously open a web page.
 */
const HOSTLIKE = /^[A-Za-z0-9._~-]+\.[A-Za-z]{2,24}(?::\d+)?(?:[/?#].*)?$/;

export function absoluteHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const candidate = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : HOSTLIKE.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
