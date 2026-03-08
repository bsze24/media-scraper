/**
 * Backfill script: re-scrape Colossus episodes to populate sections[] and
 * stamp section_anchor on turns. Does NOT re-run LLM steps.
 *
 * Usage: npx tsx scripts/backfill-sections.ts
 *
 * What it does for each complete Colossus appearance:
 * 1. Re-scrapes the HTML (Playwright auth) to get rawTranscript with h2 headings + sections[]
 * 2. Re-parses turns with sections to stamp section_anchor
 * 3. Writes raw_transcript, sections, turns back to DB
 * 4. Leaves cleaned_transcript, entity_tags, prep_bullets untouched
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import { scrapeColossusPage } from "@lib/scrapers/colossus";
import { colossusDelay } from "@lib/scrapers/colossus";
import { parseTurns } from "@lib/scrapers/parse-turns";
import type { AppearanceRow } from "@lib/db/types";

async function main() {
  const supabase = createServerClient();

  // Fetch all complete Colossus appearances
  const { data: rows, error } = await supabase
    .from("appearances")
    .select("id, title, source_url, transcript_source")
    .eq("processing_status", "complete")
    .eq("transcript_source", "colossus")
    .order("created_at", { ascending: true });

  if (error) throw error;

  const appearances = rows as Pick<
    AppearanceRow,
    "id" | "title" | "source_url" | "transcript_source"
  >[];

  console.log(`[backfill] Found ${appearances.length} complete Colossus appearances`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < appearances.length; i++) {
    const row = appearances[i];
    console.log(
      `\n[backfill] (${i + 1}/${appearances.length}) ${row.title}`
    );
    console.log(`  URL: ${row.source_url}`);

    try {
      // Re-scrape to get fresh rawTranscript (with h2 headings) and sections
      console.log("  Scraping...");
      const result = await scrapeColossusPage(row.source_url);

      console.log(
        `  Scraped: ${result.sections.length} sections, ${result.rawTranscript.length} chars`
      );

      // Re-parse turns with sections to stamp section_anchor
      const turns = parseTurns(result.rawTranscript, result.sections);
      const anchored = turns.filter((t) => t.section_anchor).length;
      console.log(
        `  Parsed: ${turns.length} turns, ${anchored} with section_anchor`
      );

      // Write back to DB (only raw_transcript, sections, turns)
      const { error: updateError } = await supabase
        .from("appearances")
        .update({
          raw_transcript: result.rawTranscript,
          sections: result.sections,
          turns: turns,
        })
        .eq("id", row.id);

      if (updateError) throw updateError;

      console.log("  ✓ Updated");
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${msg}`);
      failed++;
    }

    // Rate limit between scrapes
    if (i < appearances.length - 1) {
      console.log("  Waiting (rate limit)...");
      await colossusDelay();
    }
  }

  console.log(
    `\n[backfill] Done: ${updated} updated, ${failed} failed out of ${appearances.length}`
  );
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
