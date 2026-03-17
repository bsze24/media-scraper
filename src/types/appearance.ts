import type { PrepBulletsData } from "./bullets";
import type { SectionHeading } from "./scraper";

export type TranscriptSource =
  | "colossus"
  | "capital_allocators"
  | "acquired"
  | "odd_lots"
  | "youtube_captions"
  | "youtube_whisper"
  | "manual"
  | "other";

export type ProcessingStatus =
  | "queued"
  | "extracting"
  | "cleaning"
  | "analyzing"
  | "complete"
  | "failed";

export function isYouTubeSource(source: TranscriptSource): boolean {
  return source === "youtube_captions" || source === "youtube_whisper";
}

export type SpeakerRole =
  | "host"
  | "guest"
  | "panelist"
  | "moderator"
  | "interviewer";

export interface Speaker {
  name: string;
  role: SpeakerRole;
  affiliation?: string;
}

export type TurnAttribution = "source" | "derived" | "inferred";

export interface Turn {
  speaker: string;
  text: string;
  turn_index: number;
  section_anchor?: string;
  corrected?: boolean;
  timestamp_seconds?: number;
  attribution?: TurnAttribution;
}

export interface Appearance {
  id: string;
  source_url: string;
  transcript_source: TranscriptSource;
  source_name: string | null;
  title: string | null;
  appearance_date: string | null; // ISO date string (DATE column)
  speakers: Speaker[];
  raw_transcript: string | null;
  scraper_metadata: Record<string, unknown> | null;
  cleaned_transcript: string | null;
  entity_tags: EntityTags;
  prep_bullets: PrepBulletsData;
  processing_status: ProcessingStatus;
  turns: Turn[] | null;
  turn_summaries: Array<{ speaker: string; summary: string; turn_index: number }> | null;
  sections: SectionHeading[];
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityTags {
  fund_names?: FundName[];
  key_people?: KeyPerson[];
  sectors_themes?: string[];
  portfolio_companies?: string[];
}

export interface FundName {
  name: string;
  aliases: string[];
  type: "standalone" | "subsidiary";
  parent?: string;
  relevance?: "primary" | "mentioned";
}

export interface KeyPerson {
  name: string;
  title: string;
  fund_affiliation: string;
}

export type { PrepBulletsData, SupportingQuote } from "./bullets";
