export interface SupportingQuote {
  quote: string;
  timestamp_seconds: number | null;
  timestamp_display: string | null;
  section: string | null;
  section_anchor: string | null;
  speaker: string | null;
}

export interface PrepBullet {
  text: string;
  supporting_quotes: SupportingQuote[];
  vote: "up" | "down" | null;
  vote_note: string | null;
}

export interface RowspaceAngle {
  text: string;
  vote: "up" | "down" | null;
  vote_note: string | null;
}

export interface PrepBulletsData {
  bullets?: PrepBullet[];
  rowspace_angles?: RowspaceAngle[];
}
