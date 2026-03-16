import type { Speaker } from "@/types/appearance";

/**
 * Validate speaker names in a cleaned transcript against known speakers
 * from metadata. Replaces hallucinated names with the closest match.
 *
 * Returns the corrected transcript and a list of replacements made.
 */
export function validateSpeakerAttribution(
  cleanedTranscript: string,
  knownSpeakers: Speaker[]
): { corrected: string; replacements: { from: string; to: string }[] } {
  if (knownSpeakers.length === 0) {
    return { corrected: cleanedTranscript, replacements: [] };
  }

  const knownNames = knownSpeakers.map((s) => s.name);

  // Extract unique speaker names from the transcript (format: "SpeakerName:\n")
  const speakerPattern = /^([^\n:]+):\n/gm;
  const foundNames = new Set<string>();
  let match;
  while ((match = speakerPattern.exec(cleanedTranscript)) !== null) {
    foundNames.add(match[1].trim());
  }

  const replacements: { from: string; to: string }[] = [];
  let corrected = cleanedTranscript;

  for (const found of foundNames) {
    // Skip if this is a known speaker name (exact match)
    if (knownNames.includes(found)) continue;

    // Skip generic labels like "Speaker 1", "Speaker 2"
    if (/^Speaker \d+$/i.test(found)) continue;

    // Try fuzzy match: shared first or last name
    const bestMatch = findClosestSpeaker(found, knownNames);
    if (bestMatch) {
      console.log(
        `[validate-speakers] replacing hallucinated "${found}" with "${bestMatch}"`
      );
      // Replace all occurrences of this speaker label in the transcript
      corrected = corrected.replaceAll(`${found}:\n`, `${bestMatch}:\n`);
      replacements.push({ from: found, to: bestMatch });
    } else {
      console.warn(
        `[validate-speakers] unknown speaker "${found}" — no close match in [${knownNames.join(", ")}]`
      );
    }
  }

  return { corrected, replacements };
}

/**
 * Find the closest known speaker name by comparing first/last name parts.
 * Returns null if no reasonable match is found.
 */
function findClosestSpeaker(
  unknown: string,
  knownNames: string[]
): string | null {
  const unknownParts = unknown.toLowerCase().split(/\s+/);

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const known of knownNames) {
    const knownParts = known.toLowerCase().split(/\s+/);
    let score = 0;

    for (const up of unknownParts) {
      for (const kp of knownParts) {
        // Exact part match (e.g., "Sullivan" matches "Sullivan")
        if (up === kp) {
          score += 2;
        }
        // Prefix match for shortened names (e.g., "Tim" matches "Timothy")
        else if (up.length >= 3 && (kp.startsWith(up) || up.startsWith(kp))) {
          score += 1;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = known;
    }
  }

  // Require at least one name part to match
  return bestScore >= 1 ? bestMatch : null;
}
