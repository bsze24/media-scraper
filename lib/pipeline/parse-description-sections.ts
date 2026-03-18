import type { SectionHeading } from "@/types/scraper";
import { slugify } from "@lib/scrapers/youtube";

/** Minimum number of timestamp lines required to treat as a chapter list */
const MIN_TIMESTAMP_LINES = 2;

/**
 * Regex for timestamps at the start of a line.
 * Captures: optional parens, H:MM:SS or MM:SS, optional separator, heading text.
 * Groups: (1) hours (optional), (2) minutes, (3) seconds, (4) heading text
 */
const TIMESTAMP_LINE_RE =
  /^\s*\(?(\d{1,2}:)?(\d{1,2}):(\d{2})\)?\s*[-–—]?\s*(.+)/;

/**
 * Parse a timestamp string into total seconds.
 */
function parseTimestamp(
  hours: string | undefined,
  minutes: string,
  seconds: string
): number {
  const h = hours ? parseInt(hours.replace(":", ""), 10) : 0;
  const m = parseInt(minutes, 10);
  const s = parseInt(seconds, 10);
  return h * 3600 + m * 60 + s;
}

/**
 * Parse YouTube video description for timestamp lines and convert to sections.
 * Returns sections sorted by start_time ascending.
 *
 * Only matches timestamps at the start of a line. Requires at least 2 timestamp
 * lines to return results (a single timestamp is likely a highlight, not chapters).
 */
export function parseDescriptionSections(
  description: string | null | undefined
): SectionHeading[] {
  if (!description) return [];

  const lines = description.split("\n");
  const sections: SectionHeading[] = [];

  for (const line of lines) {
    const match = line.match(TIMESTAMP_LINE_RE);
    if (!match) continue;

    const [, hours, minutes, seconds, heading] = match;
    const trimmedHeading = heading.trim();
    if (!trimmedHeading) continue;

    sections.push({
      heading: trimmedHeading,
      anchor: slugify(trimmedHeading),
      start_time: parseTimestamp(hours, minutes, seconds),
      source: "derived",
    });
  }

  if (sections.length < MIN_TIMESTAMP_LINES) return [];

  sections.sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));
  return sections;
}
