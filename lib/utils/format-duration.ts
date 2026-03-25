/**
 * Format a duration in seconds to a human-readable string.
 * "45 sec" | "2 min" | "1 hr 12 min"
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0 sec";
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return `${Math.round(seconds)} sec`;
  if (totalMin < 60) return `${totalMin} min`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) return `${hrs} hr`;
  return `${hrs} hr ${mins} min`;
}
