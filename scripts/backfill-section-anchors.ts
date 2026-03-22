/**
 * Backfill: re-generate turn_index on inferred sections and stamp
 * section_anchor on turns for YouTube appearances with orphan sections.
 *
 * For each affected appearance:
 * 1. If sections lack turn_index, re-run generateSections() (LLM call)
 * 2. Run stampSectionAnchors() to stamp section_anchor on turns
 * 3. Write both sections and turns back to DB
 * 4. Verify the write succeeded
 *
 * Usage: npx tsx scripts/backfill-section-anchors.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import { generateSections } from "@lib/pipeline/sections";
import { stampSectionAnchors } from "@lib/pipeline/extract-timestamps";
import type { SectionHeading } from "@/types/scraper";
import type { Turn } from "@/types/appearance";

async function main() {
  const supabase = createServerClient();

  // Find YouTube appearances where sections exist but turns have no section_anchor
  const { data: rows, error } = await supabase
    .from("appearances")
    .select("id, title, sections, turns, cleaned_transcript")
    .eq("transcript_source", "youtube_captions")
    .eq("processing_status", "complete")
    .order("created_at", { ascending: true });

  if (error) throw error;

  // Filter to appearances with orphan sections
  const affected = rows.filter((row) => {
    const sections = (row.sections ?? []) as SectionHeading[];
    const turns = (row.turns ?? []) as Turn[];
    if (sections.length === 0) return false;
    const turnsWithAnchor = turns.filter((t) => t.section_anchor).length;
    return turnsWithAnchor === 0;
  });

  console.log(`[backfill-section-anchors] Found ${affected.length} appearances with orphan sections`);

  let updated = 0;
  let failed = 0;

  for (const row of affected) {
    const title = (row.title ?? "(untitled)").slice(0, 60);
    console.log(`\n[backfill] Processing: ${title}`);

    try {
      let sections = (row.sections ?? []) as SectionHeading[];
      const turns = (row.turns ?? []) as Turn[];
      const cleanedTranscript = row.cleaned_transcript ?? "";

      // Check if sections already have turn_index
      const sectionsWithTurnIndex = sections.filter((s) => s.turn_index != null);

      if (sectionsWithTurnIndex.length === sections.length) {
        console.log(`  Sections already have turn_index — skipping regeneration`);
      } else {
        // Re-generate sections via LLM to get fresh turn_index mappings
        console.log(`  Sections missing turn_index (${sectionsWithTurnIndex.length}/${sections.length}) — regenerating via LLM...`);

        if (cleanedTranscript.length === 0) {
          console.error(`  ✗ No cleaned_transcript — skipping`);
          failed++;
          continue;
        }

        const freshSections = await generateSections(
          cleanedTranscript,
          row.title ?? "Untitled",
          turns.length
        );

        if (freshSections.length === 0) {
          console.error(`  ✗ generateSections returned 0 sections — skipping`);
          failed++;
          continue;
        }

        console.log(`  Generated ${freshSections.length} sections with turn_index`);
        sections = freshSections;
      }

      // Stamp section_anchor on turns
      const stampedTurns = stampSectionAnchors(turns, sections);
      const anchoredCount = stampedTurns.filter((t) => t.section_anchor).length;
      console.log(`  Stamped section_anchor on ${anchoredCount}/${stampedTurns.length} turns`);

      // Write both sections and turns atomically
      const { error: updateError } = await supabase
        .from("appearances")
        .update({ sections, turns: stampedTurns })
        .eq("id", row.id);

      if (updateError) throw updateError;

      // Verify the write
      const { data: verify } = await supabase
        .from("appearances")
        .select("sections, turns")
        .eq("id", row.id)
        .single();

      const vSections = (verify?.sections ?? []) as SectionHeading[];
      const vTurns = (verify?.turns ?? []) as Turn[];
      const vTurnIndex = vSections.filter((s) => s.turn_index != null).length;
      const vAnchored = vTurns.filter((t) => t.section_anchor).length;

      if (vTurnIndex === vSections.length && vAnchored > 0) {
        console.log(`  ✓ Verified: ${vTurnIndex}/${vSections.length} sections have turn_index, ${vAnchored} turns have section_anchor`);
        updated++;
      } else {
        console.error(`  ✗ Verification failed: ${vTurnIndex}/${vSections.length} sections have turn_index, ${vAnchored} turns have section_anchor`);
        failed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${msg}`);
      failed++;
    }
  }

  console.log(
    `\n[backfill-section-anchors] Done: ${updated} updated, ${failed} failed out of ${affected.length}`
  );
}

main().catch((err) => {
  console.error("[backfill-section-anchors] Fatal:", err);
  process.exit(1);
});
