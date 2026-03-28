const ORG_INDICATORS =
  /\b(capital|partners|associates|fund|group|invest|allocator|mainstream|podcast|llc|inc|management|street|advisory)\b/i;

/**
 * Detect if source_name looks like a person's name that's missing from
 * the speakers list. Used by both the search page and transcript viewer
 * banner to surface "host missing" warnings.
 */
export function detectSpeakerMismatch(
  sourceName: string | null | undefined,
  speakers: { name: string }[]
): boolean {
  const source = sourceName?.trim();
  if (!source) return false;

  // Person names: 2-4 words, no common podcast/org indicators
  const words = source.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (ORG_INDICATORS.test(source)) return false;

  // Check if any speaker name shares a word with source_name
  const sourceWords = new Set(words.map((w) => w.toLowerCase()));
  const hasMatch = speakers.some((s) =>
    s.name
      .toLowerCase()
      .split(/\s+/)
      .some((w) => sourceWords.has(w))
  );

  return !hasMatch;
}
