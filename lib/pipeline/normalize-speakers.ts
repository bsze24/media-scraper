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
 * Check if all parts of `shorter` appear in `longer`.
 * "Marc" is a subset of "Marc Rowan", but "Marc Smith" is NOT a subset
 * of "Marc Rowan" (Smith doesn't appear in the canonical name).
 */
function isSubsetOf(shorter: string, longer: string): boolean {
  const sParts = nameParts(shorter);
  const lParts = nameParts(longer);
  return sParts.every((sp) => lParts.includes(sp));
}

/**
 * Find canonical name matches from metadata for a given transcript speaker name.
 * Only matches when the variant's name parts are a strict subset of a canonical
 * name (or vice versa). Prevents "Marc Smith" from matching "Marc Rowan".
 */
function findCanonicalMatches(
  variant: string,
  canonicalNames: string[]
): string[] {
  return canonicalNames.filter(
    (canonical) => isSubsetOf(variant, canonical) || isSubsetOf(canonical, variant)
  );
}

/**
 * Build canonical name map from transcript when metadata is empty.
 * Only clusters names where one is a strict subset of the other
 * (e.g. "Marc" is a subset of "Marc Rowan"). Picks the longest as canonical.
 * Skips ambiguous cases where a short name is a subset of multiple full names.
 */
function buildFallbackCanonicalMap(
  transcriptNames: Set<string>
): Record<string, string> {
  const names = Array.from(transcriptNames);
  const map: Record<string, string> = {};

  for (const name of names) {
    // Find all names that this name is a strict subset of (shorter → longer)
    const supersets = names.filter(
      (other) => other !== name && isSubsetOf(name, other)
    );

    if (supersets.length === 1) {
      // Unambiguous: "Marc" → "Marc Rowan" (only one longer form)
      map[name] = supersets[0];
    } else if (supersets.length > 1) {
      // Ambiguous: "Marc" could be "Marc Rowan" or "Marc Smith" — skip
      console.warn(
        `[normalize-speakers] fallback: ambiguous "${name}" — could be ${supersets.map((s) => `"${s}"`).join(" or ")}. Skipping.`
      );
    }
    // If no supersets, this is already the longest form or unrelated — skip
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
