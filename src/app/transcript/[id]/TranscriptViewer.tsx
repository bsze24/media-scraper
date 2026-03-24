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
import { useAppearanceApi } from "./useAppearanceApi";

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
    renameSpeaker,
    updateSpeaker,
    correctTurn,
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

  // Track whether we're in highlight mode (URL has ?expanded= param)
  const [isHighlightMode, setIsHighlightMode] = useState(false);

  // On mount, read URL params and override expandedTurns if ?expanded= is present.
  // useEffect avoids hydration mismatch (server doesn't have window.location).
  const urlInitRef = useRef(false);
  useEffect(() => {
    if (urlInitRef.current) return;
    urlInitRef.current = true;
    const params = new URLSearchParams(window.location.search);
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
  }, []);

  const toggleTurnExpanded = useCallback((turnIndex: number) => {
    setExpandedTurns(prev => {
      const next = new Set(prev);
      if (next.has(turnIndex)) next.delete(turnIndex);
      else next.add(turnIndex);
      return next;
    });
    // Once user toggles anything, we're in highlight mode
    setIsHighlightMode(true);
  }, []);

  // Sync expandedTurns to URL via replaceState
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isHighlightMode) return;
    const indices = Array.from(expandedTurns).sort((a, b) => a - b).join(",");
    const url = new URL(window.location.href);
    url.searchParams.set("expanded", indices);
    window.history.replaceState({}, "", url.toString());
  }, [expandedTurns, isHighlightMode]);

  // Reset view handler — returns to role-based defaults, exits highlight mode
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const handleResetView = useCallback(() => {
    setExpandedTurns(computeRoleDefaults());
    setIsHighlightMode(false);
    // Remove expanded param from URL
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("expanded");
      window.history.replaceState({}, "", url.toString());
    }
    setResetConfirmation(true);
    setTimeout(() => setResetConfirmation(false), 2000);
  }, [computeRoleDefaults]);
  // ---- Active turn (cursor) ----
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);

  // Scroll active turn into view
  useEffect(() => {
    if (activeTurnIndex === null) return;
    const el = document.querySelector(`[data-turn-index="${activeTurnIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeTurnIndex]);

  // Auto-expand section containing active turn
  useEffect(() => {
    if (activeTurnIndex === null) return;
    const activeTurn = turns.find(t => t.turn_index === activeTurnIndex);
    if (!activeTurn?.section_anchor) return;
    if (!expandedSections[activeTurn.section_anchor]) {
      setExpandedSections(prev => ({ ...prev, [activeTurn.section_anchor!]: true }));
    }
  }, [activeTurnIndex, turns, expandedSections]);

  // ---- Auto-follow / skip playback ----
  const [autoFollowEnabled, setAutoFollowEnabled] = useState(true);
  const skipInProgressRef = useRef(false);

  // Ordered list of expanded turns with timestamps — the "highlight reel" playlist.
  // end = next sequential turn's timestamp (regardless of expanded), defining airtime.
  const expandedPlaylist = useMemo(() => {
    const withTimestamps = turns
      .filter(t => expandedTurns.has(t.turn_index) && t.timestamp_seconds != null)
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
  }, [turns, expandedTurns]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [feedback, setFeedback] = useState<Record<number, BulletFeedback>>({});
  const [floatingPanel, setFloatingPanel] = useState<{ idx: number } | null>(null);
  const [panelDraft, setPanelDraft] = useState("");
  const [videoMode, setVideoMode] = useState<'collapsed' | 'pip' | 'full'>('collapsed');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [relatedExpanded, setRelatedExpanded] = useState(false);

  // ---- Editing state ----
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editingSpeakerName, setEditingSpeakerName] = useState("");
  const [editingTurnText, setEditingTurnText] = useState<number | null>(null);
  const [editingTurnTextValue, setEditingTurnTextValue] = useState("");
  const [turnSpeakerDropdown, setTurnSpeakerDropdown] = useState<number | null>(null);
  const speakersPanelRef = useRef<HTMLDivElement | null>(null);

  const panelInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const monologueRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingPlayRef = useRef<boolean>(false);

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
          },
          onStateChange: (event: { data: number }) => {
            // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0, BUFFERING=3
            // Treat buffering as "playing" — user intent is to play
            setIsPlaying(event.data === 1 || event.data === 3);
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

      // Auto-follow: track active turn and skip collapsed regions
      if (!autoFollowEnabled || skipInProgressRef.current) return;

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
          // Past all expanded turns — pause
          player.pauseVideo();
        }
      }
    }, 250);
    return () => clearInterval(interval);
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

  // Escape to close panels + dropdowns
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFloatingPanel(null);
        setTurnSpeakerDropdown(null);
        setEditingSpeaker(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  // Guard against Enter→blur double-fire on inputs
  const savingGuardRef = useRef(false);

  // Speaker rename handler
  const handleSpeakerRename = useCallback(
    async (oldName: string, newName: string) => {
      if (savingGuardRef.current) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) {
        setEditingSpeaker(null);
        return;
      }
      savingGuardRef.current = true;
      setEditingSpeaker(null);
      try {
        await renameSpeaker(oldName, trimmed);
        // Update active speaker filter if the renamed speaker was selected
        setActiveSpeaker((prev) => prev === oldName ? trimmed : prev);
      } finally {
        savingGuardRef.current = false;
      }
    },
    [renameSpeaker]
  );

  // Speaker role change handler
  const handleRoleChange = useCallback(
    async (speakerName: string, role: string) => {
      await updateSpeaker(speakerName, { role });
    },
    [updateSpeaker]
  );

  // Speaker title/affiliation edit
  const [editingSpeakerMeta, setEditingSpeakerMeta] = useState<string | null>(null);
  const [editingSpeakerMetaValue, setEditingSpeakerMetaValue] = useState("");

  const handleSpeakerMetaSave = useCallback(
    async (speakerName: string, currentTitle?: string, currentAffiliation?: string) => {
      if (savingGuardRef.current) return;
      const raw = editingSpeakerMetaValue.trim();
      savingGuardRef.current = true;
      setEditingSpeakerMeta(null);
      // Parse "Title, Affiliation" format
      const commaIdx = raw.indexOf(",");
      let newTitle: string;
      let newAffiliation: string;
      if (commaIdx >= 0) {
        newTitle = raw.slice(0, commaIdx).trim();
        newAffiliation = raw.slice(commaIdx + 1).trim();
      } else {
        newTitle = raw;
        newAffiliation = "";
      }
      // Skip if unchanged
      if (newTitle === (currentTitle ?? "") && newAffiliation === (currentAffiliation ?? "")) {
        savingGuardRef.current = false;
        return;
      }
      try {
        await updateSpeaker(speakerName, { title: newTitle, affiliation: newAffiliation });
      } finally {
        savingGuardRef.current = false;
      }
    },
    [updateSpeaker, editingSpeakerMetaValue]
  );

  // Turn text edit handlers
  const startEditingTurnText = useCallback(
    (turnIndex: number, currentText: string) => {
      setEditingTurnText(turnIndex);
      setEditingTurnTextValue(currentText);
    },
    []
  );

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

    return conditions;
  }, [speakers, youtube_id, turns]);

  const showBanner = !bannerDismissed && bannerConditions.length > 0;

  const ROLE_OPTIONS = ["host", "guest", "rowspace", "customer", "other"] as const;

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
          <div ref={speakersPanelRef} className="px-3 py-3 border-b border-[#e5e3df]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#999]">Speakers</span>
              {has_inferred_attribution && (
                <span className="text-[9px] text-[#bbb] italic" title="Speaker labels were auto-generated and may not be accurate">
                  (auto)
                </span>
              )}
            </div>
            {/* Confirmation / Error banners */}
            {confirmation && (
              <div className="mb-2 px-2 py-1.5 bg-green-50 border border-green-200 text-[11px] text-green-700 flex items-center justify-between">
                <span>{confirmation}</span>
                <button onClick={clearConfirmation} className="text-green-400 hover:text-green-600 ml-2">&times;</button>
              </div>
            )}
            {apiError && (
              <div className="mb-2 px-2 py-1.5 bg-red-50 border border-red-200 text-[11px] text-red-700 flex items-center justify-between">
                <span>{apiError}</span>
                <button onClick={clearError} className="text-red-400 hover:text-red-600 ml-2">&times;</button>
              </div>
            )}
            <div className="space-y-2">
              {speakers.map((s) => {
                const isHost = s.role === "host" || s.role === "rowspace";
                const isEditing = editingSpeaker === s.name;

                return (
                  <div
                    key={s.name}
                    className={`w-full p-2 border transition-colors ${
                      isHost
                        ? activeSpeaker === s.name
                          ? 'bg-[#f5f4f2] border-[#ccc]'
                          : 'bg-[#f5f4f2] border-[#e5e3df] hover:border-[#ccc]'
                        : activeSpeaker === s.name
                        ? 'bg-white border-[#b8860b]/30'
                        : 'bg-white border-[#e5e3df] hover:border-[#b8860b]/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingSpeakerName}
                          onChange={(e) => setEditingSpeakerName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSpeakerRename(s.name, editingSpeakerName);
                            if (e.key === "Escape") { savingGuardRef.current = true; setEditingSpeaker(null); setTimeout(() => { savingGuardRef.current = false; }, 0); }
                          }}
                          onBlur={() => handleSpeakerRename(s.name, editingSpeakerName)}
                          disabled={saving}
                          className="flex-1 text-[12px] font-medium text-[#333] bg-white border border-[#b8860b]/50 px-1.5 py-0.5 outline-none focus:border-[#b8860b]"
                        />
                      ) : (
                        <button
                          onClick={() => handleSpeakerClick(s.name)}
                          className="flex-1 text-left"
                        >
                          <div className={`text-[12px] font-medium ${isHost ? 'text-[#555]' : activeSpeaker === s.name ? 'text-[#b8860b]' : 'text-[#555]'}`}>
                            {s.name}
                          </div>
                        </button>
                      )}
                      {!isEditing && (
                        <button
                          onClick={() => {
                            setEditingSpeaker(s.name);
                            setEditingSpeakerName(s.name);
                          }}
                          className="p-0.5 text-[#ccc] hover:text-[#888] transition-colors"
                          title="Rename speaker"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      {editingSpeakerMeta === s.name ? (
                        <input
                          autoFocus
                          value={editingSpeakerMetaValue}
                          onChange={(e) => setEditingSpeakerMetaValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSpeakerMetaSave(s.name, s.title, s.affiliation);
                            if (e.key === "Escape") { savingGuardRef.current = true; setEditingSpeakerMeta(null); setTimeout(() => { savingGuardRef.current = false; }, 0); }
                          }}
                          onBlur={() => handleSpeakerMetaSave(s.name, s.title, s.affiliation)}
                          disabled={saving}
                          placeholder="Title, Affiliation"
                          className="flex-1 text-[10px] text-[#888] bg-white border border-[#b8860b]/50 px-1.5 py-0.5 outline-none focus:border-[#b8860b]"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingSpeakerMeta(s.name);
                            setEditingSpeakerMetaValue(
                              [s.title, s.affiliation].filter(Boolean).join(", ")
                            );
                          }}
                          className="text-[10px] text-[#888] hover:text-[#b8860b] transition-colors text-left"
                        >
                          {[s.title, s.affiliation].filter(Boolean).join(", ") || (
                            <span className="text-[#ccc] italic">+ Add title</span>
                          )}
                        </button>
                      )}
                      <select
                        value={s.role}
                        onChange={(e) => handleRoleChange(s.name, e.target.value)}
                        disabled={saving}
                        className="text-[10px] text-[#999] bg-transparent border-none outline-none cursor-pointer hover:text-[#b8860b] transition-colors"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
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
        <section className="relative h-full bg-white overflow-y-auto flex flex-col max-md:h-auto max-md:overflow-visible">
          {/* Single always-mounted YouTube player container — CSS positions it per videoMode */}
          {youtube_id && (
            <div
              className={
                videoMode === 'full'
                  ? "sticky top-0 z-40 bg-[#0a0a0a]"
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
                <div className="flex items-center gap-2 text-[#888]">
                  {/* Auto-follow toggle */}
                  <button
                    onClick={() => setAutoFollowEnabled(prev => !prev)}
                    className={`text-[10px] px-2 py-1 rounded transition-colors ${
                      autoFollowEnabled
                        ? 'bg-[#b8860b]/15 text-[#b8860b] hover:bg-[#b8860b]/25'
                        : 'text-[#999] hover:text-[#666] hover:bg-[#f5f4f2]'
                    }`}
                    title={autoFollowEnabled ? "Auto-follow: ON — skips collapsed turns" : "Auto-follow: OFF — plays everything"}
                  >
                    {autoFollowEnabled ? "Follow ON" : "Follow OFF"}
                  </button>
                  <span className="w-px h-4 bg-[#e5e3df]" />
                  {/* Mini PiP */}
                  <button
                    onClick={() => setVideoMode('pip')}
                    className="hover:text-[#b8860b] transition-colors p-1.5 hover:bg-[#f5f4f2] rounded"
                    title="Mini player (podcast mode)"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 17L17 7M17 7H8M17 7v9" />
                    </svg>
                  </button>
                  {/* Full expand - vertical arrows */}
                  <button
                    onClick={() => setVideoMode('full')}
                    className="hover:text-[#b8860b] transition-colors p-1.5 hover:bg-[#f5f4f2] rounded"
                    title="Full video (interview mode)"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m0-16l-3 3m3-3l3 3m-3 13l-3-3m3 3l3-3" />
                    </svg>
                  </button>
                </div>
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

          {/* Reset view — only shown in highlight mode */}
          {isHighlightMode && (
            <div className="mx-6 mt-2 flex items-center gap-2">
              <button
                onClick={handleResetView}
                className="text-[11px] text-[#999] hover:text-[#b8860b] transition-colors"
              >
                Reset view
              </button>
              {resetConfirmation && (
                <span className="text-[11px] text-green-600">View reset</span>
              )}
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
                  const isHost = isCollapsedRole(turn.speaker);
                  const isExpanded = expandedTurns.has(turn.turn_index);
                  const { first, hasMore } = firstSentence(turn.text);
                  const summary = turn_summaries?.[turn.turn_index];
                  const canCollapse = hasMore || !!summary;

                  const isActive = activeTurnIndex === turn.turn_index;

                  return (
                    <div
                      key={turn.turn_index}
                      data-turn-index={turn.turn_index}
                      onClick={() => setActiveTurnIndex(turn.turn_index)}
                      className={`group relative py-3 px-4 transition-all scroll-mt-20 border-l-[3px] ${
                        isActive
                          ? 'bg-[#b8860b]/5 border-[#b8860b]'
                          : isTurnHit
                          ? 'bg-[#eff6ff] border-[#5a8fc7]'
                          : 'hover:bg-[#faf9f7] border-transparent'
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
                      <div className="relative group/text">
                        <p className={`text-[14px] leading-[1.6] ${
                          !isExpanded && isHost ? 'text-[#555] italic' : 'text-[#333]'
                        }`}>
                          {isExpanded || isTurnHit
                            ? highlightText(turn.text, debouncedQuery)
                            : summary
                            ? summary
                            : hasMore
                            ? highlightText(first, debouncedQuery)
                            : highlightText(turn.text, debouncedQuery)
                          }
                          {canCollapse && !isTurnHit && (
                            <button
                              onClick={() => toggleTurnExpanded(turn.turn_index)}
                              className="ml-1 text-[12px] text-[#b8860b] hover:underline transition-colors"
                              title={isExpanded ? (summary ? "Show summary" : "Show less") : "Show full text"}
                            >
                              {isExpanded ? "[less]" : "[more]"}
                            </button>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Multi-speaker mode: Intro turns */}
            {!isMonologue && (turnsBySection.get(INTRO_ANCHOR)?.length ?? 0) > 0 && (
              <div className="mb-4">
                {turnsBySection.get(INTRO_ANCHOR)!.map((turn, ti) => {
                  const isHost = isCollapsedRole(turn.speaker);
                  const dimmed = activeSpeaker && activeSpeaker !== turn.speaker;
                  const isTurnHit = hasSearch && searchResults.turnKeys.has(`${INTRO_ANCHOR}-${ti}`);
                  const isExpanded = expandedTurns.has(turn.turn_index);
                  const { first, hasMore } = firstSentence(turn.text);
                  const summary = turn_summaries?.[turn.turn_index];
                  const canCollapse = hasMore || !!summary;

                  const speakerInfo = speakers.find(s => s.name === turn.speaker);
                  const isActive = activeTurnIndex === turn.turn_index;
                  return (
                    <div
                      key={ti}
                      data-turn-index={turn.turn_index}
                      onClick={() => setActiveTurnIndex(turn.turn_index)}
                      className={`group relative py-3 px-4 transition-all scroll-mt-20 border-l-[3px] ${
                        isActive
                          ? 'bg-[#b8860b]/5 border-[#b8860b]'
                          : isTurnHit
                          ? 'bg-[#eff6ff] border-[#5a8fc7]'
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
                        <span className="relative">
                          <button
                            onClick={() => {
                              if (allSpeakersGeneric) {
                                speakersPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                              } else {
                                setTurnSpeakerDropdown(turnSpeakerDropdown === turn.turn_index ? null : turn.turn_index);
                              }
                            }}
                            className={`text-[13px] font-medium ${isHost ? 'text-[#666]' : 'text-[#b8860b]'} hover:underline`}
                          >
                            {turn.speaker}
                          </button>
                          {turnSpeakerDropdown === turn.turn_index && !allSpeakersGeneric && (
                            <div data-speaker-dropdown className="absolute left-0 top-full z-50 mt-1 bg-white border border-[#e5e3df] shadow-lg py-1 min-w-[140px]">
                              {speakers.map((sp) => (
                                <button
                                  key={sp.name}
                                  onClick={() => handleTurnSpeakerChange(turn.turn_index, turn.speaker, sp.name)}
                                  className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f5f4f2] transition-colors ${
                                    sp.name === turn.speaker ? 'text-[#b8860b] font-medium' : 'text-[#555]'
                                  }`}
                                >
                                  {sp.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </span>
                        {speakerInfo && (
                          <span className="text-[10px] text-[#999]">
                            {[speakerInfo.title, speakerInfo.affiliation].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </div>
                      {editingTurnText === turn.turn_index ? (
                        <div>
                          <textarea
                            autoFocus
                            value={editingTurnTextValue}
                            onChange={(e) => setEditingTurnTextValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") { savingGuardRef.current = true; setEditingTurnText(null); setTimeout(() => { savingGuardRef.current = false; }, 0); }
                              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveTurnTextEdit(turn.turn_index, turn.text);
                            }}
                            onBlur={() => saveTurnTextEdit(turn.turn_index, turn.text)}
                            disabled={saving}
                            className="w-full text-[14px] leading-[1.6] text-[#333] bg-white border border-[#b8860b]/50 p-2 outline-none focus:border-[#b8860b] resize-none max-h-[300px] overflow-y-auto"
                            rows={Math.min(10, Math.max(2, editingTurnTextValue.split("\n").length))}
                          />
                          <div className="text-[10px] text-[#bbb] mt-1">Cmd+Enter to save, Escape to cancel</div>
                        </div>
                      ) : (
                        <div className="relative group/text">
                          <p className={`text-[14px] leading-[1.6] ${
                            !isExpanded && isHost ? 'text-[#555] italic' : 'text-[#333]'
                          }`}>
                            {isExpanded || isTurnHit
                              ? highlightText(turn.text, debouncedQuery)
                              : summary
                              ? summary
                              : hasMore
                              ? highlightText(first, debouncedQuery)
                              : highlightText(turn.text, debouncedQuery)
                            }
                            {canCollapse && !isTurnHit && (
                              <button
                                onClick={() => toggleTurnExpanded(turn.turn_index)}
                                className="ml-1 text-[12px] text-[#b8860b] hover:underline transition-colors"
                                title={isExpanded ? (summary ? "Show summary" : "Show less") : "Show full text"}
                              >
                                {isExpanded ? "[less]" : "[more]"}
                              </button>
                            )}
                          </p>
                          <button
                            onClick={() => startEditingTurnText(turn.turn_index, turn.text)}
                            className="absolute top-0 right-0 p-1 text-[#ccc] hover:text-[#888] opacity-0 group-hover/text:opacity-100 transition-opacity"
                            title="Edit text"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        </div>
                      )}
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
                        const isHost = isCollapsedRole(turn.speaker);
                        const key = `${section.anchor}-${ti}`;
                        const isExpanded = expandedTurns.has(turn.turn_index);
                        const isTurnHit = hasSearch && searchResults.turnKeys.has(key);
                        const { first, hasMore } = firstSentence(turn.text);
                        const summary = turn_summaries?.[turn.turn_index];
                        const canCollapse = hasMore || !!summary;
                        const dimmed = activeSpeaker && activeSpeaker !== turn.speaker;
                        const speakerInfo = speakers.find(s => s.name === turn.speaker);
                        const isCitedTurn = citedTurnIndices.has(turn.turn_index);
                        const isActive = activeTurnIndex === turn.turn_index;

                        return (
                          <div
                            key={ti}
                            data-turn-index={turn.turn_index}
                            onClick={() => setActiveTurnIndex(turn.turn_index)}
                            className={`group relative py-3 px-4 transition-all scroll-mt-20 border-l-[3px] ${
                              isActive
                                ? 'bg-[#b8860b]/5 border-[#b8860b]'
                                : isTurnHit
                                ? 'bg-[#eff6ff] border-[#5a8fc7]'
                                : isCitedTurn
                                ? 'bg-[#b8860b]/5 border-[#b8860b]/40'
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
                              {/* Speaker name — clickable for re-attribution */}
                              <span className="relative">
                                <button
                                  onClick={() => {
                                    if (allSpeakersGeneric) {
                                      // Nudge to rename first
                                      speakersPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                                    } else {
                                      setTurnSpeakerDropdown(turnSpeakerDropdown === turn.turn_index ? null : turn.turn_index);
                                    }
                                  }}
                                  className={`text-[13px] font-medium ${isHost ? 'text-[#666]' : 'text-[#b8860b]'} hover:underline`}
                                >
                                  {turn.speaker}
                                </button>
                                {turnSpeakerDropdown === turn.turn_index && !allSpeakersGeneric && (
                                  <div data-speaker-dropdown className="absolute left-0 top-full z-50 mt-1 bg-white border border-[#e5e3df] shadow-lg py-1 min-w-[140px]">
                                    {speakers.map((sp) => (
                                      <button
                                        key={sp.name}
                                        onClick={() => handleTurnSpeakerChange(turn.turn_index, turn.speaker, sp.name)}
                                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f5f4f2] transition-colors ${
                                          sp.name === turn.speaker ? 'text-[#b8860b] font-medium' : 'text-[#555]'
                                        }`}
                                      >
                                        {sp.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
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

                            {/* Text content — with edit capability */}
                            {editingTurnText === turn.turn_index ? (
                              <div>
                                <textarea
                                  autoFocus
                                  value={editingTurnTextValue}
                                  onChange={(e) => setEditingTurnTextValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") { savingGuardRef.current = true; setEditingTurnText(null); setTimeout(() => { savingGuardRef.current = false; }, 0); }
                                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                      saveTurnTextEdit(turn.turn_index, turn.text);
                                    }
                                  }}
                                  onBlur={() => saveTurnTextEdit(turn.turn_index, turn.text)}
                                  disabled={saving}
                                  className="w-full text-[14px] leading-[1.6] text-[#333] bg-white border border-[#b8860b]/50 p-2 outline-none focus:border-[#b8860b] resize-none max-h-[300px] overflow-y-auto"
                                  rows={Math.min(10, Math.max(2, editingTurnTextValue.split("\n").length))}
                                />
                                <div className="text-[10px] text-[#bbb] mt-1">Cmd+Enter to save, Escape to cancel</div>
                              </div>
                            ) : (
                              <div className="relative group/text">
                                <p className={`text-[14px] leading-[1.6] ${
                                  !isExpanded && isHost ? 'text-[#555] italic' : 'text-[#333]'
                                }`}>
                                  {isExpanded || isTurnHit
                                    ? highlightText(turn.text, debouncedQuery)
                                    : summary
                                    ? summary
                                    : hasMore
                                    ? highlightText(first, debouncedQuery)
                                    : highlightText(turn.text, debouncedQuery)
                                  }
                                  {canCollapse && !isTurnHit && (
                                    <button
                                      onClick={() => toggleTurnExpanded(turn.turn_index)}
                                      className="ml-1 text-[12px] text-[#b8860b] hover:underline transition-colors"
                                      title={isExpanded ? (summary ? "Show summary" : "Show less") : "Show full text"}
                                    >
                                      {isExpanded ? "[less]" : "[more]"}
                                    </button>
                                  )}
                                </p>
                                <button
                                  onClick={() => startEditingTurnText(turn.turn_index, turn.text)}
                                  className="absolute top-0 right-0 p-1 text-[#ccc] hover:text-[#888] opacity-0 group-hover/text:opacity-100 transition-opacity"
                                  title="Edit text"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                              </div>
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
    </div>
  );
}
