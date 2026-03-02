import type { Speaker, TranscriptSource } from "./appearance";

export interface SectionHeading {
  heading: string;
  anchor: string;
}

export interface ScraperResult {
  title: string;
  appearanceDate: string | null; // ISO date string
  sourceName: string;
  transcriptSource: TranscriptSource;
  speakers: Speaker[];
  rawTranscript: string;
  captionData: Record<string, unknown> | null;
  sections: SectionHeading[];
  sourceUrl: string;
}

export interface Scraper {
  canHandle(url: string): boolean;
  extract(url: string): Promise<ScraperResult>;
}
