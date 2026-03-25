import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAppearanceById } from "@lib/db/queries";
import { formatDate } from "@lib/utils/format-date";
import { formatDuration } from "@lib/utils/format-duration";
import type { AppearanceRow } from "@lib/db/types";
import { isYouTubeSource } from "@/types/appearance";
import type { SpeakerRole } from "@/types/appearance";
import type { TranscriptViewerProps } from "./types";
import { TranscriptViewer } from "./TranscriptViewer";

// React cache() deduplicates across generateMetadata + page component in the same request
const getCachedAppearance = cache(getAppearanceById);

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1);
    }
  } catch {
    // not a valid URL
  }
  return null;
}

function transformAppearance(row: AppearanceRow): TranscriptViewerProps["appearance"] {
  // Build speaker role map
  const speakerRoleMap = new Map<string, SpeakerRole>();
  for (const s of row.speakers) {
    speakerRoleMap.set(s.name, s.role);
  }

  // Build key_people lookup for title/affiliation enrichment
  const keyPeopleMap = new Map<string, { title?: string; affiliation?: string }>();
  for (const p of row.entity_tags.key_people ?? []) {
    keyPeopleMap.set(p.name.toLowerCase(), {
      title: p.title || undefined,
      affiliation: p.fund_affiliation || undefined,
    });
  }

  // Enrich speakers with title/affiliation: prefer speaker-level fields, fall back to entity_tags
  const speakers = row.speakers.map((s) => {
    const kp = keyPeopleMap.get(s.name.toLowerCase());
    return {
      name: s.name,
      role: s.role,
      title: s.title ?? kp?.title,
      affiliation: s.affiliation ?? kp?.affiliation,
    };
  });

  // Map turns with role from speakers
  const turns = (row.turns ?? []).map((t) => {
    let role: SpeakerRole = speakerRoleMap.get(t.speaker) ?? "guest";
    if (!speakerRoleMap.has(t.speaker)) {
      console.warn(
        `[transcript/${row.id}] Speaker "${t.speaker}" not found in speakers list, defaulting to "guest"`
      );
    }
    return {
      speaker: t.speaker,
      role,
      text: t.text,
      turn_index: t.turn_index,
      section_anchor: t.section_anchor,
      corrected: t.corrected,
      timestamp_seconds: t.timestamp_seconds,
      attribution: t.attribution,
    };
  });

  // Map prep bullets
  const prepBullets = (row.prep_bullets.bullets ?? []).map((b) => ({
    text: b.text,
    supporting_quotes: b.supporting_quotes.map((sq) => ({
      quote: sq.quote,
      speaker: sq.speaker ?? "",
      section_anchor: sq.section_anchor,
    })),
  }));

  // Extract youtube_id if source is YouTube
  const youtubeId =
    isYouTubeSource(row.transcript_source)
      ? extractYoutubeId(row.source_url)
      : null;

  return {
    id: row.id,
    title: row.title ?? "Untitled",
    date: formatDate(row.appearance_date),
    source_name: row.source_name ?? "",
    youtube_id: youtubeId,
    speakers,
    sections: row.sections.map((s) => ({
      heading: s.heading,
      anchor: s.anchor,
      turn_index: s.turn_index,
      start_time: s.start_time,
      source: s.source,
    })),
    turns,
    has_inferred_attribution: turns.some((t) => t.attribution === "inferred"),
    turn_summaries: row.turn_summaries
      ? Object.fromEntries(row.turn_summaries.map((s) => [s.turn_index, s.summary]))
      : null,
    prep_bullets: prepBullets,
    bullets_generated_at: row.bullets_generated_at,
    transcript_char_count: row.cleaned_transcript?.length ?? 0,
    default_view_params: row.default_view_params ?? null,
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ expanded?: string; hidden?: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { expanded, hidden } = await searchParams;
  const row = await getCachedAppearance(id);

  if (!row || row.processing_status !== "complete") {
    return { title: "Meeting Prep Tool" };
  }

  const title = row.title ?? "Untitled";

  // Priority: URL params > saved default view > none
  const savedParams = row.default_view_params ? new URLSearchParams(row.default_view_params) : null;
  const effectiveExpanded = expanded ?? savedParams?.get("expanded") ?? undefined;
  const effectiveHidden = hidden ?? savedParams?.get("hidden") ?? undefined;

  // Parse hidden turn indices (if any)
  const hiddenSet = effectiveHidden != null && effectiveHidden !== ""
    ? new Set(effectiveHidden.split(",").map(Number).filter(n => !isNaN(n)))
    : new Set<number>();

  let description: string;
  if (effectiveExpanded != null) {
    // Highlight mode — find first guest/customer turn from expanded indices (excluding hidden)
    const indices = effectiveExpanded === ""
      ? new Set<number>()
      : new Set(effectiveExpanded.split(",").map(Number).filter(n => !isNaN(n)));
    const speakerRoleMap = new Map<string, string>();
    for (const s of row.speakers) speakerRoleMap.set(s.name, s.role);
    // Filter out hidden turns from expanded set
    const expandedTurns = (row.turns ?? []).filter(t => indices.has(t.turn_index) && !hiddenSet.has(t.turn_index));
    const quoteTurn = expandedTurns.find(t => {
      const role = speakerRoleMap.get(t.speaker) ?? "guest";
      return role === "guest" || role === "customer";
    });
    const quoteText = quoteTurn
      ? `"${quoteTurn.text.slice(0, 150)}${quoteTurn.text.length > 150 ? "…" : ""}"`
      : "";
    // Count only non-hidden expanded turns
    const count = expandedTurns.length;
    // Compute highlight duration from turn timestamps (excluding hidden)
    const allTurns = row.turns ?? [];
    const sortedExpanded = expandedTurns
      .filter(t => t.timestamp_seconds != null)
      .sort((a, b) => a.timestamp_seconds! - b.timestamp_seconds!);
    let highlightSec = 0;
    for (const turn of sortedExpanded) {
      const nextTurn = allTurns.find(t =>
        t.timestamp_seconds != null && t.timestamp_seconds! > turn.timestamp_seconds!
      );
      if (nextTurn) highlightSec += nextTurn.timestamp_seconds! - turn.timestamp_seconds!;
    }
    const timestamped = allTurns.filter(t => t.timestamp_seconds != null).map(t => t.timestamp_seconds!);
    const lastTs = timestamped.length > 0 ? Math.max(...timestamped) : 0;
    const fullSec = lastTs > 0 ? lastTs + 120 : 0;
    // OG duration assumes 1.5x default playback speed
    const OG_PLAYBACK_RATE = 1.5;
    const effectiveHighlight = highlightSec / OG_PLAYBACK_RATE;
    const durationSuffix = highlightSec > 0
      ? ` · ~${formatDuration(effectiveHighlight)} highlight${fullSec > 0 ? ` from ${formatDuration(fullSec)} call` : ''}`
      : '';
    description = quoteText
      ? `${quoteText} — ${count} highlighted moment${count !== 1 ? "s" : ""}${durationSuffix}`
      : `${count} highlighted moment${count !== 1 ? "s" : ""}${durationSuffix}`;
  } else {
    // Default mode — list speakers + turn count
    const names = row.speakers.map(s => s.name).join(", ");
    const turnCount = (row.turns ?? []).length;
    description = names
      ? `${names} · ${turnCount} turns`
      : `${turnCount} turns`;
  }

  const youtubeId =
    isYouTubeSource(row.transcript_source)
      ? extractYoutubeId(row.source_url)
      : null;

  return {
    title,
    openGraph: {
      title,
      description,
      type: "article",
      siteName: "bz-bot 🤖",
      images: youtubeId
        ? [`https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`]
        : undefined,
    },
    twitter: {
      card: youtubeId ? "summary_large_image" : "summary",
    },
  };
}

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getCachedAppearance(id);

  if (!row) {
    notFound();
  }

  // Processing states
  if (
    row.processing_status === "queued" ||
    row.processing_status === "extracting" ||
    row.processing_status === "cleaning" ||
    row.processing_status === "analyzing"
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f9f8f5]">
        <div className="text-center font-[family-name:var(--font-source-sans)]">
          <div className="mb-4 text-4xl">⏳</div>
          <h1 className="mb-2 text-lg font-semibold text-[#1a1a1a]">
            Processing transcript…
          </h1>
          <p className="text-sm text-[#888]">
            Currently{" "}
            <span className="font-medium text-[#c9a84c]">
              {row.processing_status}
            </span>
          </p>
          <p className="mt-4 text-xs text-[#bbb]">
            Refresh this page to check for updates.
          </p>
        </div>
      </div>
    );
  }

  if (row.processing_status === "failed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f9f8f5]">
        <div className="max-w-md text-center font-[family-name:var(--font-source-sans)]">
          <div className="mb-4 text-4xl">⚠️</div>
          <h1 className="mb-2 text-lg font-semibold text-[#1a1a1a]">
            Processing failed
          </h1>
          {row.processing_error && (
            <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-left text-xs text-red-700">
              {row.processing_error}
            </p>
          )}
          <a
            href="/"
            className="text-sm text-[#c9a84c] underline hover:text-[#b8922a]"
          >
            ← Back to admin
          </a>
        </div>
      </div>
    );
  }

  const appearance = transformAppearance(row);

  return <TranscriptViewer appearance={appearance} />;
}
