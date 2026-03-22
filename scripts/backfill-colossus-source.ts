/**
 * Backfill: add `source: "source"` to all Colossus section objects
 * that are missing the `source` field.
 *
 * Usage: npx tsx scripts/backfill-colossus-source.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import type { SectionHeading } from "@/types/scraper";

async function main() {
  const supabase = createServerClient();

  const { data: rows, error } = await supabase
    .from("appearances")
    .select("id, title, sections")
    .eq("transcript_source", "colossus")
    .order("created_at", { ascending: true });

  if (error) throw error;

  console.log(`[backfill-colossus-source] Found ${rows.length} Colossus appearances`);

  for (const row of rows) {
    const sections = (row.sections ?? []) as SectionHeading[];

    if (sections.length === 0) {
      console.log(`  ${row.title}: 0 sections — skipping`);
      continue;
    }

    const needsUpdate = sections.some((s) => s.source == null);
    if (!needsUpdate) {
      console.log(`  ${row.title}: ${sections.length} sections — already has source`);
      continue;
    }

    const updated = sections.map((s) => ({
      ...s,
      source: s.source ?? ("source" as const),
    }));

    const { error: updateError } = await supabase
      .from("appearances")
      .update({ sections: updated })
      .eq("id", row.id);

    if (updateError) {
      console.error(`  ${row.title}: FAILED — ${updateError.message}`);
      continue;
    }

    console.log(`  ${row.title}: ${sections.length} sections — updated`);
  }

  console.log(`[backfill-colossus-source] Done`);
}

main().catch((err) => {
  console.error("[backfill-colossus-source] Fatal:", err);
  process.exit(1);
});
