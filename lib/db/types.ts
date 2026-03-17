import type {
  Appearance,
  EntityTags,
  ProcessingStatus,
  Speaker,
  TranscriptSource,
  Turn,
} from "@/types/appearance";
import type { PrepBulletsData } from "@/types/bullets";
import type { SectionHeading } from "@/types/scraper";

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
  scraper_metadata: Record<string, unknown> | null;
  cleaned_transcript: string | null;
  entity_tags: EntityTags;
  prep_bullets: PrepBulletsData;
  turns: Turn[] | null;
  turn_summaries: Array<{ speaker: string; summary: string; turn_index: number }> | null;
  sections: SectionHeading[];
  processing_status: ProcessingStatus;
  processing_detail: string | null;
  prompt_context_snapshot: string | null;
  bullets_generated_at: string | null;
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
  scraper_metadata?: Record<string, unknown> | null;
  turns?: Turn[];
  sections?: SectionHeading[];
}

export interface CleanStepOutput {
  cleaned_transcript: string;
}

export interface EntitiesStepOutput {
  entity_tags: EntityTags;
}

export interface BulletsStepOutput {
  prep_bullets: PrepBulletsData;
  prompt_context_snapshot?: string;
}

/** Lightweight projection for list views — omits full transcripts and large JSONB */
export type AppearanceListRow = Pick<
  AppearanceRow,
  | "id"
  | "title"
  | "source_name"
  | "appearance_date"
  | "speakers"
  | "processing_status"
  | "processing_detail"
  | "processing_error"
  | "updated_at"
  | "source_url"
  | "created_at"
  | "prep_bullets"
  | "entity_tags"
>;
