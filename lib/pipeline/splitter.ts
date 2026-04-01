import type { EntityTags, FundName, KeyPerson } from "@/types/appearance";
import type { PrepBulletsData } from "@/types/bullets";
import type { SectionHeading } from "@/types/scraper";

export const CHUNK_THRESHOLD = 120_000;

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/**
 * Split a raw transcript into chunks for parallel LLM processing.
 *
 * Priority:
 * 1. If sections available → group sections until approaching target size
 * 2. Else → split at speaker turn boundaries (double-newline)
 * 3. Last resort → hard split at paragraph boundary near target
 *
 * Short transcripts (<targetChunkChars) return a single-element array.
 */
export function splitForProcessing(
  rawTranscript: string,
  sections: SectionHeading[],
  targetChunkChars: number = CHUNK_THRESHOLD
): string[] {
  if (rawTranscript.length < targetChunkChars) {
    return [rawTranscript];
  }

  // Strategy 1: Split at section boundaries
  if (sections.length >= 2) {
    const result = splitBySections(rawTranscript, sections, targetChunkChars);
    if (result.length > 1) return result;
  }

  // Strategy 2: Split at speaker turn boundaries (double-newline)
  const turnResult = splitAtDoubleNewline(rawTranscript, targetChunkChars);
  if (turnResult.length > 1) return turnResult;

  // Strategy 3: Hard split at paragraph boundary
  return hardSplitAtParagraph(rawTranscript, targetChunkChars);
}

function splitBySections(
  rawTranscript: string,
  sections: SectionHeading[],
  targetChunkChars: number
): string[] {
  // Find section positions in the transcript by heading text
  const sectionPositions: { index: number; heading: string }[] = [];
  for (const section of sections) {
    const pos = rawTranscript.indexOf(section.heading);
    if (pos !== -1) {
      sectionPositions.push({ index: pos, heading: section.heading });
    }
  }

  if (sectionPositions.length < 2) {
    return [rawTranscript];
  }

  // Sort by position
  sectionPositions.sort((a, b) => a.index - b.index);

  // Group sections into chunks, cutting at the last boundary before exceeding target
  const chunks: string[] = [];
  let chunkStart = 0;
  let lastSectionStart = sectionPositions[0].index;

  for (let i = 1; i < sectionPositions.length; i++) {
    const nextSectionStart = sectionPositions[i].index;
    const chunkSize = nextSectionStart - chunkStart;

    if (chunkSize >= targetChunkChars && lastSectionStart > chunkStart) {
      // Cut at the previous section boundary to stay under target
      const chunkText = rawTranscript.slice(chunkStart, lastSectionStart).trim();
      if (chunkText) {
        chunks.push(chunkText);
      }
      chunkStart = lastSectionStart;
    }
    lastSectionStart = nextSectionStart;
  }

  // Push remaining text
  const remaining = rawTranscript.slice(chunkStart).trim();
  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.length > 0 ? chunks : [rawTranscript];
}

function splitAtDoubleNewline(
  text: string,
  targetChunkChars: number
): string[] {
  const blocks = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const blockLength = block.length + 2; // +2 for the "\n\n" separator
    if (currentLength + blockLength > targetChunkChars && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [block];
      currentLength = block.length;
    } else {
      current.push(block);
      currentLength += blockLength;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks;
}

function hardSplitAtParagraph(
  text: string,
  targetChunkChars: number
): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > targetChunkChars) {
    // Look for a newline near the target boundary
    let splitIdx = remaining.lastIndexOf("\n", targetChunkChars);
    if (splitIdx < targetChunkChars * 0.5) {
      // No good newline found — hard split at target
      splitIdx = targetChunkChars;
    }
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Join cleaned transcript chunks back together. */
export function mergeCleaned(chunks: string[]): string {
  return chunks.join("\n\n");
}

/** Merge entity tags from multiple chunks, deduplicating. */
export function mergeEntityTags(chunks: EntityTags[]): EntityTags {
  const fundMap = new Map<string, FundName>();
  const peopleMap = new Map<string, KeyPerson>();

  for (const tags of chunks) {
    for (const fund of tags.fund_names ?? []) {
      const key = fund.name.toLowerCase();
      const existing = fundMap.get(key);
      if (existing) {
        // Merge aliases (deduped, case-insensitive)
        const aliasSet = new Set(existing.aliases.map((a) => a.toLowerCase()));
        for (const alias of fund.aliases) {
          if (!aliasSet.has(alias.toLowerCase())) {
            existing.aliases.push(alias);
            aliasSet.add(alias.toLowerCase());
          }
        }
        // First non-null wins for parent; "primary" always wins for type
        if (!existing.parent && fund.parent) {
          existing.parent = fund.parent;
        }
        if (fund.type === "standalone") {
          existing.type = "standalone";
        }
        // "primary" relevance always wins over "mentioned" or undefined
        if (fund.relevance === "primary") {
          existing.relevance = "primary";
        } else if (fund.relevance === "mentioned" && !existing.relevance) {
          existing.relevance = "mentioned";
        }
      } else {
        fundMap.set(key, { ...fund, aliases: [...fund.aliases] });
      }
    }

    for (const person of tags.key_people ?? []) {
      const key = person.name.toLowerCase();
      const existing = peopleMap.get(key);
      if (existing) {
        if (!existing.title && person.title) existing.title = person.title;
        if (!existing.fund_affiliation && person.fund_affiliation) {
          existing.fund_affiliation = person.fund_affiliation;
        }
      } else {
        peopleMap.set(key, { ...person });
      }
    }
  }

  // Reconstruct sectors/companies preserving original casing from first occurrence
  const sectorsResult: string[] = [];
  const sectorsAdded = new Set<string>();
  for (const tags of chunks) {
    for (const sector of tags.sectors_themes ?? []) {
      const lower = sector.toLowerCase();
      if (!sectorsAdded.has(lower)) {
        sectorsResult.push(sector);
        sectorsAdded.add(lower);
      }
    }
  }

  const companiesResult: string[] = [];
  const companiesAdded = new Set<string>();
  for (const tags of chunks) {
    for (const company of tags.portfolio_companies ?? []) {
      const lower = company.toLowerCase();
      if (!companiesAdded.has(lower)) {
        companiesResult.push(company);
        companiesAdded.add(lower);
      }
    }
  }

  return {
    fund_names: Array.from(fundMap.values()),
    key_people: Array.from(peopleMap.values()),
    sectors_themes: sectorsResult,
    portfolio_companies: companiesResult,
  };
}

/** Merge prep bullets from multiple chunks, deduplicating by exact text match. */
export function mergePrepBullets(chunks: PrepBulletsData[]): PrepBulletsData {
  const bulletTexts = new Set<string>();
  const angleTexts = new Set<string>();

  const bullets: PrepBulletsData["bullets"] = [];
  const angles: PrepBulletsData["rowspace_angles"] = [];

  for (const chunk of chunks) {
    for (const bullet of chunk.bullets ?? []) {
      if (!bulletTexts.has(bullet.text)) {
        bulletTexts.add(bullet.text);
        bullets.push(bullet);
      }
    }
    for (const angle of chunk.rowspace_angles ?? []) {
      if (!angleTexts.has(angle.text)) {
        angleTexts.add(angle.text);
        angles.push(angle);
      }
    }
  }

  return { bullets, rowspace_angles: angles };
}
