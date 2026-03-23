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

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sectionSourceLabel(source?: string): string | null {
  if (source === "derived") return "(auto)";
  if (source === "inferred") return "(auto)";
  return null;
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

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
}

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

  const isMonologue = useMemo(() => {
    if (turns.length <= 1) return true;
    const speaker = turns[0]?.speaker;
    return turns.every((t) => t.speaker === speaker);
  }, [turns]);

  const bulletAnchors = useMemo(() => {
    const set = new Set<string>();
    for (const b of prep_bullets) {
      for (const sq of b.supporting_quotes) {
        if (sq.section_anchor) set.add(sq.section_anchor);
      }
    }
    return set;
  }, [prep_bullets]);

  // Pre-compute cited turn indices for O(1) lookup in render loop
  const citedTurnIndices = useMemo(() => {
    const set = new Set<number>();
    for (const b of prep_bullets) {
      for (const sq of b.supporting_quotes) {
        if (!sq.section_anchor || !sq.speaker) continue;
        const quotePrefix = sq.quote.slice(0, 80);
        for (const t of turns) {
          if (
            t.section_anchor === sq.section_anchor &&
            t.speaker === sq.speaker &&
            t.text.includes(quotePrefix)
          ) {
            set.add(t.turn_index);
          }
        }
      }
    }
    return set;
  }, [prep_bullets, turns]);

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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    allAnchors.forEach((a) => (m[a] = true));
    return m;
  });
  const [expandedHostTurns, setExpandedHostTurns] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [feedback, setFeedback] = useState<Record<number, BulletFeedback>>({});
  const [floatingPanel, setFloatingPanel] = useState<{ idx: number } | null>(null);
  const [panelDraft, setPanelDraft] = useState("");
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [relatedExpanded, setRelatedExpanded] = useState(false);

  const panelInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const monologueRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const seekToTime = useCallback((seconds: number) => {
    const player = ytPlayerRef.current;
    if (player) {
      player.seekTo(seconds, true);
      player.playVideo();
    } else {
      pendingSeekRef.current = seconds;
      setVideoExpanded(true);
    }
  }, []);

  // Initialize YouTube IFrame API
  useEffect(() => {
    if (!videoExpanded || !youtube_id) return;
    if (ytPlayerRef.current && document.getElementById("yt-player-container")?.querySelector("iframe")) {
      return;
    }
    ytPlayerRef.current = null;

    const containerId = "yt-player-container";

    function createPlayer() {
      if (!document.getElementById(containerId)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const YT = (window as any).YT;
      if (!YT?.Player) return;
      new YT.Player(containerId, {
        videoId: youtube_id,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0 },
        events: {
          onReady: (event: { target: YTPlayer }) => {
            ytPlayerRef.current = event.target;
            if (pendingSeekRef.current != null) {
              event.target.seekTo(pendingSeekRef.current, true);
              event.target.playVideo();
              pendingSeekRef.current = null;
            }
          },
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).YT?.Player) {
      createPlayer();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).onYouTubeIframeAPIReady = createPlayer;
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
    }

    return () => {
      ytPlayerRef.current = null;
      pendingSeekRef.current = null;
    };
  }, [videoExpanded, youtube_id]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Focus panel input
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

  // ---- Search ----
  const searchTerms = useMemo(() => parseSearchQuery(debouncedQuery), [debouncedQuery]);

  const searchResults = useMemo(() => {
    if (searchTerms.length === 0)
      return { anchors: new Set<string>(), turnKeys: new Set<string>(), countBySection: new Map<string, number>() };

    const anchors = new Set<string>();
    const turnKeys = new Set<string>();
    const countBySection = new Map<string, number>();

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

  useEffect(() => {
    if (hasSearch) {
      const m: Record<string, boolean> = {};
      allAnchors.forEach((a) => (m[a] = searchResults.anchors.has(a)));
      setExpandedSections(m);
    } else if (debouncedQuery === "" && !activeSpeaker) {
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
          m[a] = (turnsBySection.get(a) ?? []).some((t) => t.speaker === name);
        });
        setExpandedSections(m);
      }
    },
    [activeSpeaker, allAnchors, turnsBySection]
  );

  const scrollToSection = useCallback((anchor: string) => {
    setExpandedSections((prev) => ({ ...prev, [anchor]: true }));
    setTimeout(() => {
      sectionRefs.current[anchor]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
  }, []);

  const allExpanded = allAnchors.every((a) => expandedSections[a]);
  const allCollapsed = allAnchors.every((a) => !expandedSections[a]);

  const guests = speakers.filter((s) => s.role !== "host");
  const host = speakers.find((s) => s.role === "host");

  // ---- Render ----
  return (
    <div className="h-screen flex flex-col bg-[#faf9f7] text-[#1a1a1a] overflow-hidden max-md:h-auto max-md:min-h-screen max-md:overflow-visible">
      {/* Header */}
      <header className="flex-shrink-0 h-12 px-4 flex items-center justify-between bg-white border-b border-[#e5e3df]">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-wider text-[#333]">
            ROWSPACE
          </span>
          <div className="flex items-center gap-2 text-[11px] text-[#888]">
            <span className="font-mono text-[#999]">{source_name}</span>
            <span className="text-[#ccc]">/</span>
            <span className="text-[#555] truncate max-w-[300px]">{title}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#888]">
          <span>{date}</span>
        </div>
      </header>

      {/* Main 3-Column Grid */}
      <main className="flex-1 grid overflow-hidden max-md:flex max-md:flex-col max-md:overflow-visible" style={{ gridTemplateColumns: '280px 1fr 280px' }}>
        
        {/* Left Sidebar */}
        <aside className="h-full bg-[#faf9f7] flex flex-col border-r border-[#e5e3df] overflow-y-auto max-md:h-auto max-md:overflow-visible max-md:order-first max-md:border-r-0 max-md:border-b">
          {/* Speakers */}
          <div className="px-3 py-3 border-b border-[#e5e3df]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Speakers</span>
              {has_inferred_attribution && (
                <span className="text-[9px] text-[#bbb] italic" title="Speaker labels were auto-generated and may not be accurate">
                  (auto)
                </span>
              )}
            </div>
            <div className="space-y-2">
              {guests.map((g) => (
                <button
                  key={g.name}
                  onClick={() => handleSpeakerClick(g.name)}
                  className={`w-full flex items-center justify-between p-2 border transition-colors ${
                    activeSpeaker === g.name
                      ? 'bg-white border-[#b8860b]/30'
                      : 'bg-white border-[#e5e3df] hover:border-[#b8860b]/30'
                  }`}
                >
                  <div className="text-left">
                    <div className={`text-[12px] font-medium ${activeSpeaker === g.name ? 'text-[#b8860b]' : 'text-[#555]'}`}>
                      {g.name}
                    </div>
                    <div className="text-[10px] text-[#888]">
                      {[g.title, g.affiliation].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
              {host && (
                <button
                  onClick={() => handleSpeakerClick(host.name)}
                  className={`w-full flex items-center justify-between p-2 border transition-colors ${
                    activeSpeaker === host.name
                      ? 'bg-[#f5f4f2] border-[#ccc]'
                      : 'bg-[#f5f4f2] border-[#e5e3df] hover:border-[#ccc]'
                  }`}
                >
                  <div className="text-left">
                    <div className="text-[12px] text-[#555]">{host.name}</div>
                    <div className="text-[10px] text-[#999]">
                      {[host.title, host.affiliation].filter(Boolean).join(", ") || "Host"}
                    </div>
                  </div>
                  <svg className="w-3.5 h-3.5 text-[#bbb]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[#e5e3df]">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#bbb]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text"
                placeholder="Find in transcript..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#e5e3df] text-[12px] text-[#333] placeholder:text-[#bbb] py-2 pl-8 pr-8 focus:outline-none focus:border-[#b8860b]/50"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setDebouncedQuery("");
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#bbb] hover:text-[#666]"
                >
                  <span className="text-sm">&times;</span>
                </button>
              )}
            </div>
          </div>

          {/* Sections */}
          <div className="px-3 py-1 flex-1">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[#999]">
                {isMonologue ? "Topics" : "Sections"}
              </div>
              {!isMonologue && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const m: Record<string, boolean> = {};
                      allAnchors.forEach((a) => (m[a] = true));
                      setExpandedSections(m);
                    }}
                    disabled={allExpanded}
                    className="w-5 h-5 flex items-center justify-center text-[#999] hover:text-[#555] hover:bg-[#f0efed] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#999]"
                    title="Expand all"
                  >
                    <span className="text-sm">+</span>
                  </button>
                  <button
                    onClick={() => {
                      const m: Record<string, boolean> = {};
                      allAnchors.forEach((a) => (m[a] = false));
                      setExpandedSections(m);
                    }}
                    disabled={allCollapsed}
                    className="w-5 h-5 flex items-center justify-center text-[#999] hover:text-[#555] hover:bg-[#f0efed] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#999]"
                    title="Collapse all"
                  >
                    <span className="text-sm">-</span>
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-0.5">
              {sections.map((s) => {
                const cited = bulletAnchors.has(s.anchor);
                const hit = hasSearch && searchResults.anchors.has(s.anchor);
                const dim = hasSearch && !hit;
                const hitCount = searchResults.countBySection.get(s.anchor) ?? 0;

                return (
                  <button
                    key={s.anchor}
                    onClick={() => !isMonologue && !dim && scrollToSection(s.anchor)}
                    className={`w-full text-left p-2.5 transition-all ${
                      isMonologue
                        ? 'cursor-default opacity-60'
                        : dim
                        ? 'pointer-events-none opacity-30'
                        : expandedSections[s.anchor]
                        ? 'bg-white border-l-2 border-[#b8860b]'
                        : 'hover:bg-[#f5f4f2] border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {hit ? (
                        <span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#5a8fc7]" />
                      ) : cited ? (
                        <span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#b8860b]" />
                      ) : (
                        <span className="w-[5px] shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className={`text-[12px] leading-snug ${cited || hit ? 'text-[#333]' : 'text-[#666]'}`}>
                          {s.heading}
                        </span>
                        {sectionSourceLabel(s.source) && (
                          <span className="ml-1 text-[10px] text-[#ccc]">
                            {sectionSourceLabel(s.source)}
                          </span>
                        )}
                        {hit && hitCount > 0 && (
                          <span className="ml-1 text-[10px] text-[#5a8fc7]">
                            ({hitCount})
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-[#e5e3df]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#b8860b]" />
              <span className="text-[10px] text-[#999]">Cited in Takeaways</span>
            </div>
            {hasSearch && (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5a8fc7]" />
                <span className="text-[10px] text-[#5a8fc7]">Search Match</span>
              </div>
            )}
          </div>

          {/* Export */}
          <div className="px-4 py-3 border-t border-[#e5e3df]">
            <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-[#e5e3df] text-[11px] font-medium text-[#ccc] cursor-default" title="Coming soon">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Archive
            </button>
          </div>
        </aside>

        {/* Center: Transcript */}
        <section className="h-full bg-white overflow-y-auto flex flex-col max-md:h-auto max-md:overflow-visible">
          {/* Audio Controls - Collapsed (default) */}
          {!videoExpanded && youtube_id && (
            <div className="sticky top-0 z-40 bg-[#faf9f7]/95 backdrop-blur p-3 flex items-center gap-4 border-b border-[#e5e3df]">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (ytPlayerRef.current) {
                        const state = ytPlayerRef.current.getPlayerState();
                        if (state === 1) {
                          ytPlayerRef.current.pauseVideo();
                        } else {
                          ytPlayerRef.current.playVideo();
                        }
                      }
                    }}
                    className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-[#b8860b] transition-colors"
                    title="Play/Pause audio"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                  <span className="text-[11px] font-mono text-[#b8860b]">0:00</span>
                  <div className="flex-1 h-1 bg-[#e5e3df] relative rounded-full overflow-hidden">
                    <div className="absolute top-0 left-0 h-full w-0 bg-[#b8860b]/40" />
                  </div>
                  <span className="text-[11px] font-mono text-[#999]">--:--</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[#888]">
                <button
                  onClick={() => setVideoExpanded(true)}
                  className="text-[10px] font-mono hover:text-[#b8860b] transition-colors px-2 py-1 bg-white border border-[#e5e3df]"
                  title="Expand video to change speed"
                >1x</button>
                <button 
                  onClick={() => setVideoExpanded(true)}
                  className="hover:text-[#b8860b] transition-colors p-1.5 hover:bg-[#f5f4f2] rounded" 
                  title="Expand video"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Video Controls - Expanded (sticky) */}
          {videoExpanded && youtube_id && (
            <div className="sticky top-0 z-40 bg-[#0a0a0a]">
              <div className="aspect-video max-h-[50vh] w-full bg-[#111] relative">
                <div id="yt-player-container" className="h-full w-full" />
                <button 
                  onClick={() => setVideoExpanded(false)}
                  className="absolute top-3 right-3 p-2 bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors rounded"
                  title="Collapse video"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* No video message */}
          {!youtube_id && (
            <div className="sticky top-0 z-40 bg-[#faf9f7]/95 backdrop-blur p-3 border-b border-[#e5e3df]">
              <div className="text-center text-[11px] text-[#888]">
                No video available for this episode
              </div>
            </div>
          )}

          {/* Transcript Content */}
          <div className="flex-1 px-6 py-5 space-y-1">
            {/* Monologue mode */}
            {isMonologue && turns.length > 0 && (
              <div ref={monologueRef}>
                {turns.map((turn) => {
                  const bucket = turn.section_anchor && turnsBySection.has(turn.section_anchor)
                    ? turn.section_anchor : INTRO_ANCHOR;
                  const bucketTurns = turnsBySection.get(bucket) ?? [];
                  const idxInBucket = bucketTurns.indexOf(turn);
                  const turnKey = `${bucket}-${idxInBucket === -1 ? 0 : idxInBucket}`;
                  const isTurnHit = hasSearch && searchResults.turnKeys.has(turnKey);
                  
                  return (
                    <div
                      key={turn.turn_index}
                      className={`group relative py-3 px-4 transition-all hover:bg-[#faf9f7] border-l-2 border-transparent ${
                        isTurnHit ? 'bg-[#eff6ff] border-l-[#5a8fc7]' : ''
                      }`}
                    >
                      <div className="flex items-baseline gap-3 mb-1">
                        {turn.timestamp_seconds != null && (
                          <button 
                            onClick={() => seekToTime(turn.timestamp_seconds!)}
                            className="text-[10px] font-mono text-[#999] hover:text-[#b8860b] transition-colors flex-shrink-0"
                            title="Jump to timestamp"
                          >
                            {formatTimestamp(turn.timestamp_seconds)}
                          </button>
                        )}
                        <span className="text-[13px] font-medium text-[#b8860b]">
                          {turn.speaker}
                        </span>
                      </div>
                      <p className="text-[14px] leading-[1.6] text-[#333]">
                        {highlightText(turn.text, debouncedQuery)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Multi-speaker mode: Intro turns */}
            {!isMonologue && (turnsBySection.get(INTRO_ANCHOR)?.length ?? 0) > 0 && (
              <div className="mb-4">
                {turnsBySection.get(INTRO_ANCHOR)!.map((turn, ti) => {
                  const isHost = turn.role === "host";
                  const dimmed = activeSpeaker && activeSpeaker !== turn.speaker;
                  const isTurnHit = hasSearch && searchResults.turnKeys.has(`${INTRO_ANCHOR}-${ti}`);

                  const speakerInfo = speakers.find(s => s.name === turn.speaker);
                  return (
                    <div
                      key={ti}
                      className={`group relative py-3 px-4 transition-all border-l-2 ${
                        isTurnHit
                          ? 'bg-[#eff6ff] border-l-[#5a8fc7]'
                          : 'hover:bg-[#faf9f7] border-transparent'
                      }`}
                      style={dimmed ? { opacity: 0.3 } : undefined}
                    >
                      <div className="flex items-baseline gap-3 mb-1">
                        {turn.timestamp_seconds != null && (
                          <button 
                            onClick={() => seekToTime(turn.timestamp_seconds!)}
                            className="text-[10px] font-mono text-[#999] hover:text-[#b8860b] transition-colors flex-shrink-0"
                            title="Jump to timestamp"
                          >
                            {formatTimestamp(turn.timestamp_seconds)}
                          </button>
                        )}
                        <span className={`text-[13px] font-medium ${isHost ? 'text-[#666]' : 'text-[#b8860b]'}`}>
                          {turn.speaker}
                        </span>
                        {speakerInfo && (
                          <span className="text-[10px] text-[#999]">
                            {[speakerInfo.title, speakerInfo.affiliation].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </div>
                      <p className={`text-[14px] leading-[1.6] ${isHost ? 'text-[#555] italic' : 'text-[#333]'}`}>
                        {highlightText(turn.text, debouncedQuery)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Multi-speaker mode: Sections */}
            {!isMonologue && sections.map((section) => {
              const sectionTurns = turnsBySection.get(section.anchor) ?? [];
              const isOpen = expandedSections[section.anchor];
              const isCited = bulletAnchors.has(section.anchor);
              const isHit = hasSearch && searchResults.anchors.has(section.anchor);
              const isMiss = hasSearch && !isHit;
              const hitCount = searchResults.countBySection.get(section.anchor) ?? 0;

              return (
                <div
                  key={section.anchor}
                  ref={(el) => { sectionRefs.current[section.anchor] = el; }}
                  className={`mb-2 scroll-mt-16 transition-opacity ${isMiss ? 'pointer-events-none opacity-25' : ''}`}
                >
                  {/* Section Header */}
                  <button
                    onClick={() => !isMiss && setExpandedSections((prev) => ({
                      ...prev,
                      [section.anchor]: !prev[section.anchor],
                    }))}
                    className={`w-full flex items-center justify-between p-3 transition-colors ${
                      isHit
                        ? 'bg-[#eff6ff] border-l-2 border-[#5a8fc7]'
                        : isCited
                        ? 'bg-[#faf9f7] border-l-2 border-[#b8860b]/40'
                        : 'bg-[#faf9f7] hover:bg-[#f5f4f2] border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isHit ? (
                        <span className="h-[5px] w-[5px] rounded-full bg-[#5a8fc7]" />
                      ) : isCited ? (
                        <span className="h-[5px] w-[5px] rounded-full bg-[#b8860b]" />
                      ) : null}
                      <span className="text-[14px] font-medium text-[#333]">
                        {section.heading}
                      </span>
                      {sectionSourceLabel(section.source) && (
                        <span className="text-[10px] text-[#ccc]">
                          {sectionSourceLabel(section.source)}
                        </span>
                      )}
                      {isHit && hitCount > 0 && (
                        <span className="text-[10px] font-medium text-[#5a8fc7]">
                          {hitCount} match{hitCount !== 1 ? "es" : ""}
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[9px] text-[#bbb] transition-transform"
                      style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                    >
                      ▶
                    </span>
                  </button>

                  {/* Section Turns */}
                  {isOpen && (
                    <div className="border-l border-[#e5e3df] ml-1">
                      {sectionTurns.map((turn, ti) => {
                        const isHost = turn.role === "host";
                        const key = `${section.anchor}-${ti}`;
                        const hostExpanded = expandedHostTurns[key];
                        const isTurnHit = hasSearch && searchResults.turnKeys.has(key);
                        const { first, hasMore } = firstSentence(turn.text);
                        const summary = turn_summaries?.[turn.turn_index];
                        const dimmed = activeSpeaker && activeSpeaker !== turn.speaker;
                        const speakerInfo = speakers.find(s => s.name === turn.speaker);
                        const isCitedTurn = citedTurnIndices.has(turn.turn_index);

                        return (
                          <div
                            key={ti}
                            className={`group relative py-3 px-4 transition-all border-l-2 ${
                              isTurnHit
                                ? 'bg-[#eff6ff] border-l-[#5a8fc7]'
                                : isCitedTurn
                                ? 'bg-[#b8860b]/5 border-l-[#b8860b]/40'
                                : 'hover:bg-[#faf9f7] border-transparent'
                            }`}
                            style={dimmed ? { opacity: 0.3 } : undefined}
                          >
                            {/* Header: timestamp + name/title + cited badge */}
                            <div className="flex items-baseline gap-3 mb-1">
                              {turn.timestamp_seconds != null && (
                                <button 
                                  onClick={() => seekToTime(turn.timestamp_seconds!)}
                                  className="text-[10px] font-mono text-[#999] hover:text-[#b8860b] transition-colors flex-shrink-0"
                                  title="Jump to timestamp"
                                >
                                  {formatTimestamp(turn.timestamp_seconds)}
                                </button>
                              )}
                              <span className={`text-[13px] font-medium ${isHost ? 'text-[#666]' : 'text-[#b8860b]'}`}>
                                {turn.speaker}
                              </span>
                              {speakerInfo && (
                                <span className="text-[10px] text-[#999]">
                                  {[speakerInfo.title, speakerInfo.affiliation].filter(Boolean).join(", ")}
                                </span>
                              )}
                              {isCitedTurn && (
                                <span className="flex items-center gap-1 text-[9px] text-[#b8860b]/70">
                                  <span className="w-1 h-1 rounded-full bg-[#b8860b]" />
                                  cited
                                </span>
                              )}
                            </div>

                            {/* Text content - aligned with header */}
                            {isHost ? (
                              <p className="text-[14px] leading-[1.6] text-[#555] italic">
                                {hostExpanded || isTurnHit
                                  ? highlightText(turn.text, debouncedQuery)
                                  : summary
                                  ? summary
                                  : hasMore
                                  ? highlightText(first, debouncedQuery)
                                  : highlightText(turn.text, debouncedQuery)
                                }
                                {(hasMore || summary) && !isTurnHit && (
                                  <button
                                    onClick={() => setExpandedHostTurns((prev) => ({ ...prev, [key]: !prev[key] }))}
                                    className="ml-1 text-[12px] text-[#b8860b] hover:underline transition-colors"
                                    title={hostExpanded ? (summary ? "Show summary" : "Show less") : "Show full text"}
                                  >
                                    {hostExpanded ? "[less]" : "[more]"}
                                  </button>
                                )}
                              </p>
                            ) : (
                              <p className="text-[14px] leading-[1.6] text-[#333]">
                                {highlightText(turn.text, debouncedQuery)}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Sidebar */}
        <aside className="h-full bg-[#faf9f7] flex flex-col border-l border-[#e5e3df] overflow-y-auto max-md:h-auto max-md:overflow-visible max-md:border-l-0 max-md:border-t">
          {/* Regenerate Button */}
          <div className="px-4 pt-4 pb-2 border-b border-[#e5e3df]">
            <RegenerateBulletsButton
              appearanceId={appearance.id}
              bulletsGeneratedAt={bullets_generated_at}
              transcriptCharCount={transcript_char_count}
            />
          </div>

          {/* Key Takeaways */}
          <div className="p-4 border-b border-[#e5e3df]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Key Takeaways</span>
            </div>
            <div className="space-y-3">
              {prep_bullets.map((b, i) => {
                const fb = feedback[i];
                const flagged = !!fb?.flagged;
                const firstQuote = b.supporting_quotes[0];

                if (flagged) {
                  return (
                    <div
                      key={i}
                      className="p-2 bg-[#f5f4f2] border border-[#e5e3df] opacity-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[#999] italic truncate flex-1">
                          {b.text.split(" ").slice(0, 5).join(" ")}...
                        </span>
                        <button
                          onClick={() => setFeedback((prev) => ({ ...prev, [i]: { flagged: false } }))}
                          className="text-[10px] text-[#999] hover:text-[#555] ml-2"
                        >
                          undo
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={i} className="p-3 bg-white border border-[#e5e3df] hover:border-[#b8860b]/30 transition-colors group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] leading-relaxed text-[#333] mb-2">
                          {b.text}
                        </div>
                        {firstQuote && (
                          <button
                            onClick={() => {
                              if (isMonologue) {
                                monologueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                              } else if (firstQuote.section_anchor) {
                                scrollToSection(firstQuote.section_anchor);
                              }
                            }}
                            className="text-left w-full"
                          >
                            <div className="text-[11px] italic text-[#888] hover:text-[#555] leading-snug">
                              <span className="not-italic text-[#b8860b]">&ldquo;</span>
                              {firstQuote.quote}
                              <span className="not-italic text-[#bbb] ml-1">
                                — {firstQuote.speaker}
                              </span>
                            </div>
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setPanelDraft("");
                          setFloatingPanel({ idx: i });
                          setFeedback((prev) => ({ ...prev, [i]: { ...prev[i], flagged: true } }));
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[#ccc] hover:text-[#999] transition-opacity p-1"
                        title="Flag as unhelpful"
                      >
                        <span className="text-sm">&times;</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {prep_bullets.length === 0 && (
                <div className="text-[11px] text-[#999] italic text-center py-4">
                  No takeaways generated yet
                </div>
              )}
            </div>
          </div>

          {/* Rowspace Angles */}
          <div className="p-4 border-b border-[#e5e3df]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Rowspace Angles</span>
            </div>
            <div className="space-y-3">
              <div className="text-[11px] text-[#999] italic text-center py-2">
                Coming soon
              </div>
            </div>
          </div>

          {/* Related Content - Collapsible */}
          <div className="p-4">
            <button
              onClick={() => setRelatedExpanded(!relatedExpanded)}
              className="w-full flex items-center justify-between mb-3"
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Related Content</span>
              <span
                className="text-[9px] text-[#bbb] transition-transform"
                style={{ transform: relatedExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
            </button>
            {relatedExpanded && (
              <div className="space-y-2">
                <div className="text-[11px] text-[#999] italic text-center py-4">
                  No related content available
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Floating Feedback Panel */}
      {floatingPanel !== null && (() => {
        const b = prep_bullets[floatingPanel.idx];
        const quoteText = b?.supporting_quotes[0]?.quote ?? b?.text ?? "";
        return (
          <div className="fixed right-7 bottom-7 z-50 w-80 rounded border border-[#e5e3df] bg-white p-3.5 shadow-lg">
            <div className="mb-2.5 flex items-start justify-between gap-2.5">
              <div className="text-[11px] italic leading-snug text-[#888]">
                &ldquo;{quoteText.slice(0, 80)}{quoteText.length > 80 ? "..." : ""}&rdquo;
              </div>
              <button
                onClick={() => setFloatingPanel(null)}
                className="shrink-0 p-0 text-base leading-none text-[#bbb] hover:text-[#666]"
              >
                &times;
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
                    [floatingPanel.idx]: { flagged: true, comment: panelDraft || undefined },
                  }));
                  setFloatingPanel(null);
                }
                if (e.key === "Escape") {
                  setFloatingPanel(null);
                }
              }}
              className="w-full rounded border border-[#e5e3df] bg-[#faf9f7] px-2 py-1.5 text-xs text-[#333] outline-none focus:border-[#b8860b]"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-[#ccc]">
                Enter to save, Esc to dismiss
              </span>
              <button
                onClick={() => {
                  setFeedback((prev) => ({
                    ...prev,
                    [floatingPanel.idx]: { flagged: true, comment: panelDraft || undefined },
                  }));
                  setFloatingPanel(null);
                }}
                className="rounded bg-[#1a1a1a] px-2.5 py-1 text-[11px] text-white"
              >
                Save
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
