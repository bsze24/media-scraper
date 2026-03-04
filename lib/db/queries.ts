import { createServerClient } from "./client";
import type {
  AppearanceRow,
  CreateAppearanceInput,
  ManualIngestInput,
  ExtractStepOutput,
  CleanStepOutput,
  EntitiesStepOutput,
  BulletsStepOutput,
} from "./types";
import type { ProcessingStatus, EntityTags } from "@/types/appearance";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getAppearanceById(
  id: string
): Promise<AppearanceRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw error;
  }
  return data as AppearanceRow;
}

export async function getAppearanceByUrl(
  sourceUrl: string
): Promise<AppearanceRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .select("*")
    .eq("source_url", sourceUrl)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as AppearanceRow;
}

export async function listAppearances(options?: {
  status?: ProcessingStatus;
  limit?: number;
  offset?: number;
}): Promise<AppearanceRow[]> {
  const supabase = createServerClient();
  let query = supabase
    .from("appearances")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("processing_status", options.status);
  }
  if (options?.offset != null) {
    query = query.range(
      options.offset,
      options.offset + (options.limit ?? 50) - 1
    );
  } else if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AppearanceRow[];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function insertAppearance(
  input: CreateAppearanceInput
): Promise<AppearanceRow> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .insert({
      source_url: input.source_url,
      transcript_source: input.transcript_source,
      source_name: input.source_name ?? null,
      title: input.title ?? null,
      appearance_date: input.appearance_date ?? null,
      speakers: input.speakers ?? [],
      processing_status: "queued",
    })
    .select()
    .single();

  if (error) throw error;
  return data as AppearanceRow;
}

export async function insertManualAppearance(
  input: ManualIngestInput
): Promise<AppearanceRow> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .insert({
      source_url: input.source_url,
      transcript_source: "manual" as const,
      source_name: input.source_name,
      title: input.title,
      appearance_date: input.appearance_date ?? null,
      speakers: input.speakers,
      raw_transcript: input.raw_transcript,
      processing_status: "queued",
    })
    .select()
    .single();

  if (error) throw error;
  return data as AppearanceRow;
}

// ---------------------------------------------------------------------------
// Pipeline step updates
// ---------------------------------------------------------------------------

/**
 * Atomically claim a row for processing by transitioning from expectedStatus
 * to newStatus. Returns true if the claim succeeded (row was in expected state).
 */
export async function claimForProcessing(
  id: string,
  expectedStatus: ProcessingStatus,
  newStatus: ProcessingStatus
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .update({ processing_status: newStatus, processing_error: null })
    .eq("id", id)
    .eq("processing_status", expectedStatus)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function updateProcessingStatus(
  id: string,
  status: ProcessingStatus,
  error?: string | null
): Promise<void> {
  const supabase = createServerClient();
  const { error: dbError } = await supabase
    .from("appearances")
    .update({
      processing_status: status,
      processing_error: error ?? null,
    })
    .eq("id", id);

  if (dbError) throw dbError;
}

export async function writeExtractResult(
  id: string,
  output: ExtractStepOutput
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("appearances")
    .update({
      title: output.title,
      appearance_date: output.appearance_date,
      source_name: output.source_name,
      speakers: output.speakers,
      raw_transcript: output.raw_transcript,
      raw_caption_data: output.raw_caption_data ?? null,
      turns: output.turns ?? null,
      sections: output.sections ?? [],
    })
    .eq("id", id);

  if (error) throw error;
}

export async function writeCleanResult(
  id: string,
  output: CleanStepOutput,
  options?: { force?: boolean }
): Promise<boolean> {
  const supabase = createServerClient();

  if (!options?.force) {
    const { data } = await supabase
      .from("appearances")
      .select("cleaned_transcript")
      .eq("id", id)
      .single();

    if (data?.cleaned_transcript != null) return false;
  }

  const { error } = await supabase
    .from("appearances")
    .update({ cleaned_transcript: output.cleaned_transcript })
    .eq("id", id);

  if (error) throw error;
  return true;
}

export async function writeEntitiesResult(
  id: string,
  output: EntitiesStepOutput,
  options?: { force?: boolean }
): Promise<boolean> {
  const supabase = createServerClient();

  if (!options?.force) {
    const { data } = await supabase
      .from("appearances")
      .select("entity_tags")
      .eq("id", id)
      .single();

    if (data && Object.keys(data.entity_tags ?? {}).length > 0) return false;
  }

  const { error } = await supabase
    .from("appearances")
    .update({ entity_tags: output.entity_tags })
    .eq("id", id);

  if (error) throw error;
  return true;
}

export async function writeBulletsResult(
  id: string,
  output: BulletsStepOutput,
  options?: { force?: boolean }
): Promise<boolean> {
  const supabase = createServerClient();

  if (!options?.force) {
    const { data } = await supabase
      .from("appearances")
      .select("prep_bullets")
      .eq("id", id)
      .single();

    if (data && Object.keys(data.prep_bullets ?? {}).length > 0) return false;
  }

  const { error } = await supabase
    .from("appearances")
    .update({ prep_bullets: output.prep_bullets })
    .eq("id", id);

  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// Fund overview cache
// ---------------------------------------------------------------------------

export async function invalidateFundOverviewCache(
  fundNames: string[]
): Promise<void> {
  if (fundNames.length === 0) return;
  const supabase = createServerClient();
  const { error } = await supabase
    .from("fund_overview_cache")
    .delete()
    .in("fund_name", fundNames);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchByFundName(
  fundName: string
): Promise<AppearanceRow[]> {
  const supabase = createServerClient();

  // Tier 1a: Entity tag containment — fund name in entity_tags.fund_names
  // Tier 1b: Entity tag containment — fund name in aliases
  // Tier 2: Full-text search on transcript
  // All three queries are independent — run in parallel
  const [nameResult, aliasResult, ftsResult] = await Promise.all([
    supabase
      .from("appearances")
      .select("*")
      .contains("entity_tags", { fund_names: [{ name: fundName }] })
      .eq("processing_status", "complete")
      .order("appearance_date", { ascending: false }),
    supabase
      .from("appearances")
      .select("*")
      .contains("entity_tags", { fund_names: [{ aliases: [fundName] }] })
      .eq("processing_status", "complete")
      .order("appearance_date", { ascending: false }),
    supabase
      .from("appearances")
      .select("*")
      .textSearch("transcript_search_vector", fundName, { type: "plain" })
      .eq("processing_status", "complete")
      .order("appearance_date", { ascending: false }),
  ]);

  if (nameResult.error) throw nameResult.error;
  if (aliasResult.error) throw aliasResult.error;
  if (ftsResult.error) throw ftsResult.error;

  const tagHits = [...(nameResult.data ?? []), ...(aliasResult.data ?? [])];
  const ftsHits = ftsResult.data;

  // Merge & deduplicate — entity tag matches first (higher confidence)
  const seen = new Set<string>();
  const results: AppearanceRow[] = [];
  for (const row of [...(tagHits ?? []), ...(ftsHits ?? [])]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      results.push(row as AppearanceRow);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export async function countByStatus(): Promise<
  Record<ProcessingStatus | "total", number>
> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .select("processing_status");

  if (error) throw error;

  const counts: Record<ProcessingStatus | "total", number> = {
    queued: 0,
    extracting: 0,
    cleaning: 0,
    analyzing: 0,
    complete: 0,
    failed: 0,
    total: 0,
  };

  for (const row of data ?? []) {
    const s = row.processing_status as ProcessingStatus;
    if (s in counts) counts[s]++;
    counts.total++;
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractFundNames(entityTags: EntityTags): string[] {
  return (entityTags.fund_names ?? []).map((f) => f.name);
}
