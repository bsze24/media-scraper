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
import type { ProcessingStatus } from "@/types/appearance";

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
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(
      options.offset,
      options.offset + (options.limit ?? 50) - 1
    );
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

export async function updateProcessingStatus(
  id: string,
  status: ProcessingStatus,
  error?: string
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
    })
    .eq("id", id);

  if (error) throw error;
}

export async function writeCleanResult(
  id: string,
  output: CleanStepOutput
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("appearances")
    .update({ cleaned_transcript: output.cleaned_transcript })
    .eq("id", id);

  if (error) throw error;
}

export async function writeEntitiesResult(
  id: string,
  output: EntitiesStepOutput
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("appearances")
    .update({ entity_tags: output.entity_tags })
    .eq("id", id);

  if (error) throw error;
}

export async function writeBulletsResult(
  id: string,
  output: BulletsStepOutput
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("appearances")
    .update({ prep_bullets: output.prep_bullets })
    .eq("id", id);

  if (error) throw error;
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
