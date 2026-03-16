/**
 * Generate turn summaries for all complete appearances.
 *
 * Usage: export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/reprocess-turn-summaries.ts
 */

import { reprocessTurnSummaries } from "../lib/queue/orchestrator";
import { createServerClient } from "../lib/db/client";

async function main() {
  const db = createServerClient();
  const { data: rows, error } = await db
    .from("appearances")
    .select("id, title, turns")
    .eq("processing_status", "complete")
    .not("turns", "is", null)
    .order("appearance_date", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No appearances with turns found.");
    return;
  }

  console.log(`Generating turn summaries for ${rows.length} appearances.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `[${i + 1}/${rows.length}] ${row.title ?? row.id}`;

    try {
      console.log(`${label} — generating...`);
      const summaries = await reprocessTurnSummaries(row.id);
      console.log(`${label} — ✓ ${summaries.length} summaries\n`);
      success++;
    } catch (err) {
      console.error(
        `${label} — ✗ ${err instanceof Error ? err.message : String(err)}\n`
      );
      failed++;
    }
  }

  console.log(`\nDone — ${success} succeeded, ${failed} failed out of ${rows.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
