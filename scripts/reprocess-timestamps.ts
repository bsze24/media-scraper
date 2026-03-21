/**
 * Re-run timestamp extraction (pass 1 + pass 2) on all complete YouTube
 * appearances. Uses reprocessTimestamps() which handles turns, sections,
 * warnings, and processing_detail.
 *
 * Usage: npx tsx scripts/reprocess-timestamps.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import { reprocessTimestamps } from "@lib/queue/orchestrator";

async function main() {
  const db = createServerClient();
  const { data: rows, error } = await db
    .from("appearances")
    .select("id, title, transcript_source")
    .eq("processing_status", "complete")
    .like("transcript_source", "youtube%")
    .order("appearance_date", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No complete YouTube appearances found.");
    return;
  }

  console.log(`Reprocessing timestamps for ${rows.length} appearances.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `[${i + 1}/${rows.length}] ${row.title ?? row.id}`;

    try {
      const result = await reprocessTimestamps(row.id);
      console.log(
        `${label} — ✓ ${result.oldCount} → ${result.newCount}/${result.totalTurns}\n`
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
