import {
  getAppearanceById,
  listAppearances,
  updateProcessingStatus,
  writeExtractResult,
  writeCleanResult,
  writeEntitiesResult,
  writeBulletsResult,
  invalidateFundOverviewCache,
  extractFundNames,
} from "@lib/db/queries";
import { getScraperForUrl } from "@lib/scrapers/registry";
import { colossusDelay } from "@lib/scrapers/colossus";
import { cleanTranscript } from "@lib/pipeline/clean";
import { extractEntities } from "@lib/pipeline/entities";
import { generatePrepBullets } from "@lib/pipeline/bullets";
import type { ExtractStepOutput } from "@lib/db/types";

export async function processAppearance(id: string): Promise<void> {
  const row = await getAppearanceById(id);
  if (!row) throw new Error(`Appearance not found: ${id}`);

  if (row.processing_status !== "queued" && row.processing_status !== "failed") {
    throw new Error(
      `Cannot process appearance ${id}: status is "${row.processing_status}", expected "queued" or "failed"`
    );
  }

  try {
    // Step 1: Extract
    await updateProcessingStatus(id, "extracting");
    const scraper = getScraperForUrl(row.source_url);
    const result = await scraper.extract(row.source_url);

    const extractOutput: ExtractStepOutput = {
      title: result.title,
      appearance_date: result.appearanceDate,
      source_name: result.sourceName,
      speakers: result.speakers,
      raw_transcript: result.rawTranscript,
      raw_caption_data: result.captionData,
    };
    await writeExtractResult(id, extractOutput);

    // Step 2: Clean
    await updateProcessingStatus(id, "cleaning");
    const cleanOutput = await cleanTranscript(result.rawTranscript);
    await writeCleanResult(id, cleanOutput, { force: true });

    // Step 3: Entities
    await updateProcessingStatus(id, "analyzing");
    const entitiesOutput = await extractEntities(cleanOutput.cleaned_transcript);
    await writeEntitiesResult(id, entitiesOutput, { force: true });

    // Step 4: Bullets (still "analyzing")
    const bulletsOutput = await generatePrepBullets(
      cleanOutput.cleaned_transcript,
      entitiesOutput.entity_tags,
      result.sections,
      result.transcriptSource
    );
    await writeBulletsResult(id, bulletsOutput, { force: true });

    // Done
    await updateProcessingStatus(id, "complete");

    const fundNames = extractFundNames(entitiesOutput.entity_tags);
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
