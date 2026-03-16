/**
 * Re-run bullet generation on all complete appearances.
 * Uses the existing reprocessBullets() which reads cleaned_transcript + entity_tags.
 *
 * Usage: export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/reprocess-bullets.ts
 */

import { reprocessBullets } from "../lib/queue/orchestrator";
import { createServerClient } from "../lib/db/client";

async function main() {
  const db = createServerClient();
  const { data: rows, error } = await db
    .from("appearances")
    .select("id, title")
    .eq("processing_status", "complete")
    .order("appearance_date", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No complete appearances found.");
    return;
  }

  console.log(`Regenerating bullets for ${rows.length} appearances.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `[${i + 1}/${rows.length}] ${row.title ?? row.id}`;

    try {
      console.log(`${label} — generating...`);
      const result = await reprocessBullets(row.id);
      const count = result.prep_bullets.bullets?.length ?? 0;
      console.log(`${label} — ✓ ${count} bullets\n`);
      success++;
    } catch (err) {
      console.error(
        `${label} — ✗ ${err instanceof Error ? err.message : String(err)}\n`
      );
      failed++;
    }
  }

  console.log(`\nDone — ${success} succeeded, ${failed} failed`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
