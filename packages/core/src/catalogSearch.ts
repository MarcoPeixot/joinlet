/** Search metadata is bilingual and remains independent of the labels painted on the canvas. */
export function catalogMatches(
  query: string,
  ...fields: (string | readonly string[] | undefined)[]
): boolean {
  const normalize = (text: string) =>
    text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const haystack = normalize(fields.flatMap((field) => field ?? []).join(" "));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
