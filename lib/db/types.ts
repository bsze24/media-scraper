import type {
  Appearance,
  EntityTags,
  ProcessingStatus,
  Speaker,
  TranscriptSource,
} from "@/types/appearance";
import type { PrepBulletsData } from "@/types/bullets";

// Database row type — matches the appearances table schema exactly
export interface AppearanceRow {
  id: string;
  source_url: string;
  transcript_source: TranscriptSource;
  source_name: string | null;
  title: string | null;
  appearance_date: string | null;
  speakers: Speaker[];
  raw_transcript: string | null;
  raw_caption_data: Record<string, unknown> | null;
  cleaned_transcript: string | null;
  entity_tags: EntityTags;
  prep_bullets: PrepBulletsData;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

// Input for creating a new appearance (URL submission)
export interface CreateAppearanceInput {
  source_url: string;
  transcript_source: TranscriptSource;
  source_name?: string;
  title?: string;
  appearance_date?: string;
  speakers?: Speaker[];
}

// Input for manual transcript ingest
export interface ManualIngestInput {
  source_url: string;
  raw_transcript: string;
  title: string;
  appearance_date?: string;
  source_name: string;
  speakers: Speaker[];
}

// Fields that each pipeline step writes
export interface ExtractStepOutput {
  title?: string;
  appearance_date?: string | null;
  source_name?: string;
  speakers?: Speaker[];
  raw_transcript: string;
  raw_caption_data?: Record<string, unknown> | null;
}

export interface CleanStepOutput {
  cleaned_transcript: string;
}

export interface EntitiesStepOutput {
  entity_tags: EntityTags;
}

export interface BulletsStepOutput {
  prep_bullets: PrepBulletsData;
}

// Coerce DB row to application type (they're identical for now)
export function toAppearance(row: AppearanceRow): Appearance {
  return row;
}
