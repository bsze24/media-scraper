/**
 * Generate turn summaries for complete appearances.
 *
 * By default, skips appearances that already have turn_summaries.
 * Pass --force to regenerate all (e.g. after prompt changes).
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/reprocess-turn-summaries.ts
 *   export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/reprocess-turn-summaries.ts --force
 */

import { reprocessTurnSummaries } from "../lib/queue/orchestrator";
import { createServerClient } from "../lib/db/client";

async function main() {
  const force = process.argv.includes("--force");
  const db = createServerClient();

  let query = db
    .from("appearances")
    .select("id, title, turns")
    .eq("processing_status", "complete")
    .not("turns", "is", null)
    .order("appearance_date", { ascending: false });

  if (!force) {
    query = query.is("turn_summaries", null);
  }

  const { data: rows, error } = await query;

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log(force
      ? "No appearances with turns found."
      : "All appearances already have turn summaries. Use --force to regenerate."
    );
    return;
  }

  console.log(`Generating turn summaries for ${rows.length} appearances${force ? " (--force)" : ""}.\n`);

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
