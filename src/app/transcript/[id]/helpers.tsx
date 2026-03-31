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

export function highlightQuote(text: string, quote: string): ReactNode {
  if (!quote) return text;
  // Match the first 80 chars of the quote (same prefix used for turn matching)
  const prefix = quote.slice(0, 80);
  const idx = text.indexOf(prefix);
  if (idx === -1) return text;
  // Find the full extent of the quote in the text
  const endIdx = quote.length <= text.length - idx && text.slice(idx, idx + quote.length) === quote
    ? idx + quote.length
    : idx + prefix.length;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-[#b8860b]/20 px-0.5">{text.slice(idx, endIdx)}</mark>
      {text.slice(endIdx)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Keyboard badge styling — unified treatment for all [key] shortcut indicators
// ---------------------------------------------------------------------------

export const KBD_CLASS =
  "hidden md:inline-flex items-center justify-center font-mono text-[10px] bg-[#f0eeeb] border border-[#ddd9d3] px-1.5 py-0.5 rounded text-[#777]";

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

// ---------------------------------------------------------------------------
// URL param compression — encode turn indices as ranges (0-3,10-12,15)
// ---------------------------------------------------------------------------

/**
 * Compress sorted indices into range notation: [0,1,2,3,10,11,15] → "0-3,10-11,15"
 */
export function compressIndices(indices: number[]): string {
  const unique = [...new Set(indices)].filter((n) => !isNaN(n)).sort((a, b) => a - b);
  if (unique.length === 0) return "";

  const parts: string[] = [];
  let start = unique[0];
  let end = unique[0];

  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === end + 1) {
      end = unique[i];
    } else {
      parts.push(start === end ? String(start) : `${start}-${end}`);
      start = unique[i];
      end = unique[i];
    }
  }
  parts.push(start === end ? String(start) : `${start}-${end}`);

  return parts.join(",");
}

/**
 * Parse range notation back to indices: "0-3,10-12,15" → [0,1,2,3,10,11,12,15]
 * Backward-compatible with old comma-separated format: "0,1,2,3" → [0,1,2,3]
 */
const MAX_RANGE_SPAN = 10_000;

export function parseIndices(param: string): number[] {
  if (!param) return [];
  const result = new Set<number>();

  for (const token of param.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const dashIdx = trimmed.indexOf("-");
    if (dashIdx > 0) {
      const startStr = trimmed.slice(0, dashIdx);
      const endStr = trimmed.slice(dashIdx + 1);
      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) continue;
      const start = Number(startStr);
      const end = Number(endStr);
      if (!isFinite(start) || !isFinite(end) || end < start || end - start > MAX_RANGE_SPAN) continue;
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      if (!/^\d+$/.test(trimmed)) continue;
      const n = Number(trimmed);
      if (!isFinite(n)) continue;
      result.add(n);
    }
  }

  return [...result].sort((a, b) => a - b);
}

export function firstSentence(text: string): { first: string; hasMore: boolean } {
  const dotIdx = text.indexOf(". ");
  if (dotIdx > 0 && dotIdx < text.length - 2) {
    return { first: text.slice(0, dotIdx + 1), hasMore: true };
  }
  return { first: text, hasMore: false };
}
