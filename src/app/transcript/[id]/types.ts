export interface TranscriptViewerProps {
  appearance: {
    id: string;
    title: string;
    date: string; // formatted: "Jan 12, 2024"
    source_name: string; // e.g. "Invest Like the Best · Colossus"
    youtube_id: string | null;
    speakers: Array<{
      name: string;
      role: "guest" | "host";
      title?: string; // e.g. "CEO"
      affiliation?: string; // e.g. "Apollo Global Management"
    }>;
    sections: Array<{
      heading: string;
      anchor: string;
    }>;
    turns: Array<{
      speaker: string;
      role: "guest" | "host";
      text: string;
      turn_index: number;
      section_anchor?: string;
      attribution?: "source" | "inferred";
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
    bullets_generated_at: string | null;
    transcript_char_count: number;
  };
}
