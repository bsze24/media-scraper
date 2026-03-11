import {
  getAppearanceById,
  listAppearances,
  updateProcessingStatus,
  claimForProcessing,
  writeExtractResult,
  writeCleanResult,
  writeEntitiesResult,
  writeBulletsResult,
  invalidateFundOverviewCache,
  extractFundNames,
} from "@lib/db/queries";
import { getScraperForUrl } from "@lib/scrapers/registry";
import { colossusDelay } from "@lib/scrapers/colossus";
import { parseTurns } from "@lib/scrapers/parse-turns";
import { cleanTranscript } from "@lib/pipeline/clean";
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

  try {
    // Step 1: Extract

    let rawTranscript: string;
    let sections: import("@/types/scraper").SectionHeading[] = [];
    let transcriptSource = row.transcript_source;

    if (row.raw_transcript) {
      // Manual ingest — transcript already provided, skip scraper
      rawTranscript = row.raw_transcript;
      // Parse turns for manual transcripts too
      const turns = parseTurns(rawTranscript);
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

      const extractOutput: ExtractStepOutput = {
        title: result.title,
        appearance_date: result.appearanceDate,
        source_name: result.sourceName,
        speakers: result.speakers,
        raw_transcript: result.rawTranscript,
        raw_caption_data: result.captionData,
        turns: parseTurns(result.rawTranscript, result.sections),
        sections: result.sections,
      };
      await writeExtractResult(id, extractOutput);
    }

    const CHUNK_THRESHOLD = 120_000;
    const needsChunking = rawTranscript.length >= CHUNK_THRESHOLD;
    const rawChunks = needsChunking
      ? splitForProcessing(rawTranscript, sections)
      : null;

    // Step 2: Clean
    await updateProcessingStatus(id, "cleaning");
    let finalCleaned: string;
    // Store per-chunk cleaned results so steps 3-4 can reuse them directly
    // instead of re-splitting finalCleaned with raw section headings
    // (which may not survive LLM cleaning).
    let cleanedChunks: string[] | null = null;
    if (rawChunks) {
      // Clean chunks in parallel
      cleanedChunks = await Promise.all(
        rawChunks.map((chunk) =>
          cleanTranscript(chunk).then((o) => o.cleaned_transcript)
        )
      );
      finalCleaned = mergeCleaned(cleanedChunks);
    } else {
      const cleanOutput = await cleanTranscript(rawTranscript);
      finalCleaned = cleanOutput.cleaned_transcript;
    }
    await writeCleanResult(id, { cleaned_transcript: finalCleaned });

    // Step 3: Entities
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

    // Step 4: Bullets (still "analyzing")
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

    // Done
    await updateProcessingStatus(id, "complete");

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

  for (let i = 0; i < rows.length; i++) {
    try {
      await processAppearance(rows[i].id);
      processed++;
    } catch {
      failed++;
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
