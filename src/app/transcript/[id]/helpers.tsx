import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Search & Highlight
// ---------------------------------------------------------------------------

interface SearchTerm {
  text: string;
  type: "word" | "exact" | "exclude";
}

export function parseSearchQuery(raw: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  const regex = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const neg = match[1] || match[3];
    const text = match[2] || match[4];
    if (!text || text.length < 2) continue;
    if (neg) {
      terms.push({ text, type: "exclude" });
    } else if (match[2] !== undefined) {
      terms.push({ text, type: "exact" });
    } else {
      terms.push({ text, type: "word" });
    }
  }
  return terms;
}

function buildTermRegex(term: SearchTerm): RegExp {
  const escaped = term.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (term.type === "exact") {
    return new RegExp(escaped, "gi");
  }
  return new RegExp(`\\b${escaped}`, "gi");
}

export function matchesTurn(text: string, terms: ReturnType<typeof parseSearchQuery>): boolean {
  for (const term of terms) {
    const re = buildTermRegex(term);
    const found = re.test(text);
    if (term.type === "exclude" && found) return false;
    if (term.type !== "exclude" && !found) return false;
  }
  return true;
}

function buildHighlightRegex(terms: SearchTerm[]): RegExp | null {
  const positive = terms.filter((t) => t.type !== "exclude");
  if (positive.length === 0) return null;
  const parts = positive.map((t) => {
    const escaped = t.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return t.type === "exact" ? escaped : `\\b${escaped}`;
  });
  return new RegExp(`(${parts.join("|")})`, "gi");
}

export function highlightText(text: string, query: string): ReactNode {
  if (!query || query.length < 2) return text;
  const terms = parseSearchQuery(query);
  const re = buildHighlightRegex(terms);
  if (!re) return text;
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-yellow-200 px-0.5">
        {p}
      </mark>
    ) : (
      p
    )
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function firstSentence(text: string): { first: string; hasMore: boolean } {
  const dotIdx = text.indexOf(". ");
  if (dotIdx > 0 && dotIdx < text.length - 2) {
    return { first: text.slice(0, dotIdx + 1), hasMore: true };
  }
  return { first: text, hasMore: false };
}
