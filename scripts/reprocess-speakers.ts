/**
 * Re-extract speakers and re-clean transcript for YouTube appearances
 * that have generic speaker names ("Speaker 1" / "Speaker 2").
 *
 * Only processes appearances where the speakers column is empty or
 * turns contain generic speaker names. Skips appearances that already
 * have real speaker names.
 *
 * Usage: npx tsx scripts/reprocess-speakers.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import { reprocessSpeakers } from "@lib/queue/orchestrator";

async function main() {
  const db = createServerClient();
  const { data: rows, error } = await db
    .from("appearances")
    .select("id, title, speakers, turns, transcript_source")
    .eq("processing_status", "complete")
    .like("transcript_source", "youtube%")
    .order("appearance_date", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No complete YouTube appearances found.");
    return;
  }

  // Filter to appearances with generic speaker names
  const needsReprocess = rows.filter((row) => {
    const speakers = row.speakers ?? [];
    if (speakers.length === 0) return true;
    const turns = (row.turns ?? []) as Array<{ speaker: string }>;
    return turns.some((t) => /^Speaker\s*\d+$/i.test(t.speaker));
  });

  if (needsReprocess.length === 0) {
    console.log(`All ${rows.length} YouTube appearances have real speaker names. Nothing to do.`);
    return;
  }

  console.log(`Found ${needsReprocess.length} appearances with generic speakers (of ${rows.length} total).\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < needsReprocess.length; i++) {
    const row = needsReprocess[i];
    const label = `[${i + 1}/${needsReprocess.length}] ${row.title ?? row.id}`;

    try {
      const result = await reprocessSpeakers(row.id);
      console.log(
        `${label} — ✓ speakers: [${result.oldSpeakers.join(", ")}] → [${result.newSpeakers.join(", ")}], ${result.turnCount} turns, ${result.timestampedCount} timestamped\n`
      );
      success++;
    } catch (err) {
      console.error(
        `${label} — ✗ ${err instanceof Error ? err.message : String(err)}\n`
      );
      failed++;
    }
  }

  console.log(`Done — ${success} succeeded, ${failed} failed`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
