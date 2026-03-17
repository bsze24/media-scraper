import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Scraper, ScraperResult, SectionHeading } from "@/types/scraper";
import type { Speaker, SpeakerRole } from "@/types/appearance";

// ── Types ──────────────────────────────────────────────────────────────────

interface YtDlpMetadata {
  title: string;
  upload_date: string; // YYYYMMDD
  channel: string;
  description: string;
  duration: number;
  chapters: { title: string; start_time: number; end_time: number }[] | null;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

export interface CaptionSegment {
  text: string;
  start: number; // seconds
  duration: number; // seconds
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the video ID from a YouTube URL.
 */
export function extractVideoId(url: string): string {
  const parsed = new URL(url);

  // youtube.com/watch?v=ID (including m.youtube.com)
  if (
    (parsed.hostname === "www.youtube.com" ||
     parsed.hostname === "youtube.com" ||
     parsed.hostname === "m.youtube.com") &&
    parsed.searchParams.has("v")
  ) {
    return parsed.searchParams.get("v")!;
  }

  // youtu.be/ID
  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.slice(1);
  }

  // youtube.com/embed/ID or youtube.com/v/ID
  const embedMatch = parsed.pathname.match(/^\/(?:embed|v)\/([^/?]+)/);
  if (embedMatch) return embedMatch[1];

  throw new Error(`Cannot extract YouTube video ID from: ${url}`);
}

/**
 * Run yt-dlp as a subprocess and return stdout.
 */
function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", args, { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`yt-dlp failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Fetch video metadata via yt-dlp --dump-json.
 */
async function fetchMetadata(url: string): Promise<YtDlpMetadata> {
  console.log("[youtube] fetching metadata via yt-dlp");
  const stdout = await runYtDlp(["--dump-json", "--skip-download", url]);
  return JSON.parse(stdout);
}

/**
 * Download captions as json3 via yt-dlp and parse into segments.
 */
async function fetchCaptions(url: string): Promise<CaptionSegment[]> {
  const tmpBase = join(tmpdir(), `yt-caps-${randomUUID()}`);
  const expectedFile = `${tmpBase}.en.json3`;

  console.log("[youtube] downloading captions via yt-dlp");
  try {
    await runYtDlp([
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang", "en",
      "--sub-format", "json3",
      "--skip-download",
      "-o", tmpBase,
      url,
    ]);

    const raw = await readFile(expectedFile, "utf-8");
    const data: { events: Json3Event[] } = JSON.parse(raw);
    return parseJson3Events(data.events);
  } finally {
    // Clean up temp file
    try { await unlink(expectedFile); } catch { /* ignore */ }
  }
}

/**
 * Parse json3 events into cleaner CaptionSegment objects.
 * Filters out empty segments and music/sound effect markers.
 */
export function parseJson3Events(events: Json3Event[]): CaptionSegment[] {
  const segments: CaptionSegment[] = [];

  for (const event of events) {
    const segs = event.segs ?? [];
    const text = segs.map((s) => s.utf8 ?? "").join("").trim();
    if (!text) continue;
    // Skip pure music/sound markers
    if (/^\[.*\]$/.test(text)) continue;

    segments.push({
      text,
      start: (event.tStartMs ?? 0) / 1000,
      duration: (event.dDurationMs ?? 0) / 1000,
    });
  }

  return segments;
}

/**
 * Convert seconds to MM:SS display format.
 */
export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Build a readable raw transcript from caption segments.
 *
 * Groups segments into paragraphs at natural breaks (pauses > 2s or
 * speaker change markers ">>"). Prefixes each paragraph with [MM:SS].
 */
export function buildRawTranscript(segments: CaptionSegment[]): string {
  if (segments.length === 0) return "";

  const paragraphs: { timestamp: number; lines: string[] }[] = [];
  let current: { timestamp: number; lines: string[] } = {
    timestamp: segments[0].start,
    lines: [],
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = seg.text;

    // Start a new paragraph on speaker change marker ">>"
    if (text.startsWith(">>") && current.lines.length > 0) {
      paragraphs.push(current);
      current = { timestamp: seg.start, lines: [] };
    }

    // Start a new paragraph on long pause (> 2s gap)
    if (i > 0) {
      const prevEnd = segments[i - 1].start + segments[i - 1].duration;
      const gap = seg.start - prevEnd;
      if (gap > 2 && current.lines.length > 0) {
        paragraphs.push(current);
        current = { timestamp: seg.start, lines: [] };
      }
    }

    current.lines.push(text);
  }

  if (current.lines.length > 0) {
    paragraphs.push(current);
  }

  return paragraphs
    .map((p) => `[${formatTimestamp(p.timestamp)}] ${p.lines.join(" ")}`)
    .join("\n\n");
}

/**
 * Best-effort speaker extraction from video title/description/channel.
 */
export function extractSpeakers(
  title: string,
  description: string,
  channel: string
): Speaker[] {
  const speakers: Speaker[] = [];

  // Known podcast hosts by channel name
  const knownHosts: Record<string, { name: string; affiliation: string }> = {
    "Capital Allocators with Ted Seides": { name: "Ted Seides", affiliation: "Capital Allocators" },
    "Invest Like the Best with Patrick O'Shaughnessy": { name: "Patrick O'Shaughnessy", affiliation: "Colossus" },
    "The Acquired Podcast": { name: "Ben Gilbert", affiliation: "Acquired" },
  };

  const hostInfo = knownHosts[channel];
  if (hostInfo) {
    speakers.push({
      name: hostInfo.name,
      role: "host" as SpeakerRole,
      affiliation: hostInfo.affiliation,
    });
  }

  // Try to extract guest name from title patterns:
  // "Guest Name - Topic (EP.123)"
  // "Guest Name: Topic"
  // "Topic with Guest Name"
  const titlePatterns = [
    /^([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\s*[-–—:]/,  // "Name Name - ..."
    /\bwith\s+([A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/i,    // "... with Name Name"
  ];

  for (const pattern of titlePatterns) {
    const match = title.match(pattern);
    if (match) {
      const guestName = match[1].trim();
      // Don't add if same as host
      if (!speakers.some((s) => s.name === guestName)) {
        // Try to extract affiliation from description
        const affiliation = extractAffiliation(guestName, description);
        speakers.push({
          name: guestName,
          role: "guest" as SpeakerRole,
          ...(affiliation ? { affiliation } : {}),
        });
      }
      break;
    }
  }

  return speakers;
}

/**
 * Try to find a guest's affiliation from the video description.
 * Looks for patterns like "Name, Title at Company" or "Name from Company"
 * or "Name ... joined the Org".
 */
function extractAffiliation(name: string, description: string): string | null {
  const escaped = escapeRegex(name);
  const patterns = [
    // "Name ... joined the Company" / "Name ... joined Company"
    new RegExp(`${escaped}[^.]{0,80}?joined\\s+(?:the\\s+)?([A-Z][\\w\\s']+?)(?:[.,;\\n]|\\s+(?:upon|in|after|where))`, "i"),
    // "Name, Title at Company" / "Name at Company"
    new RegExp(`${escaped}[^.]*?(?:,\\s*\\w+\\s+)?(?:at|from)\\s+([A-Z][\\w\\s']+?)(?:[.,;\\n]|\\s+(?:for|since|who|where|and))`, "i"),
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert yt-dlp upload_date (YYYYMMDD) to ISO date string (YYYY-MM-DD).
 */
function parseUploadDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Convert a string to a URL-friendly slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Map yt-dlp chapters to SectionHeading objects.
 */
function chaptersToSections(
  chapters: YtDlpMetadata["chapters"]
): SectionHeading[] {
  if (!chapters || chapters.length === 0) return [];
  return chapters.map((ch) => ({
    heading: ch.title,
    anchor: slugify(ch.title),
    start_time: ch.start_time,
    source: "source" as const,
  }));
}

// ── Scraper ────────────────────────────────────────────────────────────────

export const youtubeScraper: Scraper = {
  canHandle(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname === "www.youtube.com" ||
        parsed.hostname === "youtube.com" ||
        parsed.hostname === "youtu.be" ||
        parsed.hostname === "m.youtube.com"
      );
    } catch {
      return false;
    }
  },

  async extract(url: string): Promise<ScraperResult> {
    const videoId = extractVideoId(url);
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`[youtube] starting extraction for ${videoId}`);

    // Fetch metadata and captions in parallel
    const [metadata, captionSegments] = await Promise.all([
      fetchMetadata(canonicalUrl),
      fetchCaptions(canonicalUrl),
    ]);

    console.log(
      `[youtube] metadata: "${metadata.title}", ${metadata.duration}s, ${captionSegments.length} caption segments`
    );

    if (captionSegments.length === 0) {
      throw new Error(
        `No English captions found for YouTube video ${videoId}. The video may not have captions enabled.`
      );
    }

    const rawTranscript = buildRawTranscript(captionSegments);
    const speakers = extractSpeakers(metadata.title, metadata.description, metadata.channel);

    console.log(
      `[youtube] complete, transcript: ${rawTranscript.length} chars, ${speakers.length} speakers detected`
    );

    const sections = chaptersToSections(metadata.chapters);

    return {
      title: metadata.title,
      appearanceDate: parseUploadDate(metadata.upload_date),
      sourceName: metadata.channel,
      transcriptSource: "youtube_captions",
      speakers,
      rawTranscript,
      captionData: {
        segments: captionSegments,
        description: metadata.description,
        duration: metadata.duration,
      },
      sections,
      sourceUrl: canonicalUrl,
    };
  },
};
