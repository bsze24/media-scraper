import { notFound } from "next/navigation";
import { getAppearanceById } from "@lib/db/queries";
import { formatDate } from "@lib/utils/format-date";
import type { AppearanceRow } from "@lib/db/types";
import type { TranscriptViewerProps } from "./types";
import { TranscriptViewer } from "./TranscriptViewer";

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
  const speakerRoleMap = new Map<string, "guest" | "host">();
  for (const s of row.speakers) {
    speakerRoleMap.set(s.name, s.role === "host" ? "host" : "guest");
  }

  // Build key_people lookup for title/affiliation enrichment
  const keyPeopleMap = new Map<string, { title?: string; affiliation?: string }>();
  for (const p of row.entity_tags.key_people ?? []) {
    keyPeopleMap.set(p.name.toLowerCase(), {
      title: p.title || undefined,
      affiliation: p.fund_affiliation || undefined,
    });
  }

  // Enrich speakers with title/affiliation from entity_tags
  const speakers = row.speakers.map((s) => {
    const kp = keyPeopleMap.get(s.name.toLowerCase());
    return {
      name: s.name,
      role: (s.role === "host" ? "host" : "guest") as "guest" | "host",
      title: kp?.title,
      affiliation: s.affiliation ?? kp?.affiliation,
    };
  });

  // Map turns with role from speakers
  const turns = (row.turns ?? []).map((t) => {
    let role = speakerRoleMap.get(t.speaker);
    if (!role) {
      console.warn(
        `[transcript/${row.id}] Speaker "${t.speaker}" not found in speakers list, defaulting to "guest"`
      );
      role = "guest";
    }
    return {
      speaker: t.speaker,
      role,
      text: t.text,
      turn_index: t.turn_index,
      section_anchor: t.section_anchor,
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
    row.transcript_source === "youtube_captions" ||
    row.transcript_source === "youtube_whisper"
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
    })),
    turns,
    prep_bullets: prepBullets,
    bullets_generated_at: row.bullets_generated_at,
  };
}

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getAppearanceById(id);

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
