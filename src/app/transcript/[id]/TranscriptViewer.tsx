"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import type { TranscriptViewerProps } from "./types";
import { RegenerateBulletsButton } from "./RegenerateBulletsButton";
import { useAppearanceApi } from "./useAppearanceApi";
import { SpeakerPanel } from "./SpeakerPanel";
import type { SpeakerPanelHandle } from "./SpeakerPanel";
import { TurnRenderer } from "./TurnRenderer";
import { detectSpeakerMismatch } from "../../speaker-utils";
import { parseSearchQuery, matchesTurn, firstSentence, KBD_CLASS } from "./helpers";
import { formatDuration } from "@lib/utils/format-duration";

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_PLAYBACK_RATE = 1.5;

// ---------------------------------------------------------------------------
// Helpers (local to TranscriptViewer)
// ---------------------------------------------------------------------------

function sectionSourceLabel(source?: string): string | null {
  if (source === "derived") return "(auto)";
  if (source === "inferred") return "(auto)";
  return null;
}

function formatPlayerTime(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  setPlaybackRate(rate: number): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
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
    sections,
    bullets_generated_at,
    transcript_char_count,
  } = appearance;

  // Mutable state — updated by API calls
  const {
    speakers,
    turns,
    turnSummaries: turn_summaries,
    prepBullets: prep_bullets,
    hasInferredAttribution: has_inferred_attribution,
    saving,
    error: apiError,
    confirmation,
    clearError,
    clearConfirmation,
    defaultViewParams,
    renameSpeaker,
    updateSpeaker,
    correctTurn,
    saveDefaultView,
  } = useAppearanceApi(appearance.id, appearance);

  // Derive role from current speakers state
  const speakerRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of speakers) map.set(s.name, s.role);
    return map;
  }, [speakers]);

  const getRoleForSpeaker = useCallback(
    (name: string) => speakerRoleMap.get(name) ?? "guest",
    [speakerRoleMap]
  );

  const isCollapsedRole = useCallback(
    (name: string) => {
      const role = getRoleForSpeaker(name);
      return role === "host" || role === "rowspace";
    },
    [getRoleForSpeaker]
  );

  // Check if all speakers are still generic labels
  const allSpeakersGeneric = useMemo(
    () => speakers.length > 0 && speakers.every((s) => /^Speaker \d+$/.test(s.name)),
    [speakers]
  );

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
  // Role-based default: guest/customer/other expanded, host/rowspace collapsed.
  const computeRoleDefaults = useCallback(() => {
    const roleMap = new Map<string, string>();
    for (const s of speakers) roleMap.set(s.name, s.role);
    return new Set(
      turns
        .filter(t => {
          const role = roleMap.get(t.speaker) ?? "guest";
          return role !== "host" && role !== "rowspace";
        })
        .map(t => t.turn_index)
    );
  }, [speakers, turns]);

  // Unified expand/collapse: a turn is expanded iff its turn_index is in this set.
  // Always initialize with role-based defaults (SSR-safe), then override from URL on mount.
  // Uses computeRoleDefaults directly — at init time, speakers/turns state equals appearance props.
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(computeRoleDefaults);

  // Hidden turns — view-layer only, synced to URL ?hidden= param
  const [hiddenTurns, setHiddenTurns] = useState<Set<number>>(new Set);

  // Refs synced to state — for keyboard handler to avoid useEffect dep changes
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const expandedTurnsRef = useRef(expandedTurns);
  expandedTurnsRef.current = expandedTurns;
  const turnsBySectionRef = useRef(turnsBySection);
  turnsBySectionRef.current = turnsBySection;

  // Track whether we're in highlight mode (URL has ?expanded= param)
  const [isHighlightMode, setIsHighlightMode] = useState(false);

  // On mount, read URL params and override expandedTurns if ?expanded= is present.
  // Priority: URL params > saved default view > role-based defaults.
  // useEffect avoids hydration mismatch (server doesn't have window.location).
  const urlInitRef = useRef(false);
  // When loading from saved view (not URL params), suppress URL sync effects
  // so the URL stays clean. Cleared on first user interaction.
  const suppressUrlSyncRef = useRef(false);
  useEffect(() => {
    if (urlInitRef.current) return;
    urlInitRef.current = true;
    const urlParams = new URLSearchParams(window.location.search);
    const hasUrlParams = urlParams.has("expanded") || urlParams.has("hidden");

    // Source: URL params if present, otherwise saved default view
    const params = hasUrlParams
      ? urlParams
      : defaultViewParams
        ? new URLSearchParams(defaultViewParams)
        : null;

    if (!params) return; // No URL params and no saved view — keep role-based defaults

    // Suppress URL sync when loading from saved view (not URL params)
    if (!hasUrlParams) suppressUrlSyncRef.current = true;

    const expandedParam = params.get("expanded");
    if (expandedParam !== null) {
      setIsHighlightMode(true);
      if (expandedParam === "") {
        setExpandedTurns(new Set<number>());
      } else {
        const indices = expandedParam.split(",").map(Number).filter(n => !isNaN(n));
        setExpandedTurns(new Set(indices));
      }
    }
    const hiddenParam = params.get("hidden");
    if (hiddenParam !== null && hiddenParam !== "") {
      const indices = hiddenParam.split(",").map(Number).filter(n => !isNaN(n));
      setHiddenTurns(new Set(indices));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTurnExpanded = useCallback((turnIndex: number) => {
    suppressUrlSyncRef.current = false; // User interaction — resume URL sync
    setExpandedTurns(prev => {
      const next = new Set(prev);
      if (next.has(turnIndex)) next.delete(turnIndex);
      else next.add(turnIndex);
      return next;
    });
    // Once user toggles anything, we're in highlight mode
    setIsHighlightMode(true);
  }, []);

  // Sync expandedTurns + hiddenTurns to URL via replaceState.
  // Combined into one effect so both params are always written together —
  // prevents stale ?hidden= when only expandedTurns changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlInitRef.current) return;
    if (suppressUrlSyncRef.current) return;
    const url = new URL(window.location.href);
    if (isHighlightMode) {
      const expanded = Array.from(expandedTurns).sort((a, b) => a - b).join(",");
      url.searchParams.set("expanded", expanded);
    }
    if (hiddenTurns.size > 0) {
      const hidden = Array.from(hiddenTurns).sort((a, b) => a - b).join(",");
      url.searchParams.set("hidden", hidden);
    } else {
      url.searchParams.delete("hidden");
    }
    window.history.replaceState({}, "", url.toString());
  }, [expandedTurns, hiddenTurns, isHighlightMode]);

  // Toggle a turn's hidden state
  const toggleTurnHidden = useCallback((turnIndex: number) => {
    suppressUrlSyncRef.current = false; // User interaction — resume URL sync
    setHiddenTurns(prev => {
      const next = new Set(prev);
      if (next.has(turnIndex)) {
        next.delete(turnIndex);
      } else {
        next.add(turnIndex);
      }
      return next;
    });
  }, []);

  // Unhide a group of turns (for placeholder click)
  const unhideGroup = useCallback((turnIndices: number[]) => {
    suppressUrlSyncRef.current = false; // User interaction — resume URL sync
    setHiddenTurns(prev => {
      const next = new Set(prev);
      for (const idx of turnIndices) next.delete(idx);
      return next;
    });
  }, []);

  // Reset view handler — returns to role-based defaults, exits highlight mode
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const handleResetView = useCallback(() => {
    setExpandedTurns(computeRoleDefaults());
    setHiddenTurns(new Set());
    setIsHighlightMode(false);
    // Remove expanded and hidden params from URL
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("expanded");
      url.searchParams.delete("hidden");
      window.history.replaceState({}, "", url.toString());
    }
    setResetConfirmation(true);
    setTimeout(() => setResetConfirmation(false), 2000);
  }, [computeRoleDefaults]);
  // ---- Active turn (cursor) ----
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);

  // Auto-expand section containing active turn, then scroll into view.
  // Single effect avoids ordering issue (scroll before section expands).
  // expandedSections NOT in deps — prevents feedback loop where collapsing
  // a section with the active turn immediately re-expands it.
  useEffect(() => {
    if (activeTurnIndex === null) return;
    const activeTurn = turns.find(t => t.turn_index === activeTurnIndex);

    // Expand section if needed (functional updater avoids stale closure)
    if (activeTurn?.section_anchor) {
      setExpandedSections(prev => {
        if (prev[activeTurn.section_anchor!]) return prev;
        return { ...prev, [activeTurn.section_anchor!]: true };
      });
    }

    // Always defer scroll one frame — ensures DOM is updated after any
    // section expansion. The one-frame delay is imperceptible.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-turn-index="${activeTurnIndex}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [activeTurnIndex, turns]);

  // ---- Auto-follow / skip playback ----
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true);
  const skipInProgressRef = useRef(false);

  // Ordered list of expanded turns with timestamps — the "highlight reel" playlist.
  // end = next sequential turn's timestamp (regardless of expanded), defining airtime.
  // Hidden turns are excluded — they don't play even if expanded.
  const expandedPlaylist = useMemo(() => {
    const withTimestamps = turns
      .filter(t => expandedTurns.has(t.turn_index) && !hiddenTurns.has(t.turn_index) && t.timestamp_seconds != null)
      .sort((a, b) => a.timestamp_seconds! - b.timestamp_seconds!);

    return withTimestamps.map((turn) => {
      const nextTurn = turns.find(t =>
        t.timestamp_seconds != null &&
        t.timestamp_seconds! > turn.timestamp_seconds!
      );
      return {
        turnIndex: turn.turn_index,
        start: turn.timestamp_seconds!,
        end: nextTurn?.timestamp_seconds ?? Infinity,
      };
    });
  }, [turns, expandedTurns, hiddenTurns]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [feedback, setFeedback] = useState<Record<number, BulletFeedback>>({});
  const [floatingPanel, setFloatingPanel] = useState<{ idx: number } | null>(null);
  const [panelDraft, setPanelDraft] = useState("");
  // Podcasts are audio-first (collapsed). Personal uploads default to full video.
  const AUDIO_FIRST_SOURCES = new Set([
    "Invest Like the Best",
    "Invest Like the Best with Patrick O'Shaughnessy",
    "Capital Allocators with Ted Seides",
    "Alt Goes Mainstream (AGM)",
  ]);
  const [videoMode, setVideoMode] = useState<'collapsed' | 'pip' | 'full'>(
    youtube_id && !AUDIO_FIRST_SOURCES.has(source_name) ? 'full' : 'collapsed'
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [relatedExpanded, setRelatedExpanded] = useState(false);

  // Highlight reel duration — sum of expanded turn durations.
  // Uses video duration to cap the last turn (end=Infinity). Falls back to excluding it.
  const highlightDurationSec = useMemo(() => {
    if (!isHighlightMode || expandedPlaylist.length === 0) return 0;
    return expandedPlaylist.reduce((sum, item) => {
      const end = item.end === Infinity ? (duration > 0 ? duration : null) : item.end;
      return sum + (end != null ? end - item.start : 0);
    }, 0);
  }, [isHighlightMode, expandedPlaylist, duration]);

  // Full call duration label (shared by control strip and audio bar)
  const fullCallLabel = useMemo(() => {
    const timestamped = turns.filter(t => t.timestamp_seconds != null).map(t => t.timestamp_seconds!);
    const lastTs = timestamped.length > 0 ? Math.max(...timestamped) : 0;
    const fullSec = duration > 0 ? duration : lastTs > 0 ? lastTs + 120 : 0;
    return fullSec > 0 ? `${formatDuration(fullSec)} full video` : '';
  }, [turns, duration]);

  // Shared control strip right-side buttons — follow toggle + mode switches.
  // Parameterized by current mode to show the correct "switch to" buttons.
  const renderControlStripButtons = (mode: 'full' | 'pip' | 'collapsed') => (
    <div className="flex items-center gap-1.5 text-[#888]">
      <button onClick={() => cyclePlaybackRate(-1, false)} className="text-[10px] text-[#999] hover:text-[#555] transition-colors" title="Decrease speed [<]">
        <span className="md:hidden">&lt;</span><kbd className={KBD_CLASS}>&lt;</kbd>
      </button>
      <button onClick={() => cyclePlaybackRate(1)} className="text-[10px] font-mono px-2 py-1 rounded font-medium transition-colors bg-[#f5f4f2] border border-[#e5e3df] hover:bg-[#eeedeb] text-[#555]" title="Playback speed — click to cycle">
        {playbackRate === 1 ? '1x' : `${playbackRate}x`}
      </button>
      <button onClick={() => cyclePlaybackRate(1, false)} className="text-[10px] text-[#999] hover:text-[#555] transition-colors" title="Increase speed [>]">
        <span className="md:hidden">&gt;</span><kbd className={KBD_CLASS}>&gt;</kbd>
      </button>
      <button
        onClick={() => setAutoFollowEnabled(prev => !prev)}
        className={`text-[10px] px-2 py-1 rounded font-medium transition-colors flex items-center gap-1 ${autoFollowEnabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
        title={autoFollowEnabled ? "Auto-scroll: ON — skips collapsed turns [A]" : "Auto-scroll: OFF — plays everything [A]"}
      >
        <kbd className={KBD_CLASS}>A</kbd> Auto-Scroll {autoFollowEnabled ? "ON" : "OFF"}
      </button>
      <span className="w-px h-4 bg-[#e5e3df]" />
      <button
        onClick={() => setVideoMode(prev => prev === 'full' ? 'collapsed' : 'full')}
        className={`p-1.5 rounded transition-colors flex items-center gap-0.5 ${mode === 'full' ? 'text-[#b8860b] bg-[#b8860b]/10' : 'hover:text-[#b8860b] hover:bg-[#f5f4f2]'}`}
        title={mode === 'full' ? "Switch to audio only [w]" : "Full video [w]"}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m0-16l-3 3m3-3l3 3m-3 13l-3-3m3 3l3-3" /></svg>
        <kbd className={KBD_CLASS}>w</kbd>
      </button>
      <button
        onClick={() => setVideoMode(prev => prev === 'pip' ? 'collapsed' : 'pip')}
        className={`p-1.5 rounded transition-colors flex items-center gap-0.5 ${mode === 'pip' ? 'text-[#b8860b] bg-[#b8860b]/10' : 'hover:text-[#b8860b] hover:bg-[#f5f4f2]'}`}
        title={mode === 'pip' ? "Close mini player [q]" : "Mini player [q]"}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 17L17 7M17 7H8M17 7v9" /></svg>
        <kbd className={KBD_CLASS}>q</kbd>
      </button>
    </div>
  );

  // ---- Quote highlight (from prep bullet click) ----
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);

  // ---- Editing state ----
  const [editingTurnText, setEditingTurnText] = useState<number | null>(null);
  const [editingTurnTextValue, setEditingTurnTextValue] = useState("");
  const [turnSpeakerDropdown, setTurnSpeakerDropdown] = useState<number | null>(null);
  const speakersPanelRef = useRef<HTMLDivElement | null>(null);
  const speakerPanelEditRef = useRef<SpeakerPanelHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const panelInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const monologueRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingPlayRef = useRef<boolean>(false);
  const isPlayingRef = useRef(false);
  const playbackRateRef = useRef(DEFAULT_PLAYBACK_RATE);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYBACK_RATE);

  // Format highlight duration with playback rate context
  const highlightDurationLabel = useMemo(() => {
    if (highlightDurationSec <= 0) return '';
    if (!youtube_id) return formatDuration(highlightDurationSec);
    const effective = highlightDurationSec / playbackRate;
    if (playbackRate === 1) return formatDuration(highlightDurationSec);
    if (playbackRate === 1.5) return `~${formatDuration(effective)}`;
    return `~${formatDuration(effective)} at ${playbackRate}x (${formatDuration(highlightDurationSec)} at 1x)`;
  }, [highlightDurationSec, playbackRate, youtube_id]);

  // ---- Save default view ----
  const [saveViewConfirmation, setSaveViewConfirmation] = useState(false);

  const buildParamsString = useCallback(() => {
    const parts: string[] = [];
    if (isHighlightMode) {
      const expanded = Array.from(expandedTurns).sort((a, b) => a - b).join(",");
      parts.push(`expanded=${expanded}`);
    }
    if (hiddenTurns.size > 0) {
      const hidden = Array.from(hiddenTurns).sort((a, b) => a - b).join(",");
      parts.push(`hidden=${hidden}`);
    }
    return parts.join("&") || null;
  }, [expandedTurns, hiddenTurns, isHighlightMode]);

  const currentParams = buildParamsString();
  const hasChangesFromDefaults = isHighlightMode || hiddenTurns.size > 0;
  const savedMatchesCurrent = defaultViewParams === currentParams;

  const handleSaveView = useCallback(async () => {
    const params = buildParamsString();
    if (!params) return;
    const success = await saveDefaultView(params);
    if (success) {
      setSaveViewConfirmation(true);
      setTimeout(() => setSaveViewConfirmation(false), 1500);
    }
  }, [buildParamsString, saveDefaultView]);

  const [clearViewConfirmation, setClearViewConfirmation] = useState(false);
  const handleClearSavedView = useCallback(async () => {
    const success = await saveDefaultView(null);
    if (success) {
      setClearViewConfirmation(true);
      setTimeout(() => {
        setClearViewConfirmation(false);
        handleResetView();
      }, 1000);
    }
  }, [saveDefaultView, handleResetView]);

  // Platform-aware modifier key symbol (⌘ on Mac, Ctrl on others)
  // Initialized to Ctrl+ for SSR, updated client-side to avoid hydration mismatch.
  const [modSymbol, setModSymbol] = useState('Ctrl+');
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setModSymbol('\u2318');
  }, []);

  // Shared reel info block — duration label only. Used in all control strip variants.
  // Returns null (falsy) when there's no content to render.
  const reelInfoBlock = isHighlightMode && highlightDurationLabel ? (
    <span className="text-[11px]">
      <span className="font-medium text-[#b8860b]">{highlightDurationLabel} highlight</span>
      {fullCallLabel && <span className="text-[#bbb]"> · {fullCallLabel}</span>}
    </span>
  ) : fullCallLabel ? (
    <span className="text-[11px] text-[#888]">{fullCallLabel}</span>
  ) : null;

  // Header bar actions — Reset, Save, Help. Rendered in top-right header.
  const headerActions = (
    <div className="hidden md:flex items-center gap-0">
      {isHighlightMode && (
        <>
          {resetConfirmation ? (
            <span className="text-[11px] text-green-600 px-1.5 py-1">View reset</span>
          ) : (
            <button onClick={handleResetView} className="inline-flex items-center gap-1 text-[11px] text-[#666] hover:text-[#b8860b] hover:bg-[#f5f4f2] px-1.5 py-1 rounded transition-colors">
              <kbd className={KBD_CLASS}>{'\u21E7'}R</kbd> Reset
            </button>
          )}
          {clearViewConfirmation ? (
            <span className="text-[11px] text-[#999] px-1.5 py-1">Cleared</span>
          ) : saveViewConfirmation ? (
            <span className="text-[11px] text-green-600 px-1.5 py-1">Saved ✓</span>
          ) : savedMatchesCurrent && defaultViewParams ? (
            <span className="text-[11px] text-[#999] px-1.5 py-1">
              ✓ Saved
              <button onClick={handleClearSavedView} className="ml-1.5 text-[10px] text-[#bbb] hover:text-[#b8860b] transition-colors underline">Clear</button>
            </span>
          ) : hasChangesFromDefaults && !saving ? (
            <button onClick={handleSaveView} className="inline-flex items-center gap-1 text-[11px] text-[#666] hover:text-[#b8860b] hover:bg-[#f5f4f2] px-1.5 py-1 rounded transition-colors">
              <kbd className={KBD_CLASS}>{modSymbol}S</kbd> {defaultViewParams ? "Update" : "Save"}
            </button>
          ) : null}
        </>
      )}
      <button
        onClick={() => setShowHelpOverlay(true)}
        className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-[#f5f4f2] transition-colors text-[#999] hover:text-[#666]"
        title="Keyboard shortcuts (?)"
      >
        <span className="md:hidden text-[10px]">?</span><kbd className={KBD_CLASS}>?</kbd>
      </button>
    </div>
  );

  const playToggleGuardRef = useRef(false);
  const lastPollTimeRef = useRef(NaN);
  const lastPollWallRef = useRef(0);

  // Hydrate playback rate from sessionStorage (SSR-safe)
  useEffect(() => {
    const stored = sessionStorage.getItem("playbackRate");
    if (stored) {
      const rate = parseFloat(stored);
      if (PLAYBACK_RATES.includes(rate as (typeof PLAYBACK_RATES)[number])) {
        playbackRateRef.current = rate;
        setPlaybackRate(rate);
      }
    }
  }, []);

  const cyclePlaybackRate = useCallback((direction: 1 | -1, wrap = true) => {
    const currentIdx = PLAYBACK_RATES.indexOf(playbackRateRef.current as (typeof PLAYBACK_RATES)[number]);
    const rawNext = currentIdx + direction;
    if (!wrap && (rawNext < 0 || rawNext >= PLAYBACK_RATES.length)) return;
    const nextIdx = (rawNext + PLAYBACK_RATES.length) % PLAYBACK_RATES.length;
    const newRate = PLAYBACK_RATES[nextIdx];
    playbackRateRef.current = newRate;
    setPlaybackRate(newRate);
    sessionStorage.setItem("playbackRate", String(newRate));
    const player = ytPlayerRef.current;
    if (player) player.setPlaybackRate(newRate);
  }, []);

  const seekToTime = useCallback((seconds: number) => {
    setCurrentTime(seconds); // immediate UI update
    const player = ytPlayerRef.current;
    if (player) {
      player.seekTo(seconds, true);
      player.playVideo();
    } else {
      // Player not ready yet — store seek and it will fire in onReady
      pendingSeekRef.current = seconds;
    }
  }, []);

  // Initialize YouTube IFrame API
  useEffect(() => {
    if (!youtube_id) return;
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
            } else if (pendingPlayRef.current) {
              event.target.playVideo();
            }
            pendingPlayRef.current = false;
            event.target.setPlaybackRate(playbackRateRef.current);
          },
          onStateChange: (event: { data: number }) => {
            // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0, BUFFERING=3
            // Treat buffering as "playing" — user intent is to play
            const playing = event.data === 1 || event.data === 3;
            isPlayingRef.current = playing;
            setIsPlaying(playing);
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
      pendingPlayRef.current = false;
    };
  }, [youtube_id]);

  // Reclaim focus when YouTube iframe captures it (click on player).
  // Without this, keyboard shortcuts stop working until user clicks
  // outside the iframe. Short delay lets the click register first.
  useEffect(() => {
    if (!youtube_id) return;
    const handler = () => {
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') {
          window.focus();
        }
      }, 0);
    };
    window.addEventListener('blur', handler);
    return () => window.removeEventListener('blur', handler);
  }, [youtube_id]);

  // Consolidated 250ms poll: time display + auto-follow skip logic
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player) return;

      const time = player.getCurrentTime();
      setCurrentTime(time);
      const d = player.getDuration();
      if (d > 0) setDuration(d);

      // Detect manual seek: video time jumped >2s between polls, not caused by
      // our skip logic. Also check wall-clock to avoid false positives from
      // background tab throttling (browsers slow intervals to ~1/min).
      const now = Date.now();
      const wallElapsed = now - lastPollWallRef.current;
      if (
        !isNaN(lastPollTimeRef.current) &&
        !skipInProgressRef.current &&
        wallElapsed < 2000 && // poll ran on schedule, not throttled
        Math.abs(time - lastPollTimeRef.current) > 2
      ) {
        if (!autoFollowEnabled) {
          setAutoFollowEnabled(true);
        }
      }
      lastPollTimeRef.current = time;
      lastPollWallRef.current = now;

      // Auto-follow: track active turn and skip collapsed regions
      if (!autoFollowEnabled || skipInProgressRef.current) return;
      lastNavWasKeyboardRef.current = false;

      const currentItem = expandedPlaylist.find(
        item => time >= item.start && time < item.end
      );

      if (currentItem) {
        // In an expanded turn — update highlight
        setActiveTurnIndex(prev =>
          prev === currentItem.turnIndex ? prev : currentItem.turnIndex
        );
      } else {
        // In a collapsed region — skip to next expanded turn
        const nextItem = expandedPlaylist.find(item => item.start > time);
        if (nextItem) {
          skipInProgressRef.current = true;
          player.seekTo(nextItem.start, true);
          setCurrentTime(nextItem.start);
          setActiveTurnIndex(nextItem.turnIndex);
          setTimeout(() => { skipInProgressRef.current = false; }, 500);
        } else {
          // Past all expanded turns — let video play to end naturally
          setAutoFollowEnabled(false);
        }
      }
    }, 250);
    return () => {
      clearInterval(interval);
      lastPollTimeRef.current = NaN; // reset so next start doesn't false-positive
      lastPollWallRef.current = 0;
    };
  }, [isPlaying, autoFollowEnabled, expandedPlaylist]);

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

  // Click outside to close speaker dropdown
  useEffect(() => {
    if (turnSpeakerDropdown === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-speaker-dropdown]")) {
        setTurnSpeakerDropdown(null);
      }
    };
    // Delay to avoid immediate close from the click that opened it
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [turnSpeakerDropdown]);

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
        // Exclude hidden turns from search results
        if (!hiddenTurns.has(turn.turn_index) && matchesTurn(turn.text, searchTerms)) {
          anchors.add(anchor);
          turnKeys.add(`${anchor}-${ti}`);
          count++;
        }
      });
      if (count > 0) countBySection.set(anchor, count);
    }

    return { anchors, turnKeys, countBySection };
  }, [searchTerms, sections, turnsBySection, hiddenTurns]);

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
  // Save expandedTurns before speaker filter so we can restore on deselect
  const savedExpandedTurnsRef = useRef<Set<number> | null>(null);
  const savedIsHighlightModeRef = useRef(false);

  // Scroll an element into view within the transcript scroll container,
  // accounting for sticky headers (video player, control strip) that vary by mode.
  const scrollIntoViewWithOffset = useCallback((el: Element) => {
    const container = scrollContainerRef.current;
    // Fall back to native scrollIntoView when container is missing or not scrollable
    // (mobile viewports use overflow:visible on the section, so scrollTo is a no-op)
    if (!container || container.scrollHeight <= container.clientHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Measure total height of sticky children at the top of the scroll container
    let stickyBottom = 0;
    for (const child of Array.from(container.children)) {
      const style = getComputedStyle(child);
      if (style.position === 'sticky') {
        const rect = child.getBoundingClientRect();
        stickyBottom = Math.max(stickyBottom, rect.bottom - container.getBoundingClientRect().top);
      }
    }
    const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elTop - stickyBottom - 12, behavior: 'smooth' });
  }, []);

  const handleSpeakerClick = useCallback(
    (name: string) => {
      if (activeSpeaker === name) {
        // Deselect — restore pre-filter state
        setActiveSpeaker(null);
        if (savedExpandedTurnsRef.current) {
          setExpandedTurns(savedExpandedTurnsRef.current);
          const restoreHighlight = savedIsHighlightModeRef.current;
          setIsHighlightMode(restoreHighlight);
          savedExpandedTurnsRef.current = null;
          // Clean stale URL param if restoring to non-highlight mode
          if (!restoreHighlight && typeof window !== "undefined") {
            const url = new URL(window.location.href);
            if (url.searchParams.has("expanded")) {
              url.searchParams.delete("expanded");
              window.history.replaceState({}, "", url.toString());
            }
          }
        }
        const m: Record<string, boolean> = {};
        allAnchors.forEach((a) => (m[a] = true));
        setExpandedSections(m);
      } else {
        // Select — save current state, expand speaker's turns, collapse others
        if (!activeSpeaker) {
          savedExpandedTurnsRef.current = expandedTurns;
          savedIsHighlightModeRef.current = isHighlightMode;
        }
        setActiveSpeaker(name);
        setIsHighlightMode(true);
        // Expand all turns for this speaker, collapse everyone else
        setExpandedTurns(
          new Set(turns.filter(t => t.speaker === name).map(t => t.turn_index))
        );
        // Only show sections containing this speaker
        const m: Record<string, boolean> = {};
        allAnchors.forEach((a) => {
          m[a] = (turnsBySection.get(a) ?? []).some((t) => t.speaker === name);
        });
        setExpandedSections(m);
        // Scroll to first turn for this speaker
        const firstTurn = turns.find(t => t.speaker === name);
        if (firstTurn) {
          requestAnimationFrame(() => {
            const el = document.querySelector(`[data-turn-index="${firstTurn.turn_index}"]`);
            if (el) scrollIntoViewWithOffset(el);
          });
        }
      }
    },
    [activeSpeaker, allAnchors, turnsBySection, turns, expandedTurns, isHighlightMode, scrollIntoViewWithOffset]
  );

  const scrollToSection = useCallback((anchor: string) => {
    lastNavWasKeyboardRef.current = false;
    setExpandedSections((prev) => ({ ...prev, [anchor]: true }));
    // Activate the first visible turn in the section
    const sectionTurns = turnsBySection.get(anchor) ?? [];
    const firstVisible = sectionTurns.find(t => !hiddenTurns.has(t.turn_index));
    if (firstVisible) {
      setActiveTurnIndex(firstVisible.turn_index);
      setAutoFollowEnabled(false);
    }
    setTimeout(() => {
      const el = sectionRefs.current[anchor];
      if (el) scrollIntoViewWithOffset(el);
    }, 60);
  }, [scrollIntoViewWithOffset, turnsBySection, hiddenTurns]);

  // Guard against Enter→blur double-fire on inputs
  const savingGuardRef = useRef(false);

  // Turn text edit handlers
  const startEditingTurnText = useCallback(
    (turnIndex: number, currentText: string) => {
      setEditingTurnText(turnIndex);
      setEditingTurnTextValue(currentText);
    },
    []
  );

  const cancelEditTurnText = useCallback(() => {
    savingGuardRef.current = true;
    setEditingTurnText(null);
    setTimeout(() => { savingGuardRef.current = false; }, 0);
  }, []);

  const saveTurnTextEdit = useCallback(
    async (turnIndex: number, originalText: string) => {
      if (savingGuardRef.current) return;
      const trimmed = editingTurnTextValue.trim();
      if (!trimmed || trimmed === originalText) {
        setEditingTurnText(null);
        return;
      }
      savingGuardRef.current = true;
      setEditingTurnText(null);
      try {
        await correctTurn(turnIndex, "text", originalText, trimmed);
      } finally {
        savingGuardRef.current = false;
      }
    },
    [correctTurn, editingTurnTextValue]
  );

  // Turn speaker re-attribution handler
  const handleTurnSpeakerChange = useCallback(
    async (turnIndex: number, oldSpeaker: string, newSpeaker: string) => {
      setTurnSpeakerDropdown(null);
      if (oldSpeaker === newSpeaker) return;
      await correctTurn(turnIndex, "speaker", oldSpeaker, newSpeaker);
    },
    [correctTurn]
  );

  // Stable callbacks for TurnRenderer (avoids defeating React.memo)
  const toggleSpeakerDropdown = useCallback(
    (turnIndex: number) => {
      setTurnSpeakerDropdown(prev => prev === turnIndex ? null : turnIndex);
    },
    []
  );

  const scrollToSpeakerPanel = useCallback(() => {
    speakersPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Clicking a turn clears any quote highlight from prep bullets
  const handleSetActiveTurn = useCallback((turnIndex: number) => {
    lastNavWasKeyboardRef.current = false;
    setActiveTurnIndex(turnIndex);
    setHighlightedQuote(null);
  }, []);

  // EXTRACT: useKeyboardShortcuts — begin
  // ---- Keyboard shortcuts state & derived values ----
  const [showHelpOverlay, setShowHelpOverlay] = useState(false);

  // Onboarding: show inline shortcut badges on active turn for the first N keyboard navigations
  const [kbdNavCount, setKbdNavCount] = useState(0);
  const lastNavWasKeyboardRef = useRef(false);
  const KBD_ONBOARDING_LIMIT = 5;
  useEffect(() => {
    const stored = localStorage.getItem("kbdNavCount");
    if (stored) setKbdNavCount(parseInt(stored, 10) || 0);
  }, []);

  const activeTurn = useMemo(() => {
    if (activeTurnIndex === null) return null;
    return turns.find(t => t.turn_index === activeTurnIndex) ?? null;
  }, [activeTurnIndex, turns]);

  // Flat ordered list of turn indices in visual order: monologue → intro → sections
  // Hidden turns are excluded — j/k navigation skips them.
  const navigableTurnIndices = useMemo(() => {
    const indices: number[] = [];
    if (isMonologue) {
      for (const t of turns) {
        if (!hiddenTurns.has(t.turn_index)) indices.push(t.turn_index);
      }
    } else {
      // Intro turns
      const introTurns = turnsBySection.get(INTRO_ANCHOR) ?? [];
      for (const t of introTurns) {
        if (!hiddenTurns.has(t.turn_index)) indices.push(t.turn_index);
      }
      // Section turns in section order
      for (const s of sections) {
        const sectionTurns = turnsBySection.get(s.anchor) ?? [];
        for (const t of sectionTurns) {
          if (!hiddenTurns.has(t.turn_index)) indices.push(t.turn_index);
        }
      }
    }
    return indices;
  }, [isMonologue, turns, turnsBySection, sections, hiddenTurns]);

  // Map turn_index → section anchor for n/p navigation
  const turnSectionMap = useMemo(() => {
    const map = new Map<number, string>();
    const introTurns = turnsBySection.get(INTRO_ANCHOR) ?? [];
    for (const t of introTurns) map.set(t.turn_index, INTRO_ANCHOR);
    for (const s of sections) {
      const sectionTurns = turnsBySection.get(s.anchor) ?? [];
      for (const t of sectionTurns) map.set(t.turn_index, s.anchor);
    }
    return map;
  }, [turnsBySection, sections]);

  // Section boundaries: first non-hidden turn index for each section in order
  const sectionFirstTurns = useMemo(() => {
    const result: Array<{ anchor: string; firstTurnIndex: number }> = [];
    const introTurns = turnsBySection.get(INTRO_ANCHOR) ?? [];
    const firstVisibleIntro = introTurns.find(t => !hiddenTurns.has(t.turn_index));
    if (firstVisibleIntro) {
      result.push({ anchor: INTRO_ANCHOR, firstTurnIndex: firstVisibleIntro.turn_index });
    }
    for (const s of sections) {
      const sectionTurns = turnsBySection.get(s.anchor) ?? [];
      const firstVisible = sectionTurns.find(t => !hiddenTurns.has(t.turn_index));
      if (firstVisible) {
        result.push({ anchor: s.anchor, firstTurnIndex: firstVisible.turn_index });
      }
    }
    return result;
  }, [turnsBySection, sections, hiddenTurns]);

  // Active turn's section anchor — used for section heading badge placement
  const activeTurnSectionAnchor = useMemo(() => {
    if (activeTurnIndex === null) return null;
    return turnSectionMap.get(activeTurnIndex) ?? null;
  }, [activeTurnIndex, turnSectionMap]);

  // Unified keydown listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      const isInput = tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;

      // Escape always works
      if (e.key === "Escape") {
        // Priority chain:
        // 1. Editing turn text
        if (editingTurnText !== null) {
          cancelEditTurnText();
          return;
        }
        // 2. SpeakerPanel editing
        if (speakerPanelEditRef.current?.cancelEditing()) {
          return;
        }
        // 3. Speaker dropdown / floating panel
        if (turnSpeakerDropdown !== null || floatingPanel !== null) {
          setTurnSpeakerDropdown(null);
          setFloatingPanel(null);
          return;
        }
        // 4. Help overlay
        if (showHelpOverlay) {
          setShowHelpOverlay(false);
          return;
        }
        // 5. Search focused
        if (document.activeElement === searchInputRef.current) {
          setSearchQuery("");
          setDebouncedQuery("");
          searchInputRef.current?.blur();
          return;
        }
        // 6. Clear speaker highlight and restore pre-filter state
        if (activeSpeaker) {
          setActiveSpeaker(null);
          if (savedExpandedTurnsRef.current) {
            setExpandedTurns(savedExpandedTurnsRef.current);
            const restoreHighlight = savedIsHighlightModeRef.current;
            setIsHighlightMode(restoreHighlight);
            savedExpandedTurnsRef.current = null;
            if (!restoreHighlight && typeof window !== "undefined") {
              const url = new URL(window.location.href);
              if (url.searchParams.has("expanded")) {
                url.searchParams.delete("expanded");
                window.history.replaceState({}, "", url.toString());
              }
            }
          }
          const m: Record<string, boolean> = {};
          allAnchors.forEach((a) => (m[a] = true));
          setExpandedSections(m);
          return;
        }
        // 7. Clear active turn
        if (activeTurnIndex !== null) {
          setActiveTurnIndex(null);
          return;
        }
        return;
      }

      // Cmd+S / Ctrl+S — save current view as default (works even from inputs)
      if (e.key === "s" && (e.metaKey || e.ctrlKey) && isHighlightMode && !savedMatchesCurrent && !saving) {
        e.preventDefault();
        handleSaveView();
        return;
      }

      // Input guard — all other keys blocked when in input
      if (isInput) return;

      // Any shortcut clears the quote highlight from prep bullet clicks
      if (highlightedQuote) setHighlightedQuote(null);

      switch (e.key) {
        // --- Navigation ---
        case "j": {
          lastNavWasKeyboardRef.current = true;
          if (kbdNavCount < KBD_ONBOARDING_LIMIT) {
            const next = kbdNavCount + 1;
            setKbdNavCount(next);
            localStorage.setItem("kbdNavCount", String(next));
          }
          const currentPos = activeTurnIndex !== null
            ? navigableTurnIndices.indexOf(activeTurnIndex)
            : -1;
          if (currentPos === -1) {
            // No active turn — activate first
            if (navigableTurnIndices.length > 0) {
              setActiveTurnIndex(navigableTurnIndices[0]);
              setAutoFollowEnabled(false);
            }
          } else if (currentPos < navigableTurnIndices.length - 1) {
            setActiveTurnIndex(navigableTurnIndices[currentPos + 1]);
            setAutoFollowEnabled(false);
          }
          break;
        }
        case "k": {
          lastNavWasKeyboardRef.current = true;
          if (kbdNavCount < KBD_ONBOARDING_LIMIT) {
            const next = kbdNavCount + 1;
            setKbdNavCount(next);
            localStorage.setItem("kbdNavCount", String(next));
          }
          const currentPos = activeTurnIndex !== null
            ? navigableTurnIndices.indexOf(activeTurnIndex)
            : -1;
          if (currentPos === -1) {
            // No active turn — activate last
            if (navigableTurnIndices.length > 0) {
              setActiveTurnIndex(navigableTurnIndices[navigableTurnIndices.length - 1]);
              setAutoFollowEnabled(false);
            }
          } else if (currentPos > 0) {
            setActiveTurnIndex(navigableTurnIndices[currentPos - 1]);
            setAutoFollowEnabled(false);
          }
          break;
        }
        case "n": {
          // Jump to first turn of next section (expand if collapsed)
          const currentAnchor = activeTurnIndex !== null
            ? turnSectionMap.get(activeTurnIndex) ?? null
            : null;
          const currentSectionIdx = currentAnchor !== null
            ? sectionFirstTurns.findIndex(s => s.anchor === currentAnchor)
            : -1;
          const nextIdx = currentSectionIdx + 1;
          if (nextIdx < sectionFirstTurns.length) {
            const targetAnchor = sectionFirstTurns[nextIdx].anchor;
            setExpandedSections((prev) => ({ ...prev, [targetAnchor]: true }));
            setActiveTurnIndex(sectionFirstTurns[nextIdx].firstTurnIndex);
            setAutoFollowEnabled(false);
          }
          break;
        }
        case "p": {
          // Jump to first turn of previous section (expand if collapsed)
          const currentAnchor = activeTurnIndex !== null
            ? turnSectionMap.get(activeTurnIndex) ?? null
            : null;
          const currentSectionIdx = currentAnchor !== null
            ? sectionFirstTurns.findIndex(s => s.anchor === currentAnchor)
            : -1;
          if (currentSectionIdx > 0) {
            const targetAnchor = sectionFirstTurns[currentSectionIdx - 1].anchor;
            setExpandedSections((prev) => ({ ...prev, [targetAnchor]: true }));
            setActiveTurnIndex(sectionFirstTurns[currentSectionIdx - 1].firstTurnIndex);
            setAutoFollowEnabled(false);
          }
          break;
        }

        // --- Playback ---
        case " ": {
          // Space — play/pause (only when video exists)
          if (!youtube_id) break; // no video — let browser handle scroll
          e.preventDefault(); // prevent scroll and button activation
          // Throttle: YouTube IFrame API uses postMessage — rapid playVideo/pauseVideo
          // calls queue up and getPlayerState() blocks the main thread waiting for each
          // response. Guard prevents firing faster than the iframe can process.
          if (playToggleGuardRef.current) break;
          playToggleGuardRef.current = true;
          setTimeout(() => { playToggleGuardRef.current = false; }, 200);
          const player = ytPlayerRef.current;
          if (player) {
            // Use ref instead of player.getPlayerState() — the synchronous IFrame
            // bridge call blocks the main thread during rapid toggling.
            if (isPlayingRef.current) {
              player.pauseVideo();
            } else {
              player.playVideo();
            }
          } else {
            pendingPlayRef.current = !pendingPlayRef.current;
            isPlayingRef.current = pendingPlayRef.current;
            setIsPlaying(pendingPlayRef.current);
          }
          break;
        }
        case "t": {
          // Seek to active turn timestamp + re-enable auto-scroll
          if (!activeTurn || activeTurn.timestamp_seconds == null) break;
          seekToTime(activeTurn.timestamp_seconds);
          setAutoFollowEnabled(true);
          break;
        }
        case "a": {
          // a — toggle auto-scroll at current video position
          if (e.shiftKey) break;
          setAutoFollowEnabled(prev => !prev);
          break;
        }
        case ">": {
          if (!youtube_id) break;
          cyclePlaybackRate(1, false);
          break;
        }
        case "<": {
          if (!youtube_id) break;
          cyclePlaybackRate(-1, false);
          break;
        }

        // --- Editing ---
        case "T": {
          // Shift+T — edit turn text
          if (!e.shiftKey || !activeTurn || isMonologue) break;
          startEditingTurnText(activeTurn.turn_index, activeTurn.text);
          break;
        }
        case "S": {
          // Shift+S — change speaker on active turn (re-attribute)
          if (!e.shiftKey || !activeTurn || isMonologue) break;
          if (allSpeakersGeneric) {
            speakersPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            setTurnSpeakerDropdown(activeTurn.turn_index);
          }
          break;
        }

        // --- View ---
        case "m": {
          if (activeTurnIndex === null) break;
          toggleTurnExpanded(activeTurnIndex);
          break;
        }
        case "x": {
          if (e.shiftKey) break;
          // x — toggle hide on active turn
          if (activeTurnIndex === null) break;
          const isCurrentlyHidden = hiddenTurns.has(activeTurnIndex);
          toggleTurnHidden(activeTurnIndex);
          if (!isCurrentlyHidden) {
            // Hiding the active turn — move to next non-hidden turn
            const currentPos = navigableTurnIndices.indexOf(activeTurnIndex);
            // navigableTurnIndices already excludes hidden, but the current turn
            // hasn't been removed yet (state update is async). Find the next
            // turn that isn't the one we just hid.
            const remaining = navigableTurnIndices.filter(idx => idx !== activeTurnIndex);
            if (remaining.length === 0) {
              setActiveTurnIndex(null);
            } else {
              // Prefer forward, fall back to backward
              const nextForward = remaining.find(idx => {
                const origPos = navigableTurnIndices.indexOf(idx);
                return origPos > currentPos;
              });
              setActiveTurnIndex(nextForward ?? remaining[remaining.length - 1]);
            }
            // If video is playing the turn we just hid, seek to next playable turn
            if (isPlayingRef.current && youtube_id) {
              const player = ytPlayerRef.current;
              if (player) {
                const time = player.getCurrentTime();
                const currentItem = expandedPlaylist.find(
                  item => item.turnIndex === activeTurnIndex && time >= item.start && time < item.end
                );
                if (currentItem) {
                  // Find next playable turn (not the one we're hiding)
                  const nextItem = expandedPlaylist.find(
                    item => item.turnIndex !== activeTurnIndex && item.start > currentItem.start
                  );
                  if (nextItem) {
                    skipInProgressRef.current = true;
                    player.seekTo(nextItem.start, true);
                    setCurrentTime(nextItem.start);
                    setTimeout(() => { skipInProgressRef.current = false; }, 500);
                  }
                }
              }
            }
          }
          break;
        }
        case "M": {
          // Shift+M — toggle expand/collapse all turns in active section
          if (!e.shiftKey || !activeTurnSectionAnchor) break;
          const sectionTurns = turnsBySectionRef.current.get(activeTurnSectionAnchor) ?? [];
          const sectionIndices = sectionTurns.map(t => t.turn_index);
          if (sectionIndices.length === 0) break;
          const currentExpanded = expandedTurnsRef.current;
          const expandedCount = sectionIndices.filter(i => currentExpanded.has(i)).length;
          const mostlyExpanded = expandedCount > sectionIndices.length / 2;
          // Save current view state before toggling (so Escape can restore)
          if (!activeSpeaker) {
            savedExpandedTurnsRef.current = expandedTurnsRef.current;
            savedIsHighlightModeRef.current = isHighlightMode;
          }
          setExpandedTurns(prev => {
            const next = new Set(prev);
            for (const i of sectionIndices) {
              if (mostlyExpanded) next.delete(i); else next.add(i);
            }
            return next;
          });
          setIsHighlightMode(true);
          break;
        }
        case "R": {
          // Shift+R — reset view
          if (!e.shiftKey) break;
          handleResetView();
          break;
        }

        // --- Speaker: number = expand/collapse toggle, Shift+number = edit speaker ---
        case "1": case "2": case "3": case "4": case "5":
        case "6": case "7": case "8": case "9": {
          const idx = parseInt(e.key) - 1;
          if (idx >= speakers.length) break;
          const speakerName = speakers[idx].name;
          if (e.shiftKey) {
            // Shift+number — enter speaker edit mode (rename)
            speakerPanelEditRef.current?.startEditing(speakerName, 'rename');
            speakersPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            // number — toggle expand/collapse for this speaker's turns
            const currentTurns = turnsRef.current;
            const currentExpanded = expandedTurnsRef.current;
            const speakerTurnIndices = currentTurns.filter(t => t.speaker === speakerName).map(t => t.turn_index);
            if (speakerTurnIndices.length === 0) break;
            const expandedCount = speakerTurnIndices.filter(i => currentExpanded.has(i)).length;
            const mostlyExpanded = expandedCount > speakerTurnIndices.length / 2;
            // Save current view state before filtering (so Escape can restore)
            if (!activeSpeaker) {
              savedExpandedTurnsRef.current = expandedTurnsRef.current;
              savedIsHighlightModeRef.current = isHighlightMode;
            }
            setExpandedTurns(prev => {
              const next = new Set(prev);
              for (const i of speakerTurnIndices) {
                if (mostlyExpanded) next.delete(i); else next.add(i);
              }
              return next;
            });
            setActiveSpeaker(speakerName);
            setIsHighlightMode(true);
          }
          break;
        }
        case "!": case "@": case "#": case "$": case "%":
        case "^": case "&": case "*": case "(": {
          // Shift+number produces these symbols — handle speaker edit
          const shiftNumMap: Record<string, number> = { "!": 0, "@": 1, "#": 2, "$": 3, "%": 4, "^": 5, "&": 6, "*": 7, "(": 8 };
          const idx = shiftNumMap[e.key];
          if (idx !== undefined && idx < speakers.length) {
            speakerPanelEditRef.current?.startEditing(speakers[idx].name, 'rename');
            speakersPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;
        }

        // --- Video mode ---
        case "q": {
          // Toggle pip: off ↔ pip
          setVideoMode(prev => prev === 'pip' ? 'collapsed' : 'pip');
          break;
        }
        case "w": {
          // Toggle full video: off ↔ full
          setVideoMode(prev => prev === 'full' ? 'collapsed' : 'full');
          break;
        }

        // --- Search & Meta ---
        case "/": {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          break;
        }
        case "?": {
          setShowHelpOverlay(prev => !prev);
          break;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    activeTurnIndex, activeTurn, activeSpeaker, navigableTurnIndices, turnSectionMap,
    sectionFirstTurns, editingTurnText, turnSpeakerDropdown, floatingPanel,
    showHelpOverlay, isMonologue, allSpeakersGeneric, speakers,
    cancelEditTurnText, startEditingTurnText, seekToTime, cyclePlaybackRate,
    toggleTurnExpanded, toggleTurnHidden, handleResetView,
    highlightedQuote, hiddenTurns, expandedPlaylist, youtube_id,
    handleSaveView, isHighlightMode, kbdNavCount, savedMatchesCurrent, saving,
    allAnchors, activeTurnSectionAnchor,
  ]);
  // EXTRACT: useKeyboardShortcuts — end

  // ---- Data quality banner ----
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const bannerConditions = useMemo(() => {
    const conditions: Array<{ key: string; text: string; action?: string }> = [];

    const genericSpeakers = speakers.filter((s) => /^Speaker \d+$/.test(s.name));
    if (genericSpeakers.length > 0) {
      conditions.push({
        key: "generic-speakers",
        text: `${genericSpeakers.length} speaker${genericSpeakers.length !== 1 ? "s" : ""} need${genericSpeakers.length === 1 ? "s" : ""} identification`,
        action: "Open Speaker Panel",
      });
    }

    const allInferred = turns.length > 0 && turns.every((t) => t.attribution === "inferred");
    if (allInferred) {
      conditions.push({
        key: "inferred-attribution",
        text: "All speaker attributions are auto-generated",
      });
    }

    if (youtube_id && turns.length > 0) {
      const withTimestamp = turns.filter((t) => t.timestamp_seconds != null).length;
      const coverage = Math.round((withTimestamp / turns.length) * 100);
      if (coverage < 50) {
        conditions.push({
          key: "low-timestamps",
          text: `Low timestamp coverage (${coverage}%)`,
        });
      }
    }

    // Check if source_name looks like a person not in speakers[]
    if (detectSpeakerMismatch(source_name, speakers)) {
      conditions.push({
        key: "host-missing",
        text: `"${source_name}" not found in speakers — may need rename`,
        action: "Open Speaker Panel",
      });
    }

    return conditions;
  }, [speakers, youtube_id, turns, source_name]);

  const showBanner = !bannerDismissed && bannerConditions.length > 0;

  // Compute placeholder groups for hidden turns.
  // Groups consecutive hidden turn indices and maps them to the turn_index
  // of the next visible turn (or -1 for trailing hidden turns).
  // Used by all three rendering paths (monologue, intro, section-bucketed).
  const computePlaceholderGroups = useCallback(
    (turnsList: typeof turns) => {
      const groups: Array<{ hiddenIndices: number[]; beforeTurnIndex: number }> = [];
      let currentGroup: number[] = [];

      for (const t of turnsList) {
        if (hiddenTurns.has(t.turn_index)) {
          currentGroup.push(t.turn_index);
        } else {
          if (currentGroup.length > 0) {
            groups.push({ hiddenIndices: currentGroup, beforeTurnIndex: t.turn_index });
            currentGroup = [];
          }
        }
      }
      // Trailing hidden turns (no visible turn after them)
      if (currentGroup.length > 0) {
        groups.push({ hiddenIndices: currentGroup, beforeTurnIndex: -1 });
      }
      return groups;
    },
    [hiddenTurns]
  );

  // Placeholder bar for hidden turns
  const renderPlaceholder = useCallback(
    (hiddenIndices: number[], key: string) => {
      const count = hiddenIndices.length;
      return (
        <div
          key={key}
          onClick={() => unhideGroup(hiddenIndices)}
          className="flex items-center justify-center py-2 px-4 my-1 border border-dashed border-[#d5d3cf] bg-[#faf9f7] text-[12px] text-[#999] cursor-pointer hover:bg-[#f5f4f2] hover:border-[#b8860b]/40 hover:text-[#888] transition-colors"
        >
          {count} hidden turn{count !== 1 ? "s" : ""}
        </div>
      );
    },
    [unhideGroup]
  );

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
        <div className="flex items-center gap-3 text-xs text-[#888]">
          {isHighlightMode && highlightDurationLabel && (
            <span className="text-[11px]">
              <span className="font-medium text-[#b8860b]">{highlightDurationLabel} highlight</span>
              {fullCallLabel && <span className="text-[#bbb]"> · {fullCallLabel}</span>}
            </span>
          )}
          <span>{date}</span>
          <span className="w-px h-4 bg-[#e5e3df]" />
          {headerActions}
        </div>
      </header>

      {/* Main 3-Column Grid */}
      <main className="flex-1 grid overflow-hidden max-md:flex max-md:flex-col max-md:overflow-visible" style={{ gridTemplateColumns: '280px 1fr 280px' }}>
        
        {/* Left Sidebar */}
        <aside className="h-full bg-[#faf9f7] flex flex-col border-r border-[#e5e3df] overflow-y-auto max-md:h-auto max-md:overflow-visible max-md:order-first max-md:border-r-0 max-md:border-b">
          {/* Speakers */}
          <div ref={speakersPanelRef}>
            <SpeakerPanel
              ref={speakerPanelEditRef}
              speakers={speakers}
              activeSpeaker={activeSpeaker}
              onSpeakerClick={handleSpeakerClick}
              hasInferredAttribution={has_inferred_attribution}
              saving={saving}
              confirmation={confirmation}
              apiError={apiError}
              clearConfirmation={clearConfirmation}
              clearError={clearError}
              onRenameSpeaker={renameSpeaker}
              onUpdateSpeaker={updateSpeaker}
              onActiveSpeakerUpdate={setActiveSpeaker}
              showNumberBadges={speakers.length >= 2}
            />
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[#e5e3df]">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#bbb]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchInputRef}
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
          <div className="px-3 py-2 flex-1">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#999]">
                {isMonologue ? "Topics" : "Sections"}
              </div>
              <span className="hidden md:inline-flex items-center gap-2 text-[10px] text-[#999]">
                <span className="inline-flex items-center gap-0.5"><kbd className={KBD_CLASS}>n</kbd> next</span>
                <span className="inline-flex items-center gap-0.5"><kbd className={KBD_CLASS}>p</kbd> prev</span>
              </span>
            </div>
            <div className="space-y-0.5">
              {sections.map((s) => {
                const cited = bulletAnchors.has(s.anchor);
                const hit = hasSearch && searchResults.anchors.has(s.anchor);
                const dim = hasSearch && !hit;
                const hitCount = searchResults.countBySection.get(s.anchor) ?? 0;
                const isActiveSection = activeTurnSectionAnchor === s.anchor;

                return (
                  <button
                    key={s.anchor}
                    onClick={() => !isMonologue && !dim && scrollToSection(s.anchor)}
                    className={`w-full text-left p-2.5 transition-all ${
                      isMonologue
                        ? 'cursor-default opacity-60'
                        : dim
                        ? 'pointer-events-none opacity-30'
                        : isActiveSection
                        ? 'bg-[#b8860b]/5 border-l-2 border-[#b8860b]'
                        : expandedSections[s.anchor]
                        ? 'bg-white border-l-2 border-[#b8860b]/30'
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
        <section ref={scrollContainerRef} className="relative h-full bg-white overflow-y-auto flex flex-col max-md:h-auto max-md:overflow-visible">
          {/* Single always-mounted YouTube player container — CSS positions it per videoMode */}
          {youtube_id && (
            <div
              className={
                videoMode === 'full'
                  ? "sticky top-0 z-40 flex-shrink-0 bg-[#0a0a0a]"
                  : videoMode === 'pip'
                  ? `fixed z-50 w-[300px] shadow-2xl rounded overflow-hidden bg-[#0a0a0a] ${floatingPanel !== null ? "bottom-4 left-4" : "bottom-4 right-4"}`
                  : "absolute -left-[9999px] w-1 h-1 overflow-hidden"
              }
            >
              <div className={
                videoMode === 'full'
                  ? "aspect-video max-h-[50vh] w-full bg-[#111] relative"
                  : videoMode === 'pip'
                  ? "aspect-video w-full relative"
                  : ""
              }>
                <div id="yt-player-container" className="h-full w-full" />
                {/* Mode switch controls — visible in full and pip */}
                {videoMode !== 'collapsed' && (
                  <div className={`absolute flex items-center gap-1 ${videoMode === 'full' ? 'top-3 right-3 gap-2' : 'top-2 right-2'}`}>
                    {videoMode === 'full' ? (
                      <button
                        onClick={() => setVideoMode('pip')}
                        className="p-2 bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors rounded"
                        title="Mini player (podcast mode)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 17L17 7M17 7H8M17 7v9" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => setVideoMode('full')}
                        className="p-1.5 bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition-colors rounded"
                        title="Full video (interview mode)"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m0-16l-3 3m3-3l3 3m-3 13l-3-3m3 3l3-3" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => setVideoMode('collapsed')}
                      className={`${videoMode === 'full' ? 'p-2 bg-black/50' : 'p-1.5 bg-black/60'} text-white/80 hover:text-white hover:bg-black/70 transition-colors rounded`}
                      title="Audio only"
                    >
                      <svg className={videoMode === 'full' ? 'w-4 h-4' : 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              {/* Control strip inside full-mode sticky container — avoids z-index overlap */}
              {videoMode === 'full' && (
                <div className="bg-[#faf9f7]/95 backdrop-blur border-b border-[#e5e3df] px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">{reelInfoBlock}</div>
                  {renderControlStripButtons('full')}
                </div>
              )}
            </div>
          )}

          {/* Audio Controls Bar - shown when collapsed */}
          {youtube_id && videoMode === 'collapsed' && (
            <div className="sticky top-0 z-40 bg-[#faf9f7]/95 backdrop-blur border-b border-[#e5e3df]">
              <div className="p-3 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
<button
                        onClick={() => {
                          if (ytPlayerRef.current) {
                            const state = ytPlayerRef.current.getPlayerState();
                            if (state === 1 || state === 3) {
                              // Playing or buffering — pause
                              ytPlayerRef.current.pauseVideo();
                            } else {
                              ytPlayerRef.current.playVideo();
                            }
                            // isPlaying synced via onStateChange listener
                          } else {
                            // Player not loaded yet — toggle pending play
                            pendingPlayRef.current = !pendingPlayRef.current;
                            isPlayingRef.current = pendingPlayRef.current;
                            setIsPlaying(pendingPlayRef.current);
                          }
                        }}
                        className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-[#b8860b] transition-colors"
                        title={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying ? (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                    <span className="text-[11px] font-mono text-[#b8860b]">{formatPlayerTime(currentTime)}</span>
                    <div className="flex-1 h-1 bg-[#e5e3df] relative rounded-full overflow-hidden">
                      <div
                        className="absolute top-0 left-0 h-full bg-[#b8860b]/40 transition-all"
                        style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-[#999]">{duration > 0 ? `-${formatPlayerTime(duration - currentTime)}` : "--:--"}</span>
                  </div>
                </div>
                {renderControlStripButtons('collapsed')}
              </div>
              {/* Reel info row inside audio bar */}
              {reelInfoBlock && (
                <div className="px-3 pb-2 flex items-center gap-2">{reelInfoBlock}</div>
              )}
            </div>
          )}

          {/* Control strip for pip mode — standalone sticky bar */}
          {youtube_id && videoMode === 'pip' && (
            <div className="sticky top-0 z-40 bg-[#faf9f7]/95 backdrop-blur border-b border-[#e5e3df]">
              <div className="px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">{reelInfoBlock}</div>
                {renderControlStripButtons('pip')}
              </div>
            </div>
          )}

          {/* No video — show reset view bar when in highlight mode, otherwise "no video" message */}
          {!youtube_id && (
            <div className="sticky top-0 z-40 bg-[#faf9f7]/95 backdrop-blur p-3 border-b border-[#e5e3df]">
              {reelInfoBlock ? (
                <div className="flex items-center gap-2">{reelInfoBlock}</div>
              ) : (
                <div className="text-center text-[11px] text-[#888]">
                  No video available for this episode
                </div>
              )}
            </div>
          )}

          {/* Data Quality Review Banner */}
          {showBanner && (
            <div className="mx-6 mt-4 mb-2 px-4 py-3 bg-[#b8860b]/10 border border-[#b8860b]/30 flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-[#8b6914] mb-1.5">This transcript needs review</div>
                <ul className="space-y-1">
                  {bannerConditions.map((c) => (
                    <li key={c.key} className="flex items-center gap-2 text-[12px] text-[#8b6914]/80">
                      <span className="w-1 h-1 rounded-full bg-[#b8860b]/60 shrink-0" />
                      <span>{c.text}</span>
                      {c.action && (
                        <button
                          onClick={() => speakersPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                          className="text-[11px] text-[#b8860b] hover:underline font-medium ml-1"
                        >
                          {c.action}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => setBannerDismissed(true)}
                className="text-[#b8860b]/50 hover:text-[#b8860b] transition-colors shrink-0 mt-0.5"
              >
                <span className="text-sm">&times;</span>
              </button>
            </div>
          )}

          {/* Transcript Content */}
          <div className="flex-1 px-6 py-5 space-y-1">
            {/* Monologue mode */}
            {isMonologue && turns.length > 0 && (() => {
              const placeholderGroups = computePlaceholderGroups(turns);
              const placeholderBeforeMap = new Map<number, typeof placeholderGroups[number]>();
              let trailingGroup: typeof placeholderGroups[number] | null = null;
              for (const g of placeholderGroups) {
                if (g.beforeTurnIndex === -1) {
                  trailingGroup = g;
                } else {
                  placeholderBeforeMap.set(g.beforeTurnIndex, g);
                }
              }

              return (
                <div ref={monologueRef}>
                  {turns.map((turn) => {
                    if (hiddenTurns.has(turn.turn_index)) return null;
                    const bucket = turn.section_anchor && turnsBySection.has(turn.section_anchor)
                      ? turn.section_anchor : INTRO_ANCHOR;
                    const bucketTurns = turnsBySection.get(bucket) ?? [];
                    const idxInBucket = bucketTurns.indexOf(turn);
                    const turnKey = `${bucket}-${idxInBucket === -1 ? 0 : idxInBucket}`;
                    const summary = turn_summaries?.[turn.turn_index];
                    const { first, hasMore } = firstSentence(turn.text);
                    const placeholderBefore = placeholderBeforeMap.get(turn.turn_index);

                    return (
                      <React.Fragment key={turn.turn_index}>
                        {placeholderBefore && renderPlaceholder(placeholderBefore.hiddenIndices, `ph-mono-${turn.turn_index}`)}
                        <TurnRenderer
                          turn={turn}
                          isExpanded={expandedTurns.has(turn.turn_index)}
                          isActive={activeTurnIndex === turn.turn_index}
                          isTurnHit={hasSearch && searchResults.turnKeys.has(turnKey)}
                          isCitedTurn={false}
                          isSpeakerFiltered={activeSpeaker === turn.speaker}
                          isHost={isCollapsedRole(turn.speaker)}
                          collapsedText={summary || (hasMore ? first : turn.text)}
                          collapsedIsSummary={!!summary}
                          canCollapse={hasMore || !!summary}
                          onToggleExpanded={toggleTurnExpanded}
                          onSetActive={handleSetActiveTurn}
                          onSeekToTime={seekToTime}
                          speakerInfo={undefined}
                          isEditingText={false}
                          editingTextValue=""
                          onStartEditText={null}
                          onSaveEditText={null}
                          onCancelEditText={null}
                          onEditTextChange={null}
                          saving={false}
                          showSpeakerDropdown={false}
                          speakers={null}
                          allSpeakersGeneric={false}
                          onTurnSpeakerChange={null}
                          onToggleSpeakerDropdown={null}
                          onScrollToSpeakerPanel={null}
                          searchQuery={debouncedQuery}
                          highlightedQuote={activeTurnIndex === turn.turn_index ? highlightedQuote : null}
                          showShortcutBadges={activeTurnIndex === turn.turn_index && kbdNavCount < KBD_ONBOARDING_LIMIT && lastNavWasKeyboardRef.current}
                        />
                      </React.Fragment>
                    );
                  })}
                  {trailingGroup && renderPlaceholder(trailingGroup.hiddenIndices, "ph-mono-trailing")}
                </div>
              );
            })()}

            {/* Multi-speaker mode: Intro turns */}
            {!isMonologue && (turnsBySection.get(INTRO_ANCHOR)?.length ?? 0) > 0 && (() => {
              const introTurns = turnsBySection.get(INTRO_ANCHOR)!;
              const placeholderGroups = computePlaceholderGroups(introTurns);
              const placeholderBeforeMap = new Map<number, typeof placeholderGroups[number]>();
              let trailingGroup: typeof placeholderGroups[number] | null = null;
              for (const g of placeholderGroups) {
                if (g.beforeTurnIndex === -1) {
                  trailingGroup = g;
                } else {
                  placeholderBeforeMap.set(g.beforeTurnIndex, g);
                }
              }

              return (
                <div className="mb-4">
                  {introTurns.map((turn, ti) => {
                    if (hiddenTurns.has(turn.turn_index)) return null;
                    const summary = turn_summaries?.[turn.turn_index];
                    const { first, hasMore } = firstSentence(turn.text);
                    const placeholderBefore = placeholderBeforeMap.get(turn.turn_index);

                    return (
                      <React.Fragment key={ti}>
                        {placeholderBefore && renderPlaceholder(placeholderBefore.hiddenIndices, `ph-intro-${turn.turn_index}`)}
                        <TurnRenderer
                          turn={turn}
                          isExpanded={expandedTurns.has(turn.turn_index)}
                          isActive={activeTurnIndex === turn.turn_index}
                          isTurnHit={hasSearch && searchResults.turnKeys.has(`${INTRO_ANCHOR}-${ti}`)}
                          isCitedTurn={false}
                          isSpeakerFiltered={activeSpeaker === turn.speaker}
                          isHost={isCollapsedRole(turn.speaker)}
                          collapsedText={summary || (hasMore ? first : turn.text)}
                          collapsedIsSummary={!!summary}
                          canCollapse={hasMore || !!summary}
                          onToggleExpanded={toggleTurnExpanded}
                          onSetActive={handleSetActiveTurn}
                          onSeekToTime={seekToTime}
                          speakerInfo={speakers.find(s => s.name === turn.speaker)}
                          isEditingText={editingTurnText === turn.turn_index}
                          editingTextValue={editingTurnTextValue}
                          onStartEditText={startEditingTurnText}
                          onSaveEditText={saveTurnTextEdit}
                          onCancelEditText={cancelEditTurnText}
                          onEditTextChange={setEditingTurnTextValue}
                          saving={saving}
                          showSpeakerDropdown={turnSpeakerDropdown === turn.turn_index}
                          speakers={speakers}
                          allSpeakersGeneric={allSpeakersGeneric}
                          onTurnSpeakerChange={handleTurnSpeakerChange}
                          onToggleSpeakerDropdown={toggleSpeakerDropdown}
                          onScrollToSpeakerPanel={scrollToSpeakerPanel}
                          searchQuery={debouncedQuery}
                          highlightedQuote={activeTurnIndex === turn.turn_index ? highlightedQuote : null}
                          showShortcutBadges={activeTurnIndex === turn.turn_index && kbdNavCount < KBD_ONBOARDING_LIMIT && lastNavWasKeyboardRef.current}
                        />
                      </React.Fragment>
                    );
                  })}
                  {trailingGroup && renderPlaceholder(trailingGroup.hiddenIndices, "ph-intro-trailing")}
                </div>
              );
            })()}

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
                    <span className="flex items-center gap-1">
                      {activeTurnSectionAnchor === section.anchor && (
                        <span className="hidden md:inline-flex items-center gap-2 mr-1 text-[10px] text-[#999]">
                          <span className="inline-flex items-center gap-0.5"><kbd className={KBD_CLASS}>n</kbd> next</span>
                          <span className="inline-flex items-center gap-0.5"><kbd className={KBD_CLASS}>p</kbd> prev</span>
                        </span>
                      )}
                      <span
                        className="text-[9px] text-[#bbb] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        ▶
                      </span>
                    </span>
                  </button>

                  {/* Section Turns */}
                  {isOpen && (() => {
                    const placeholderGroups = computePlaceholderGroups(sectionTurns);
                    const placeholderBeforeMap = new Map<number, typeof placeholderGroups[number]>();
                    let trailingGroup: typeof placeholderGroups[number] | null = null;
                    for (const g of placeholderGroups) {
                      if (g.beforeTurnIndex === -1) {
                        trailingGroup = g;
                      } else {
                        placeholderBeforeMap.set(g.beforeTurnIndex, g);
                      }
                    }
                    // If ALL turns in section are hidden, show placeholder only
                    const allHidden = sectionTurns.length > 0 && sectionTurns.every(t => hiddenTurns.has(t.turn_index));

                    return (
                      <div className="border-l border-[#e5e3df] ml-1">
                        {allHidden ? (
                          renderPlaceholder(sectionTurns.map(t => t.turn_index), `ph-section-all-${section.anchor}`)
                        ) : (
                          <>
                            {sectionTurns.map((turn, ti) => {
                              if (hiddenTurns.has(turn.turn_index)) return null;
                              const summary = turn_summaries?.[turn.turn_index];
                              const { first, hasMore } = firstSentence(turn.text);
                              const placeholderBefore = placeholderBeforeMap.get(turn.turn_index);

                              return (
                                <React.Fragment key={ti}>
                                  {placeholderBefore && renderPlaceholder(placeholderBefore.hiddenIndices, `ph-section-${section.anchor}-${turn.turn_index}`)}
                                  <TurnRenderer
                                    turn={turn}
                                    isExpanded={expandedTurns.has(turn.turn_index)}
                                    isActive={activeTurnIndex === turn.turn_index}
                                    isTurnHit={hasSearch && searchResults.turnKeys.has(`${section.anchor}-${ti}`)}
                                    isCitedTurn={citedTurnIndices.has(turn.turn_index)}
                                    isSpeakerFiltered={activeSpeaker === turn.speaker}
                                    isHost={isCollapsedRole(turn.speaker)}
                                    collapsedText={summary || (hasMore ? first : turn.text)}
                                    collapsedIsSummary={!!summary}
                                    canCollapse={hasMore || !!summary}
                                    onToggleExpanded={toggleTurnExpanded}
                                    onSetActive={handleSetActiveTurn}
                                    onSeekToTime={seekToTime}
                                    speakerInfo={speakers.find(s => s.name === turn.speaker)}
                                    isEditingText={editingTurnText === turn.turn_index}
                                    editingTextValue={editingTurnTextValue}
                                    onStartEditText={startEditingTurnText}
                                    onSaveEditText={saveTurnTextEdit}
                                    onCancelEditText={cancelEditTurnText}
                                    onEditTextChange={setEditingTurnTextValue}
                                    saving={saving}
                                    showSpeakerDropdown={turnSpeakerDropdown === turn.turn_index}
                                    speakers={speakers}
                                    allSpeakersGeneric={allSpeakersGeneric}
                                    onTurnSpeakerChange={handleTurnSpeakerChange}
                                    onToggleSpeakerDropdown={toggleSpeakerDropdown}
                                    onScrollToSpeakerPanel={scrollToSpeakerPanel}
                                    searchQuery={debouncedQuery}
                                    highlightedQuote={activeTurnIndex === turn.turn_index ? highlightedQuote : null}
                                    showShortcutBadges={activeTurnIndex === turn.turn_index && kbdNavCount < KBD_ONBOARDING_LIMIT && lastNavWasKeyboardRef.current}
                                  />
                                </React.Fragment>
                              );
                            })}
                            {trailingGroup && renderPlaceholder(trailingGroup.hiddenIndices, `ph-section-${section.anchor}-trailing`)}
                          </>
                        )}
                      </div>
                    );
                  })()}
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
                              // Find the matching turn by text prefix. Speaker/section
                              // from bullets can be partial ("Hannah" vs "Hannah King")
                              // or null, so text match is the primary signal.
                              const quotePrefix = firstQuote.quote.slice(0, 80);
                              const matchingTurn = turns.find(t =>
                                t.text.includes(quotePrefix)
                              );
                              if (matchingTurn) {
                                setActiveTurnIndex(matchingTurn.turn_index);
                                // Ensure turn is expanded so the highlight is visible
                                suppressUrlSyncRef.current = false;
                                setExpandedTurns(prev => {
                                  if (prev.has(matchingTurn.turn_index)) return prev;
                                  const next = new Set(prev);
                                  next.add(matchingTurn.turn_index);
                                  return next;
                                });
                                setHighlightedQuote(firstQuote.quote);
                              } else if (isMonologue) {
                                if (monologueRef.current) scrollIntoViewWithOffset(monologueRef.current);
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

          {/* PiP video is now rendered via the unified player container (position: fixed) */}
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

      {/* Keyboard Shortcut Help Modal */}
      {showHelpOverlay && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center"
          onClick={() => setShowHelpOverlay(false)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#e5e3df] flex items-center justify-between">
              <span className="text-[14px] font-medium text-[#333]">Keyboard Shortcuts</span>
              <button
                onClick={() => setShowHelpOverlay(false)}
                className="text-[#bbb] hover:text-[#666] text-lg leading-none"
              >&times;</button>
            </div>
            <div className="px-5 py-4 space-y-4 text-[12px]">
              {([
                ["Navigation", [
                  ["j", "Next turn"],
                  ["k", "Previous turn"],
                  ["n", "Next section"],
                  ["p", "Previous section"],
                ]],
                ...(youtube_id ? [
                  ["Playback", [
                    ["Space", "Play / pause"],
                    ["t", "Seek to active turn + auto-scroll"],
                    ["a", "Toggle auto-scroll"],
                    [">", "Increase speed"],
                    ["<", "Decrease speed"],
                  ]],
                ] as [string, [string, string][]][] : []),
                ["Editing", [
                  ["\u21E7T", "Edit turn text"],
                  ["\u21E7S", "Change turn speaker"],
                ]],
                ["View", [
                  ["m", "Toggle expand / collapse"],
                  ["\u21E7M", "Toggle all turns in section"],
                  ["x", "Toggle hide turn"],
                  ["\u21E7R", "Reset to defaults"],
                  [`${modSymbol}S`, "Save view as default"],
                ]],
                ["Speakers", [
                  ["1\u20139", "Toggle expand / collapse"],
                  ["\u21E71\u20139", "Edit speaker name"],
                ]],
                ...(youtube_id ? [
                  ["Video", [
                    ["q", "Toggle pip / audio-only"],
                    ["w", "Toggle full / audio-only"],
                  ]],
                ] as [string, [string, string][]][] : []),
                ["Search", [
                  ["/", "Focus search"],
                  ["?", "Toggle this help"],
                  ["Esc", "Close / cancel / clear active"],
                ]],
              ] as [string, [string, string][]][]).map(([group, keys]) => (
                <div key={group}>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-[#999] mb-1.5">{group}</div>
                  <div className="space-y-1">
                    {keys.map(([key, desc]) => (
                      <div key={key} className="flex items-center gap-3">
                        <kbd className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 bg-[#f5f4f2] border border-[#e5e3df] rounded text-[11px] font-mono text-[#555]">{key}</kbd>
                        <span className="text-[#666]">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 bg-[#faf9f7] border-t border-[#e5e3df] text-[11px] text-[#888]">
              Press <kbd className="font-mono px-1 py-0.5 bg-[#f5f4f2] border border-[#e5e3df] rounded text-[10px]">?</kbd> to dismiss
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
