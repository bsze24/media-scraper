"use client";

import {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import type { TranscriptViewerProps } from "./types";
import { RegenerateBulletsButton } from "./RegenerateBulletsButton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a search query into terms.
 *   - "exact phrase" → exact substring match
 *   - -term → exclude turns containing term (word-boundary)
 *   - term → word-boundary match (default)
 *
 * Multiple terms are ANDed together.
 */
interface SearchTerm {
  text: string;
  type: "word" | "exact" | "exclude";
}

function parseSearchQuery(raw: string): SearchTerm[] {
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
  // Word-boundary: \b works for most cases
  return new RegExp(`\\b${escaped}`, "gi");
}

function matchesTurn(text: string, terms: SearchTerm[]): boolean {
  for (const term of terms) {
    const re = buildTermRegex(term);
    const found = re.test(text);
    if (term.type === "exclude" && found) return false;
    if (term.type !== "exclude" && !found) return false;
  }
  return true;
}

/** Build a combined regex for all positive terms (for highlighting). */
function buildHighlightRegex(terms: SearchTerm[]): RegExp | null {
  const positive = terms.filter((t) => t.type !== "exclude");
  if (positive.length === 0) return null;
  const parts = positive.map((t) => {
    const escaped = t.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return t.type === "exact" ? escaped : `\\b${escaped}`;
  });
  return new RegExp(`(${parts.join("|")})`, "gi");
}

function highlightText(text: string, query: string): ReactNode {
  if (!query || query.length < 2) return text;
  const terms = parseSearchQuery(query);
  const re = buildHighlightRegex(terms);
  if (!re) return text;
  // split with capturing group: odd indices are matches, even are gaps
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

function firstSentence(text: string): { first: string; hasMore: boolean } {
  const dotIdx = text.indexOf(". ");
  if (dotIdx > 0 && dotIdx < text.length - 2) {
    return { first: text.slice(0, dotIdx + 1), hasMore: true };
  }
  return { first: text, hasMore: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BulletFeedback {
  flagged: boolean;
  comment?: string;
}

export function TranscriptViewer({ appearance }: TranscriptViewerProps) {
  const {
    title,
    date,
    source_name,
    youtube_id,
    speakers,
    sections,
    turns,
    has_inferred_attribution,
    turn_summaries,
    prep_bullets,
    bullets_generated_at,
    transcript_char_count,
  } = appearance;

  const allAnchors = useMemo(() => sections.map((s) => s.anchor), [sections]);

  // Bullet anchors for gold TOC dots
  const bulletAnchors = useMemo(() => {
    const set = new Set<string>();
    for (const b of prep_bullets) {
      for (const sq of b.supporting_quotes) {
        if (sq.section_anchor) set.add(sq.section_anchor);
      }
    }
    return set;
  }, [prep_bullets]);

  // Group turns by section_anchor; turns before the first heading go into "__intro"
  const INTRO_ANCHOR = "__intro";
  const turnsBySection = useMemo(() => {
    const map = new Map<string, typeof turns>();
    map.set(INTRO_ANCHOR, []);
    for (const a of allAnchors) {
      map.set(a, []);
    }
    for (const t of turns) {
      const key = t.section_anchor && map.has(t.section_anchor)
        ? t.section_anchor
        : INTRO_ANCHOR;
      map.get(key)!.push(t);
    }
    return map;
  }, [turns, allAnchors]);

  // ---- State ----
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >(() => {
    const m: Record<string, boolean> = {};
    allAnchors.forEach((a) => (m[a] = true));
    return m;
  });
  const [expandedHostTurns, setExpandedHostTurns] = useState<
    Record<string, boolean>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [feedback, setFeedback] = useState<Record<number, BulletFeedback>>({});
  const [floatingPanel, setFloatingPanel] = useState<{
    idx: number;
  } | null>(null);
  const [panelDraft, setPanelDraft] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  const panelInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Focus panel input on open
  useEffect(() => {
    if (floatingPanel !== null) {
      setTimeout(() => panelInputRef.current?.focus(), 0);
    }
  }, [floatingPanel]);

  // Escape to close panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFloatingPanel(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ---- Search matches (memoized per section) ----
  const searchTerms = useMemo(
    () => parseSearchQuery(debouncedQuery),
    [debouncedQuery]
  );

  const searchResults = useMemo(() => {
    if (searchTerms.length === 0)
      return { anchors: new Set<string>(), turnKeys: new Set<string>(), countBySection: new Map<string, number>() };

    const anchors = new Set<string>();
    const turnKeys = new Set<string>();
    const countBySection = new Map<string, number>();

    // Include intro turns in search
    const allKeys = [INTRO_ANCHOR, ...sections.map((s) => s.anchor)];
    for (const anchor of allKeys) {
      const sectionTurns = turnsBySection.get(anchor) ?? [];
      let count = 0;
      sectionTurns.forEach((turn, ti) => {
        if (matchesTurn(turn.text, searchTerms)) {
          anchors.add(anchor);
          turnKeys.add(`${anchor}-${ti}`);
          count++;
        }
      });
      if (count > 0) countBySection.set(anchor, count);
    }

    return { anchors, turnKeys, countBySection };
  }, [searchTerms, sections, turnsBySection]);

  const hasSearch = searchTerms.length > 0;

  // Update expanded sections when search changes
  useEffect(() => {
    if (hasSearch) {
      const m: Record<string, boolean> = {};
      allAnchors.forEach(
        (a) => (m[a] = searchResults.anchors.has(a))
      );
      setExpandedSections(m);
    } else if (debouncedQuery === "" && !activeSpeaker) {
      // Restore all expanded when search cleared (and no speaker filter)
      const m: Record<string, boolean> = {};
      allAnchors.forEach((a) => (m[a] = true));
      setExpandedSections(m);
    }
  }, [hasSearch, debouncedQuery, searchResults.anchors, allAnchors, activeSpeaker]);

  // ---- Handlers ----
  const handleSpeakerClick = useCallback(
    (name: string) => {
      if (activeSpeaker === name) {
        setActiveSpeaker(null);
        const m: Record<string, boolean> = {};
        allAnchors.forEach((a) => (m[a] = true));
        setExpandedSections(m);
      } else {
        setActiveSpeaker(name);
        const m: Record<string, boolean> = {};
        allAnchors.forEach((a) => {
          m[a] = (turnsBySection.get(a) ?? []).some(
            (t) => t.speaker === name
          );
        });
        setExpandedSections(m);
      }
    },
    [activeSpeaker, allAnchors, turnsBySection]
  );

  const scrollToSection = useCallback(
    (anchor: string) => {
      setExpandedSections((prev) => ({ ...prev, [anchor]: true }));
      setTimeout(() => {
        sectionRefs.current[anchor]?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    },
    []
  );

  const allExpanded = allAnchors.every((a) => expandedSections[a]);
  const allCollapsed = allAnchors.every((a) => !expandedSections[a]);

  const guests = speakers.filter((s) => s.role !== "host");
  const host = speakers.find((s) => s.role === "host");

  // ---- Render ----
  return (
    <div className="min-h-screen bg-[#f9f8f5] text-[#1a1a1a]">
      <div className="mx-auto max-w-[1200px] px-6 pt-9 pb-20">
        {/* HEADER */}
        <div className="mb-7 border-b-2 border-[#1a1a1a] pb-[18px]">
          <div className="mb-2 font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aaa]">
            {source_name}
          </div>
          <h1 className="mb-2 font-[family-name:var(--font-playfair)] text-[26px] font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          <div className="flex flex-wrap items-center gap-4">
            {guests.map((g, i) => (
              <span
                key={g.name}
                className="flex cursor-pointer items-baseline gap-[5px] pb-px font-[family-name:var(--font-source-sans)] transition-colors"
                onClick={() => handleSpeakerClick(g.name)}
                title={
                  activeSpeaker === g.name
                    ? "Clear filter"
                    : `Filter to ${g.name}`
                }
                style={{
                  borderBottom:
                    activeSpeaker === g.name
                      ? "2px solid #c9a84c"
                      : "2px solid transparent",
                  color:
                    activeSpeaker && activeSpeaker !== g.name
                      ? "#bbb"
                      : "#1a1a1a",
                }}
              >
                <span className="text-[13.5px] font-medium">{g.name}</span>
                {(g.title || g.affiliation) && (
                  <span
                    className="text-[11px] font-normal"
                    style={{
                      color:
                        activeSpeaker && activeSpeaker !== g.name
                          ? "#ddd"
                          : "#aaa",
                    }}
                  >
                    {[g.title, g.affiliation].filter(Boolean).join(", ")}
                  </span>
                )}
                {i < guests.length - 1 && (
                  <span className="ml-1.5 text-[#ddd]">·</span>
                )}
              </span>
            ))}
            {host && (
              <span
                className="cursor-pointer pb-px font-[family-name:var(--font-source-sans)] text-xs italic transition-colors"
                onClick={() => handleSpeakerClick(host.name)}
                title={
                  activeSpeaker === host.name
                    ? "Clear filter"
                    : `Filter to ${host.name}`
                }
                style={{
                  color:
                    activeSpeaker && activeSpeaker !== host.name
                      ? "#ddd"
                      : "#bbb",
                  borderBottom:
                    activeSpeaker === host.name
                      ? "2px solid #ccc"
                      : "2px solid transparent",
                }}
              >
                with {host.name}
              </span>
            )}
            <span className="ml-auto font-[family-name:var(--font-source-sans)] text-xs text-[#bbb]">
              {date}
            </span>
          </div>
        </div>

        {/* INFERRED ATTRIBUTION DISCLAIMER */}
        {has_inferred_attribution && (
          <p className="mb-5 font-[family-name:var(--font-source-sans)] text-[11px] text-[#aaa]">
            Speaker labels inferred from auto-captions — may contain errors
          </p>
        )}

        {/* KEY TAKEAWAYS */}
        {prep_bullets.length > 0 && (
          <div className="mb-8">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aaa]">
                Key Takeaways
              </span>
              <RegenerateBulletsButton
                appearanceId={appearance.id}
                bulletsGeneratedAt={bullets_generated_at}
                transcriptCharCount={transcript_char_count}
              />
            </div>
            <div className="overflow-hidden rounded border border-[#e8e3da] bg-white">
              {prep_bullets.map((b, i) => {
                const fb = feedback[i];
                const flagged = !!fb?.flagged;
                const preview =
                  b.text.split(" ").slice(0, 7).join(" ") + "…";
                const firstQuote = b.supporting_quotes[0];

                // Flagged — slim collapsed row
                if (flagged) {
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 border-b border-[#eee] bg-[#fdfcfb] px-3.5 py-1.5 last:border-b-0"
                    >
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-[family-name:var(--font-source-sans)] text-xs italic text-[#ccc]">
                        {preview}
                      </span>
                      <span className="font-[family-name:var(--font-source-sans)] text-[10.5px] tracking-wide text-[#ccc]">
                        flagged
                      </span>
                      <button
                        onClick={() =>
                          setFeedback((prev) => ({
                            ...prev,
                            [i]: { flagged: false },
                          }))
                        }
                        className="rounded border border-[#e0dbd2] px-[7px] py-px font-[family-name:var(--font-source-sans)] text-[11px] text-[#bbb] transition-colors hover:border-[#bbb] hover:text-[#555]"
                      >
                        undo
                      </button>
                    </div>
                  );
                }

                // Normal expanded row
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_auto] items-start gap-x-2.5 border-b border-[#eee] px-3.5 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="font-[family-name:var(--font-source-sans)] text-[13px] leading-relaxed text-[#1a1a1a]">
                        {b.text}
                      </div>
                      {firstQuote && (
                        <div
                          className="mt-0.5 cursor-pointer font-[family-name:var(--font-source-sans)] text-[11.5px] italic leading-snug text-[#888] hover:text-[#555]"
                          onClick={() => {
                            if (firstQuote.section_anchor) {
                              scrollToSection(firstQuote.section_anchor);
                            }
                          }}
                          title="Jump to section"
                        >
                          <span className="mr-0.5 not-italic text-[13px] text-[#c9a84c]">
                            &ldquo;
                          </span>
                          {firstQuote.quote}
                          <span className="ml-1 not-italic text-[#bbb]">
                            — {firstQuote.speaker} ↓
                          </span>
                        </div>
                      )}
                      {fb?.comment && (
                        <div className="mt-0.5 font-[family-name:var(--font-source-sans)] text-[10.5px] italic text-[#bbb]">
                          &ldquo;{fb.comment}&rdquo;
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 pl-2.5 pt-0.5">
                      <button
                        title="Flag as unhelpful"
                        onClick={() => {
                          setPanelDraft("");
                          setFloatingPanel({ idx: i });
                          setFeedback((prev) => ({
                            ...prev,
                            [i]: { ...prev[i], flagged: true },
                          }));
                        }}
                        className="rounded border border-[#e0dbd2] px-1.5 py-px font-[family-name:var(--font-source-sans)] text-xs leading-snug text-[#ccc] transition-colors hover:border-[#bbb] hover:text-[#999]"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* FLOATING FEEDBACK PANEL */}
        {floatingPanel !== null && (() => {
          const b = prep_bullets[floatingPanel.idx];
          const quoteText = b?.supporting_quotes[0]?.quote ?? b?.text ?? "";
          return (
            <div className="fixed right-7 bottom-7 z-50 w-80 rounded-md border border-[#e0dbd2] bg-white p-3.5 shadow-lg font-[family-name:var(--font-source-sans)]">
              <div className="mb-2.5 flex items-start justify-between gap-2.5">
                <div className="text-[11.5px] italic leading-snug text-[#888]">
                  &ldquo;{quoteText.slice(0, 80)}
                  {quoteText.length > 80 ? "…" : ""}&rdquo;
                </div>
                <button
                  onClick={() => setFloatingPanel(null)}
                  className="shrink-0 p-0 text-base leading-none text-[#bbb] hover:text-[#666]"
                >
                  ×
                </button>
              </div>
              <input
                ref={panelInputRef}
                value={panelDraft}
                onChange={(e) => setPanelDraft(e.target.value)}
                placeholder="What's off about this bullet? (optional)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setFeedback((prev) => ({
                      ...prev,
                      [floatingPanel.idx]: {
                        flagged: true,
                        comment: panelDraft || undefined,
                      },
                    }));
                    setFloatingPanel(null);
                  }
                  if (e.key === "Escape") {
                    setFloatingPanel(null);
                  }
                }}
                className="w-full rounded border border-[#e0dbd2] bg-[#fafaf8] px-2 py-1.5 text-xs text-[#333] outline-none focus:border-[#c9a84c]"
              />
              <div className="mt-[7px] flex items-center justify-between">
                <span className="text-[10px] text-[#ccc]">
                  ↵ save · esc dismiss
                </span>
                <button
                  onClick={() => {
                    setFeedback((prev) => ({
                      ...prev,
                      [floatingPanel.idx]: {
                        flagged: true,
                        comment: panelDraft || undefined,
                      },
                    }));
                    setFloatingPanel(null);
                  }}
                  className="rounded bg-[#1a1a1a] px-2.5 py-[3px] text-[11px] text-white"
                >
                  Save
                </button>
              </div>
            </div>
          );
        })()}

        {/* THREE-COLUMN: TOC | BODY | VIDEO */}
        <div
          className="grid items-start gap-x-7"
          style={{
            gridTemplateColumns: videoOpen
              ? "188px 1fr 280px"
              : "188px 1fr 36px",
          }}
        >
          {/* TOC */}
          <div className="sticky top-6">
            {/* Search */}
            <div className="relative mb-4">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#ccc]">
                ⌕
              </span>
              <input
                className="w-full rounded border border-[#ddd] bg-white py-1.5 pr-6 pl-7 font-[family-name:var(--font-source-sans)] text-xs text-[#1a1a1a] outline-none transition-colors focus:border-[#c9a84c]"
                placeholder="Search transcript…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute right-[7px] top-1/2 -translate-y-1/2 p-0 text-sm leading-none text-[#bbb] hover:text-[#666]"
                  onClick={() => {
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {/* Section heading + expand/collapse */}
            <div className="mb-2 flex items-center justify-between">
              <div className="font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aaa]">
                Sections
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  className="rounded border border-[#ddd] px-[5px] font-[family-name:var(--font-source-sans)] text-[15px] font-normal leading-snug text-[#888] transition-colors hover:border-[#aaa] hover:bg-[#f0ece4] hover:text-[#333] disabled:cursor-default disabled:opacity-20 disabled:hover:border-[#ddd] disabled:hover:bg-transparent"
                  onClick={() => {
                    const m: Record<string, boolean> = {};
                    allAnchors.forEach((a) => (m[a] = true));
                    setExpandedSections(m);
                  }}
                  disabled={allExpanded}
                  title="Expand all"
                >
                  +
                </button>
                <span className="text-[11px] text-[#ddd]">·</span>
                <button
                  className="rounded border border-[#ddd] px-[5px] font-[family-name:var(--font-source-sans)] text-[15px] font-normal leading-snug text-[#888] transition-colors hover:border-[#aaa] hover:bg-[#f0ece4] hover:text-[#333] disabled:cursor-default disabled:opacity-20 disabled:hover:border-[#ddd] disabled:hover:bg-transparent"
                  onClick={() => {
                    const m: Record<string, boolean> = {};
                    allAnchors.forEach((a) => (m[a] = false));
                    setExpandedSections(m);
                  }}
                  disabled={allCollapsed}
                  title="Collapse all"
                >
                  −
                </button>
              </div>
            </div>

            {/* Section list */}
            {sections.map((s) => {
              const cited = bulletAnchors.has(s.anchor);
              const hit = hasSearch && searchResults.anchors.has(s.anchor);
              const dim = hasSearch && !hit;

              return (
                <div
                  key={s.anchor}
                  className={`mb-px flex cursor-pointer items-start gap-[7px] rounded px-[7px] py-[5px] transition-colors ${
                    expandedSections[s.anchor] ? "bg-[#edeae2]" : ""
                  } ${dim ? "pointer-events-none opacity-[0.28]" : "hover:bg-[#edeae2]"}`}
                  onClick={() => !dim && scrollToSection(s.anchor)}
                >
                  {hit ? (
                    <span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#5b9bd5]" />
                  ) : cited ? (
                    <span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#c9a84c]" />
                  ) : (
                    <span className="w-[5px] shrink-0" />
                  )}
                  <span
                    className="font-[family-name:var(--font-source-sans)] text-xs leading-snug"
                    style={{
                      color: cited || hit ? "#333" : "#999",
                    }}
                  >
                    {s.heading}
                  </span>
                </div>
              );
            })}

            {/* Legend */}
            <div className="mt-4 flex flex-col gap-1.5 border-t border-[#e5e0d6] pt-3">
              <div className="flex items-center gap-[5px]">
                <span className="h-[5px] w-[5px] rounded-full bg-[#c9a84c]" />
                <span className="font-[family-name:var(--font-source-sans)] text-[10.5px] text-[#bbb]">
                  cited in takeaways
                </span>
              </div>
              {hasSearch && (
                <div className="flex items-center gap-[5px]">
                  <span className="h-[5px] w-[5px] rounded-full bg-[#5b9bd5]" />
                  <span className="font-[family-name:var(--font-source-sans)] text-[10.5px] text-[#5b9bd5]">
                    search match
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* TRANSCRIPT BODY */}
          <div>
            {/* Turns before the first section heading */}
            {(turnsBySection.get(INTRO_ANCHOR)?.length ?? 0) > 0 && (
              <div className="mb-[5px] overflow-hidden rounded border border-[#e5e0d6]">
                <div className="bg-white px-4 py-1 pb-2.5">
                  {turnsBySection.get(INTRO_ANCHOR)!.map((turn, ti) => {
                    const isHost = turn.role === "host";
                    const dimmed =
                      activeSpeaker && activeSpeaker !== turn.speaker;
                    const isTurnHit =
                      hasSearch && searchResults.turnKeys.has(`${INTRO_ANCHOR}-${ti}`);
                    return (
                      <div
                        key={ti}
                        className={`border-b border-[#f0ece5] py-2 last:border-b-0 ${
                          isTurnHit ? "-mx-4 bg-[#eff6ff] px-4" : ""
                        }`}
                        style={dimmed ? { opacity: 0.3 } : undefined}
                      >
                        <div
                          className={`mb-0.5 font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] ${
                            isHost ? "text-[#ccc]" : "text-[#c9a84c]"
                          }`}
                        >
                          {turn.speaker}
                        </div>
                        <p
                          className={`font-[family-name:var(--font-source-sans)] leading-relaxed ${
                            isHost
                              ? "text-[12.5px] italic text-[#bbb]"
                              : "text-[13.5px] leading-[1.65] text-[#1a1a1a]"
                          }`}
                        >
                          {highlightText(turn.text, debouncedQuery)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {sections.map((section) => {
              const sectionTurns = turnsBySection.get(section.anchor) ?? [];
              const isOpen = expandedSections[section.anchor];
              const isCited = bulletAnchors.has(section.anchor);
              const isHit =
                hasSearch && searchResults.anchors.has(section.anchor);
              const isMiss = hasSearch && !isHit;
              const hitCount =
                searchResults.countBySection.get(section.anchor) ?? 0;

              return (
                <div
                  key={section.anchor}
                  ref={(el) => {
                    sectionRefs.current[section.anchor] = el;
                  }}
                  className={`mb-[5px] overflow-hidden rounded border transition-opacity ${
                    isHit
                      ? "border-l-[3px] border-l-[#5b9bd5] border-t-[#e5e0d6] border-r-[#e5e0d6] border-b-[#e5e0d6]"
                      : "border-[#e5e0d6]"
                  } ${isMiss ? "pointer-events-none opacity-25" : ""}`}
                >
                  {/* Section header */}
                  <div
                    className="flex cursor-pointer select-none items-center justify-between bg-[#f2ede5] px-3.5 py-2 transition-colors hover:bg-[#ebe5d8]"
                    onClick={() =>
                      !isMiss &&
                      setExpandedSections((prev) => ({
                        ...prev,
                        [section.anchor]: !prev[section.anchor],
                      }))
                    }
                  >
                    <div className="flex items-center gap-2">
                      {isHit ? (
                        <span className="h-[5px] w-[5px] rounded-full bg-[#5b9bd5]" />
                      ) : isCited ? (
                        <span className="h-[5px] w-[5px] rounded-full bg-[#c9a84c]" />
                      ) : null}
                      <span className="font-[family-name:var(--font-playfair)] text-[13.5px] font-semibold">
                        {section.heading}
                      </span>
                      {isHit && hitCount > 0 && (
                        <span className="font-[family-name:var(--font-source-sans)] text-[10.5px] font-semibold text-[#5b9bd5]">
                          {hitCount} match{hitCount !== 1 ? "es" : ""}
                        </span>
                      )}
                    </div>
                    <span
                      className="inline-block text-[9px] text-[#bbb] transition-transform"
                      style={{
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    >
                      ▶
                    </span>
                  </div>

                  {/* Section body */}
                  {isOpen && (
                    <div className="bg-white px-4 py-1 pb-2.5">
                      {sectionTurns.map((turn, ti) => {
                        const isHost = turn.role === "host";
                        const key = `${section.anchor}-${ti}`;
                        const hostExpanded = expandedHostTurns[key];
                        const isTurnHit =
                          hasSearch && searchResults.turnKeys.has(key);
                        const { first, hasMore } = firstSentence(turn.text);
                        const summary = turn_summaries?.[turn.turn_index];
                        const collapsedText = summary ?? first;
                        const dimmed =
                          activeSpeaker &&
                          activeSpeaker !== turn.speaker;

                        if (isHost) {
                          return (
                            <div
                              key={ti}
                              className={`border-b border-[#f0ece5] py-1.5 last:border-b-0 ${
                                isTurnHit
                                  ? "-mx-4 bg-[#eff6ff] px-4"
                                  : ""
                              }`}
                              style={dimmed ? { opacity: 0.3 } : undefined}
                            >
                              <div className="mb-0.5 font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#ccc]">
                                {turn.speaker}
                              </div>
                              <p className="font-[family-name:var(--font-source-sans)] text-[12.5px] italic leading-relaxed text-[#bbb]">
                                {hostExpanded || isTurnHit
                                  ? highlightText(turn.text, debouncedQuery)
                                  : summary
                                    ? <span className="not-italic text-[#a8a0c0]" title="AI-generated summary">✦ {summary}</span>
                                    : hasMore
                                      ? highlightText(first, debouncedQuery)
                                      : highlightText(turn.text, debouncedQuery)
                                }
                              </p>
                              {(hasMore || summary) && (
                                <span
                                  className="mt-0.5 inline-block cursor-pointer font-[family-name:var(--font-source-sans)] text-[10.5px] text-[#bbb] hover:text-[#777]"
                                  onClick={() =>
                                    setExpandedHostTurns((prev) => ({
                                      ...prev,
                                      [key]: !prev[key],
                                    }))
                                  }
                                >
                                  {hostExpanded ? "▲ less" : "▼ more"}
                                </span>
                              )}
                            </div>
                          );
                        }

                        // Guest turn
                        return (
                          <div
                            key={ti}
                            className={`border-b border-[#f0ece5] py-2.5 last:border-b-0 ${
                              isTurnHit
                                ? "-mx-4 bg-[#eff6ff] px-4"
                                : ""
                            }`}
                            style={dimmed ? { opacity: 0.3 } : undefined}
                          >
                            <div className="mb-1 font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#c9a84c]">
                              {turn.speaker}
                            </div>
                            <p className="font-[family-name:var(--font-source-sans)] text-[13.5px] leading-[1.65] text-[#1a1a1a]">
                              {highlightText(turn.text, debouncedQuery)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* VIDEO PANEL */}
          <div
            className={`sticky top-6 overflow-hidden rounded border-l border-[#e5e0d6] bg-[#faf9f7] transition-all ${
              videoOpen ? "min-h-[120px]" : "min-h-[120px] cursor-pointer"
            }`}
            onClick={!videoOpen ? () => setVideoOpen(true) : undefined}
          >
            {!videoOpen ? (
              <div
                className="cursor-pointer select-none py-4 font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#bbb] hover:text-[#888]"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                }}
              >
                ▶ Watch Episode
              </div>
            ) : (
              <div className="w-full p-3">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="font-[family-name:var(--font-source-sans)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aaa]">
                    Episode
                  </span>
                  <button
                    onClick={() => setVideoOpen(false)}
                    className="p-0 text-sm leading-none text-[#bbb] hover:text-[#666]"
                  >
                    ×
                  </button>
                </div>
                {youtube_id ? (
                  <div className="aspect-video w-full overflow-hidden rounded bg-[#111]">
                    <iframe
                      src={`https://www.youtube.com/embed/${youtube_id}`}
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="block h-full w-full"
                    />
                  </div>
                ) : (
                  <div className="px-3 py-5 text-center font-[family-name:var(--font-source-sans)] text-[11px] leading-relaxed text-[#bbb]">
                    No video available for this episode.
                    <br />
                    <span className="text-[#c9a84c]">Timestamps</span> will
                    link here when YouTube source is available.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
