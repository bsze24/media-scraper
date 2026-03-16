import {
  getAppearanceById,
  listAppearances,
  updateProcessingStatus,
  claimForProcessing,
  writeExtractResult,
  writeCleanResult,
  writeTurns,
  writeEntitiesResult,
  writeBulletsResult,
  invalidateFundOverviewCache,
  extractFundNames,
} from "@lib/db/queries";
import { isYouTubeSource } from "@/types/appearance";
import { getScraperForUrl } from "@lib/scrapers/registry";
import { colossusDelay } from "@lib/scrapers/colossus";
import { parseTurns } from "@lib/scrapers/parse-turns";
import { cleanTranscript } from "@lib/pipeline/clean";
import { validateSpeakerAttribution } from "@lib/pipeline/validate-speakers";
import { extractEntities } from "@lib/pipeline/entities";
import { generatePrepBullets } from "@lib/pipeline/bullets";
import {
  splitForProcessing,
  mergeCleaned,
  mergeEntityTags,
  mergePrepBullets,
} from "@lib/pipeline/splitter";
import type {
  ExtractStepOutput,
  EntitiesStepOutput,
  BulletsStepOutput,
} from "@lib/db/types";

export async function processAppearance(id: string): Promise<void> {
  const row = await getAppearanceById(id);
  if (!row) throw new Error(`Appearance not found: ${id}`);

  if (row.processing_status !== "queued" && row.processing_status !== "failed") {
    throw new Error(
      `Cannot process appearance ${id}: status is "${row.processing_status}", expected "queued" or "failed"`
    );
  }

  // Atomic claim — prevents concurrent workers from double-processing
  const claimed = await claimForProcessing(id, row.processing_status, "extracting");
  if (!claimed) {
    throw new Error(`Appearance ${id} was already claimed by another worker`);
  }

  const title = row.title ?? row.source_url;
  const pipelineStart = Date.now();
  const stepTime = () => `${((Date.now() - pipelineStart) / 1000).toFixed(1)}s elapsed`;

  try {
    // Step 1: Extract
    console.log(`\n[pipeline] ▶ Step 1/4: EXTRACT — ${title}`);

    let rawTranscript: string;
    let sections: import("@/types/scraper").SectionHeading[] = [];
    let transcriptSource = row.transcript_source;
    let speakers = row.speakers ?? [];

    if (row.raw_transcript) {
      // Manual ingest — transcript already provided, skip scraper
      rawTranscript = row.raw_transcript;
      // Parse turns for manual transcripts too — manual ingest has source-provided labels
      const turns = parseTurns(rawTranscript, undefined, "source");
      await writeExtractResult(id, {
        raw_transcript: rawTranscript,
        turns,
        sections: [],
      });
    } else {
      const scraper = getScraperForUrl(row.source_url);
      const result = await scraper.extract(row.source_url);

      rawTranscript = result.rawTranscript;
      sections = result.sections;
      transcriptSource = result.transcriptSource;
      speakers = result.speakers;

      const extractOutput: ExtractStepOutput = {
        title: result.title,
        appearance_date: result.appearanceDate,
        source_name: result.sourceName,
        speakers: result.speakers,
        raw_transcript: result.rawTranscript,
        raw_caption_data: result.captionData,
        turns: parseTurns(result.rawTranscript, result.sections, "source"),
        sections: result.sections,
      };
      await writeExtractResult(id, extractOutput);
    }

    console.log(`[pipeline] ✓ Extract complete — ${rawTranscript.length} chars (${stepTime()})`);

    const CHUNK_THRESHOLD = 120_000;
    const needsChunking = rawTranscript.length >= CHUNK_THRESHOLD;
    const rawChunks = needsChunking
      ? splitForProcessing(rawTranscript, sections)
      : null;

    // Step 2: Clean
    console.log(`[pipeline] ▶ Step 2/4: CLEAN${needsChunking ? ` (${rawChunks!.length} chunks)` : ""} — ${title}`);
    await updateProcessingStatus(id, "cleaning");
    let finalCleaned: string;
    // Store per-chunk cleaned results so steps 3-4 can reuse them directly
    // instead of re-splitting finalCleaned with raw section headings
    // (which may not survive LLM cleaning).
    let cleanedChunks: string[] | null = null;
    const cleanOpts = { transcriptSource, speakers };
    if (rawChunks) {
      // Clean chunks in parallel
      cleanedChunks = await Promise.all(
        rawChunks.map((chunk) =>
          cleanTranscript(chunk, cleanOpts).then((o) => o.cleaned_transcript)
        )
      );
      finalCleaned = mergeCleaned(cleanedChunks);
    } else {
      const cleanOutput = await cleanTranscript(rawTranscript, cleanOpts);
      finalCleaned = cleanOutput.cleaned_transcript;
    }
    // For YouTube sources, validate speaker names and re-parse turns
    if (isYouTubeSource(transcriptSource)) {
      const { corrected, replacements } = validateSpeakerAttribution(finalCleaned, speakers);
      if (replacements.length > 0) {
        finalCleaned = corrected;
        console.log(`[pipeline]   ↳ Fixed ${replacements.length} hallucinated speaker name(s)`);
      }
    }

    await writeCleanResult(id, { cleaned_transcript: finalCleaned });
    console.log(`[pipeline] ✓ Clean complete — ${finalCleaned.length} chars (${stepTime()})`);

    // For YouTube sources, re-parse turns from the cleaned transcript
    // (which now has speaker labels) instead of the raw transcript (which doesn't).
    // These turns are marked "inferred" since speaker labels came from LLM attribution.
    if (isYouTubeSource(transcriptSource)) {
      const cleanedTurns = parseTurns(finalCleaned, sections, "inferred");
      await writeTurns(id, cleanedTurns);
      console.log(`[pipeline]   ↳ Re-parsed ${cleanedTurns.length} turns from cleaned transcript`);
    }

    // Step 3: Entities
    console.log(`[pipeline] ▶ Step 3/4: ENTITIES — ${title}`);
    await updateProcessingStatus(id, "analyzing");
    let finalEntities: EntitiesStepOutput;
    if (cleanedChunks) {
      // Entity chunks in parallel
      const entityChunks = await Promise.all(
        cleanedChunks.map((chunk) => extractEntities(chunk))
      );
      finalEntities = {
        entity_tags: mergeEntityTags(entityChunks.map((e) => e.entity_tags)),
      };
    } else {
      finalEntities = await extractEntities(finalCleaned);
    }
    await writeEntitiesResult(id, finalEntities);
    const entityCount = (finalEntities.entity_tags.fund_names?.length ?? 0) +
      (finalEntities.entity_tags.key_people?.length ?? 0);
    console.log(`[pipeline] ✓ Entities complete — ${entityCount} entities (${stepTime()})`);

    // Step 4: Bullets (still "analyzing")
    console.log(`[pipeline] ▶ Step 4/4: BULLETS — ${title}`);
    // Entities->Bullets is sequential: generatePrepBullets requires entityTags as input.
    // Chunk-level parallelism within each step is safe.
    let finalBullets: BulletsStepOutput;
    if (cleanedChunks && rawChunks) {
      const bulletChunks = await Promise.all(
        cleanedChunks.map((chunk, ci) => {
          const chunkSections = sections.filter(
            (s) => rawChunks[ci].includes(s.heading)
          );
          return generatePrepBullets(
            chunk,
            finalEntities.entity_tags,
            chunkSections,
            transcriptSource
          );
        })
      );
      finalBullets = {
        prep_bullets: mergePrepBullets(bulletChunks.map((b) => b.prep_bullets)),
        prompt_context_snapshot: bulletChunks[0]?.prompt_context_snapshot,
      };
    } else {
      finalBullets = await generatePrepBullets(
        finalCleaned,
        finalEntities.entity_tags,
        sections,
        transcriptSource
      );
    }
    await writeBulletsResult(id, finalBullets);
    const bulletCount = finalBullets.prep_bullets.bullets?.length ?? 0;
    console.log(`[pipeline] ✓ Bullets complete — ${bulletCount} bullets (${stepTime()})`);

    // Done
    await updateProcessingStatus(id, "complete");
    console.log(`[pipeline] ✅ COMPLETE — ${title} (total: ${stepTime()})`);

    // Cache invalidation is best-effort — pipeline data is already persisted,
    // so a failure here must not revert status to "failed".
    try {
      const fundNames = extractFundNames(finalEntities.entity_tags);
      await invalidateFundOverviewCache(fundNames);
    } catch (cacheErr) {
      console.error(
        `[orchestrator] cache invalidation failed for ${id}, status remains complete:`,
        cacheErr instanceof Error ? cacheErr.message : cacheErr
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateProcessingStatus(id, "failed", message);
    throw err;
  }
}

export async function reprocessBullets(id: string): Promise<BulletsStepOutput> {
  const row = await getAppearanceById(id);
  if (!row) throw new Error(`Appearance not found: ${id}`);
  if (row.processing_status !== "complete") {
    throw new Error(
      `Cannot reprocess: status is "${row.processing_status}", expected "complete"`
    );
  }
  if (!row.cleaned_transcript) {
    throw new Error(`No cleaned_transcript for appearance ${id}`);
  }
  if (!row.entity_tags || Object.keys(row.entity_tags).length === 0) {
    throw new Error(`No entity_tags for appearance ${id}`);
  }

  const title = row.title ?? id;
  console.log(`[reprocessBullets] starting: ${title}`);

  try {
    // Split on raw_transcript (section headings are intact there), not
    // cleaned_transcript where the LLM may have stripped/modified them.
    // Raw chunks are used only for section filtering; cleaned_transcript
    // is what gets sent to the bullets LLM.
    const CHUNK_THRESHOLD = 120_000;
    const rawSource = row.raw_transcript ?? row.cleaned_transcript;
    const needsChunking = rawSource.length >= CHUNK_THRESHOLD;

    let result: BulletsStepOutput;
    if (needsChunking) {
      const rawChunks = splitForProcessing(rawSource, row.sections);
      // Re-split the cleaned transcript at the same proportional boundaries
      const cleanedChunks = splitForProcessing(row.cleaned_transcript, row.sections);
      // Use min length so we never index out of bounds if chunk counts differ
      const chunkCount = Math.min(rawChunks.length, cleanedChunks.length);
      const bulletChunks = await Promise.all(
        Array.from({ length: chunkCount }, (_, ci) => {
          // Section filtering uses raw chunks where headings are intact
          const chunkSections = row.sections.filter((s) =>
            rawChunks[ci].includes(s.heading)
          );
          return generatePrepBullets(
            cleanedChunks[ci],
            row.entity_tags,
            chunkSections,
            row.transcript_source
          );
        })
      );
      result = {
        prep_bullets: mergePrepBullets(bulletChunks.map((b) => b.prep_bullets)),
        prompt_context_snapshot: bulletChunks[0]?.prompt_context_snapshot,
      };
    } else {
      result = await generatePrepBullets(
        row.cleaned_transcript,
        row.entity_tags,
        row.sections,
        row.transcript_source
      );
    }

    await writeBulletsResult(id, result, { force: true });

    // Cache invalidation is best-effort — bullets are already persisted
    try {
      const fundNames = extractFundNames(row.entity_tags);
      await invalidateFundOverviewCache(fundNames);
    } catch (cacheErr) {
      console.error(
        `[reprocessBullets] cache invalidation failed for ${id}:`,
        cacheErr instanceof Error ? cacheErr.message : cacheErr
      );
    }

    console.log(`[reprocessBullets] complete: ${title}`);
    return result;
  } catch (err) {
    console.error(
      `[reprocessBullets] failed: ${id} — ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
}

export async function processBatch(
  limit: number
): Promise<{ processed: number; failed: number }> {
  const rows = await listAppearances({ status: "queued", limit });

  let processed = 0;
  let failed = 0;

  console.log(`[batch] Starting batch of ${rows.length} appearances`);
  for (let i = 0; i < rows.length; i++) {
    const rowTitle = rows[i].title ?? rows[i].source_url;
    console.log(`\n[batch] ═══ ${i + 1}/${rows.length}: ${rowTitle} ═══`);
    try {
      await processAppearance(rows[i].id);
      processed++;
    } catch (err) {
      failed++;
      console.error(`[batch] ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Rate-limit before next Colossus URL to avoid anti-bot detection
    if (
      i < rows.length - 1 &&
      (rows[i].transcript_source === "colossus" ||
        rows[i + 1].transcript_source === "colossus")
    ) {
      await colossusDelay();
    }
  }

  console.log(`\n[batch] Done — ${processed} processed, ${failed} failed out of ${rows.length}`);
  return { processed, failed };
}

export async function processOne(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await processAppearance(id);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
