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
        turns: parseTurns(result.rawTranscript),
        sections: result.sections,
      };
      await writeExtractResult(id, extractOutput);
    }

    const CHUNK_THRESHOLD = 120_000;
    const needsChunking = rawTranscript.length >= CHUNK_THRESHOLD;
    const chunks = needsChunking
      ? splitForProcessing(rawTranscript, sections)
      : null;

    // Step 2: Clean
    await updateProcessingStatus(id, "cleaning");
    let finalCleaned: string;
    // Store per-chunk cleaned results so steps 3-4 can reuse them directly
    // instead of re-splitting finalCleaned with raw section headings
    // (which may not survive LLM cleaning).
    let cleanedChunks: string[] | null = null;
    if (chunks) {
      cleanedChunks = [];
      for (const chunk of chunks) {
        const out = await cleanTranscript(chunk);
        cleanedChunks.push(out.cleaned_transcript);
      }
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
      const entityChunks = [];
      for (const chunk of cleanedChunks) {
        entityChunks.push(await extractEntities(chunk));
      }
      finalEntities = {
        entity_tags: mergeEntityTags(entityChunks.map((e) => e.entity_tags)),
      };
    } else {
      finalEntities = await extractEntities(finalCleaned);
    }
    await writeEntitiesResult(id, finalEntities);

    // Step 4: Bullets (still "analyzing")
    let finalBullets: BulletsStepOutput;
    if (cleanedChunks) {
      const bulletChunks = [];
      for (const chunk of cleanedChunks) {
        bulletChunks.push(
          await generatePrepBullets(
            chunk,
            finalEntities.entity_tags,
            sections,
            transcriptSource
          )
        );
      }
      finalBullets = {
        prep_bullets: mergePrepBullets(bulletChunks.map((b) => b.prep_bullets)),
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

    const fundNames = extractFundNames(finalEntities.entity_tags);
    await invalidateFundOverviewCache(fundNames);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateProcessingStatus(id, "failed", message);
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

    // Rate-limit between items, but not after the last one
    if (i < rows.length - 1) {
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
