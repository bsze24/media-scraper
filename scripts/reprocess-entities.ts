/**
 * Re-run entity extraction on all complete appearances.
 * Reads cleaned_transcript, calls extractEntities(), writes back entity_tags.
 *
 * Usage: npx tsx scripts/reprocess-entities.ts
 * Requires env vars from .env.local (run with `source .env.local && npx tsx ...`
 * or use dotenv).
 */

import { createServerClient } from "../lib/db/client";
import { extractEntities } from "../lib/pipeline/entities";

async function main() {
  const db = createServerClient();

  const { data: rows, error } = await db
    .from("appearances")
    .select("id, title, cleaned_transcript")
    .eq("processing_status", "complete")
    .not("cleaned_transcript", "is", null)
    .order("appearance_date", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No complete appearances found.");
    return;
  }

  console.log(`Found ${rows.length} appearances to reprocess.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `[${i + 1}/${rows.length}] ${row.title ?? row.id}`;

    try {
      console.log(`${label} — extracting...`);
      const result = await extractEntities(row.cleaned_transcript!);

      const fundCount = result.entity_tags.fund_names?.length ?? 0;
      const relevanceCounts = {
        primary: 0,
        mentioned: 0,
        none: 0,
      };
      for (const f of result.entity_tags.fund_names ?? []) {
        if (f.relevance === "primary") relevanceCounts.primary++;
        else if (f.relevance === "mentioned") relevanceCounts.mentioned++;
        else relevanceCounts.none++;
      }

      const { error: writeErr } = await db
        .from("appearances")
        .update({ entity_tags: result.entity_tags })
        .eq("id", row.id);

      if (writeErr) throw writeErr;

      console.log(
        `${label} — ✓ ${fundCount} funds (${relevanceCounts.primary} primary, ${relevanceCounts.mentioned} mentioned)\n`
      );
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
