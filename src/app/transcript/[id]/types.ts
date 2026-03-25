export interface TranscriptViewerProps {
  appearance: {
    id: string;
    title: string;
    date: string; // formatted: "Jan 12, 2024"
    source_name: string; // e.g. "Invest Like the Best · Colossus"
    youtube_id: string | null;
    speakers: Array<{
      name: string;
      role: "host" | "guest" | "rowspace" | "customer" | "other";
      title?: string; // e.g. "CEO"
      affiliation?: string; // e.g. "Apollo Global Management"
    }>;
    sections: Array<{
      heading: string;
      anchor: string;
      turn_index?: number;
      start_time?: number;
      source?: "source" | "derived" | "inferred";
    }>;
    turns: Array<{
      speaker: string;
      role?: "host" | "guest" | "rowspace" | "customer" | "other";
      text: string;
      turn_index: number;
      section_anchor?: string;
      corrected?: boolean;
      timestamp_seconds?: number;
      attribution?: "source" | "derived" | "inferred";
    }>;
    has_inferred_attribution: boolean;
    prep_bullets: Array<{
      text: string;
      supporting_quotes: Array<{
        quote: string;
        speaker: string;
        section_anchor: string | null;
      }>;
    }>;
    turn_summaries: Record<number, string> | null; // turn_index → summary text
    bullets_generated_at: string | null;
    transcript_char_count: number;
    default_view_params: string | null;
  };
}
