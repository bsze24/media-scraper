/**
 * Normalize variant speaker name forms in a cleaned transcript to canonical
 * names from metadata. Handles drift like "Marc Rowan" / "Marc" / "Rowan"
 * all referring to the same person.
 *
 * Distinct from validateSpeakerAttribution (PR #10) which catches *wrong*
 * names. This normalizes *variant forms* of correct names.
 */

interface NormalizationResult {
  normalizedTranscript: string;
  replacements: Record<string, string>;
}

/**
 * Extract unique speaker names from cleaned transcript.
 * Speaker labels appear as `SpeakerName:\n` at start of line.
 */
function extractTranscriptSpeakers(transcript: string): Set<string> {
  const pattern = /^([^\n:]+):\n/gm;
  const names = new Set<string>();
  let match;
  while ((match = pattern.exec(transcript)) !== null) {
    names.add(match[1].trim());
  }
  return names;
}

/**
 * Split a name into lowercase parts for comparison.
 */
function nameParts(name: string): string[] {
  return name.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Check if two names share at least one name part.
 */
function sharesNamePart(a: string, b: string): boolean {
  const aParts = nameParts(a);
  const bParts = nameParts(b);
  return aParts.some((ap) => bParts.includes(ap));
}

/**
 * Find canonical name matches from metadata for a given transcript speaker name.
 * Returns all canonical names that share a name part with the variant.
 */
function findCanonicalMatches(
  variant: string,
  canonicalNames: string[]
): string[] {
  return canonicalNames.filter((canonical) => sharesNamePart(variant, canonical));
}

/**
 * Build canonical name map from transcript when metadata is empty or incomplete.
 * Groups names sharing a first or last name part, picks the longest as canonical.
 */
function buildFallbackCanonicalMap(
  transcriptNames: Set<string>
): Record<string, string> {
  const names = Array.from(transcriptNames);
  const map: Record<string, string> = {};
  const assigned = new Set<string>();

  // Group names by shared name parts
  for (const name of names) {
    if (assigned.has(name)) continue;

    const cluster = names.filter(
      (other) => other === name || sharesNamePart(name, other)
    );

    // Pick the longest name in the cluster as canonical
    const canonical = cluster.reduce((a, b) => (a.length >= b.length ? a : b));

    for (const member of cluster) {
      if (member !== canonical) {
        // Check for ambiguity: does this member share parts with names
        // outside this cluster?
        const otherMatches = names.filter(
          (n) => !cluster.includes(n) && sharesNamePart(member, n)
        );
        if (otherMatches.length === 0) {
          map[member] = canonical;
        }
      }
      assigned.add(member);
    }
  }

  return map;
}

/**
 * Normalize variant speaker name forms in a cleaned transcript.
 *
 * When knownSpeakers is provided, uses those as canonical names.
 * When knownSpeakers is empty or has fewer entries than transcript speakers,
 * falls back to building canonical names from the transcript itself
 * (longest form wins).
 */
export function normalizeSpeakerNames(
  cleanedTranscript: string,
  knownSpeakers: Array<{ name: string }>
): NormalizationResult {
  const transcriptNames = extractTranscriptSpeakers(cleanedTranscript);

  if (transcriptNames.size === 0) {
    return { normalizedTranscript: cleanedTranscript, replacements: {} };
  }

  const canonicalNames = knownSpeakers.map((s) => s.name);
  const replacements: Record<string, string> = {};

  if (canonicalNames.length === 0) {
    // No metadata at all — build canonical map from transcript itself
    const fallbackMap = buildFallbackCanonicalMap(transcriptNames);
    return {
      normalizedTranscript: applyReplacements(cleanedTranscript, fallbackMap),
      replacements: fallbackMap,
    };
  }

  // Match transcript names to metadata canonical names
  {
    for (const found of transcriptNames) {
      // Skip if already mapped by fallback or is an exact match
      if (replacements[found] || canonicalNames.includes(found)) continue;

      const matches = findCanonicalMatches(found, canonicalNames);

      if (matches.length === 1) {
        replacements[found] = matches[0];
      } else if (matches.length > 1) {
        console.warn(
          `[normalize-speakers] ambiguous match for "${found}" — could be ${matches.map((m) => `"${m}"`).join(" or ")}. Skipping.`
        );
      }
      // No match → leave unchanged (might be a valid speaker not in metadata)
    }
  }

  return {
    normalizedTranscript: applyReplacements(cleanedTranscript, replacements),
    replacements,
  };
}

/**
 * Apply speaker name replacements using line-anchored regex
 * (same pattern as PR #10 BugBot fix to avoid substring corruption).
 */
function applyReplacements(
  transcript: string,
  replacements: Record<string, string>
): string {
  let result = transcript;
  for (const [variant, canonical] of Object.entries(replacements)) {
    const escapedVariant = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`^${escapedVariant}:\\n`, "gm"),
      `${canonical}:\n`
    );
  }
  return result;
}
