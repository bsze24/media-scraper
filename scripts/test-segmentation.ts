import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "../lib/db/client";
import { createAnthropicClient } from "../lib/anthropic/client";
import { buildSegmentationPrompt } from "../lib/prompts/segmentation";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CaptionSegment } from "../lib/scrapers/youtube";
import type { Speaker } from "../src/types/appearance";

// ── Zod schema ────────────────────────────────────────────────────────────

const PassageSchema = z.object({
  speaker: z.string(),
  start_segment: z.number().int().min(0),
  end_segment: z.number().int().min(0),
  topic_tags: z.array(z.string()).min(1).max(5),
  signal_score: z.enum(["filler", "context", "insight"]),
});

const SegmentationOutputSchema = z.array(PassageSchema);

type Passage = z.infer<typeof PassageSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
}

function computeDurations(
  passages: Passage[],
  segments: CaptionSegment[]
): { min: number; max: number; avg: number; median: number } {
  if (passages.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0 };
  }

  const durations = passages.map((p) => {
    const startSec = segments[p.start_segment]?.start ?? 0;
    const endSeg = segments[p.end_segment];
    const endSec = endSeg ? endSeg.start + endSeg.duration : startSec;
    return endSec - startSec;
  });

  durations.sort((a, b) => a - b);

  const sum = durations.reduce((a, b) => a + b, 0);
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 0
      ? (durations[mid - 1] + durations[mid]) / 2
      : durations[mid];

  return {
    min: durations[0],
    max: durations[durations.length - 1],
    avg: sum / durations.length,
    median,
  };
}

interface AnalysisResult {
  title: string;
  segmentCount: number;
  passageCount: number;
  avgSize: number;
  maxSize: number;
  coveragePct: number;
  fillerPct: number;
  contextPct: number;
  insightPct: number;
  uniqueTags: number;
  elapsed: string;
  warnings: string[];
}

function analyzePassages(
  title: string,
  passages: Passage[],
  segments: CaptionSegment[],
  elapsed: string
): AnalysisResult {
  const total = passages.length;
  const sizes = passages.map((p) => p.end_segment - p.start_segment + 1);
  const maxSize = Math.max(...sizes);
  const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

  // Coverage
  const covered = new Set<number>();
  const overlapCount = new Map<number, number>();
  for (const p of passages) {
    for (let i = p.start_segment; i <= p.end_segment; i++) {
      overlapCount.set(i, (overlapCount.get(i) ?? 0) + 1);
      covered.add(i);
    }
  }
  const coveragePct = (covered.size / segments.length) * 100;

  // Signals
  const signals = { filler: 0, context: 0, insight: 0 };
  for (const p of passages) signals[p.signal_score]++;

  // Tags
  const tagSet = new Set<string>();
  for (const p of passages) {
    for (const tag of p.topic_tags) tagSet.add(tag);
  }

  // Warnings
  const warnings: string[] = [];

  const tooManyTags = passages.filter((p) => p.topic_tags.length >= 4);
  if (tooManyTags.length > 0) {
    warnings.push(`${tooManyTags.length} passage(s) have 4+ topic tags`);
  }

  const tooLong = passages.filter(
    (p) => p.end_segment - p.start_segment + 1 > 25
  );
  if (tooLong.length > 0) {
    warnings.push(`${tooLong.length} passage(s) > 25 segments`);
  }

  // Multi-segment overlaps (consecutive passages sharing 2+ segments)
  for (let i = 0; i < passages.length - 1; i++) {
    const curr = passages[i];
    const next = passages[i + 1];
    const overlapSize = curr.end_segment - next.start_segment + 1;
    if (overlapSize > 1) {
      warnings.push(
        `Passages ${i}→${i + 1} overlap by ${overlapSize} segments (S${next.start_segment}–S${curr.end_segment})`
      );
    }
  }

  const structuralTags = ["introduction", "closing", "wrap-up", "meeting logistics", "next steps"];
  const foundStructural = new Set<string>();
  for (const p of passages) {
    for (const tag of p.topic_tags) {
      if (structuralTags.includes(tag)) foundStructural.add(tag);
    }
  }
  if (foundStructural.size > 0) {
    warnings.push(`Structural tags used: ${[...foundStructural].join(", ")}`);
  }

  const unknownCount = passages.filter((p) => p.speaker === "Unknown Speaker").length;
  if (unknownCount > 0) {
    warnings.push(`"Unknown Speaker" used ${unknownCount} times`);
  }

  const missing = segments.length - covered.size;
  if (missing > 0) {
    warnings.push(`${missing} segments not covered`);
  }

  return {
    title,
    segmentCount: segments.length,
    passageCount: total,
    avgSize: parseFloat(avgSize.toFixed(1)),
    maxSize,
    coveragePct: parseFloat(coveragePct.toFixed(1)),
    fillerPct: parseFloat(((signals.filler / total) * 100).toFixed(0)),
    contextPct: parseFloat(((signals.context / total) * 100).toFixed(0)),
    insightPct: parseFloat(((signals.insight / total) * 100).toFixed(0)),
    uniqueTags: tagSet.size,
    elapsed,
    warnings,
  };
}

function printDetailedAnalysis(
  title: string,
  passages: Passage[],
  segments: CaptionSegment[]
): void {
  const total = passages.length;

  console.log(`\n=== Segmentation Results: ${title} ===\n`);
  console.log(`Segments: ${segments.length}`);
  console.log(`Passages: ${total}`);

  // Speaker breakdown
  const speakerMap = new Map<
    string,
    { total: number; filler: number; context: number; insight: number }
  >();
  for (const p of passages) {
    const entry = speakerMap.get(p.speaker) ?? {
      total: 0, filler: 0, context: 0, insight: 0,
    };
    entry.total++;
    entry[p.signal_score]++;
    speakerMap.set(p.speaker, entry);
  }

  console.log(`\nSpeaker breakdown:`);
  for (const [name, counts] of speakerMap) {
    console.log(
      `  ${name}: ${counts.total} passages (${counts.filler} filler, ${counts.context} context, ${counts.insight} insight)`
    );
  }

  // Signal distribution
  const signals = { filler: 0, context: 0, insight: 0 };
  for (const p of passages) signals[p.signal_score]++;

  console.log(`\nSignal distribution:`);
  for (const [score, count] of Object.entries(signals)) {
    const pct = ((count / total) * 100).toFixed(0);
    console.log(`  ${score}: ${count} (${pct}%)`);
  }

  // Coverage check
  const covered = new Set<number>();
  const overlapCount = new Map<number, number>();

  for (const p of passages) {
    for (let i = p.start_segment; i <= p.end_segment; i++) {
      overlapCount.set(i, (overlapCount.get(i) ?? 0) + 1);
      covered.add(i);
    }
  }

  const missing: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (!covered.has(i)) missing.push(i);
  }

  const overlaps: number[] = [];
  for (const [idx, count] of overlapCount) {
    if (count > 1) overlaps.push(idx);
  }
  overlaps.sort((a, b) => a - b);

  const coveragePct = ((covered.size / segments.length) * 100).toFixed(1);

  console.log(`\nCoverage check:`);
  console.log(`  Segments covered: ${covered.size}/${segments.length} (${coveragePct}%)`);
  if (missing.length === 0) {
    console.log(`  Missing segments: None — 100% coverage`);
  } else {
    const missingStr = missing.slice(0, 20).map((i) => `S${i}`).join(", ");
    console.log(
      `  Missing segments: [${missingStr}]${missing.length > 20 ? ` ... and ${missing.length - 20} more` : ""}`
    );
  }
  if (overlaps.length > 0) {
    const overlapStr = overlaps.slice(0, 20).map((i) => `S${i}`).join(", ");
    console.log(
      `  Overlap segments: [${overlapStr}]${overlaps.length > 20 ? ` ... and ${overlaps.length - 20} more` : ""}`
    );
  } else {
    console.log(`  Overlap segments: None`);
  }

  // Topic tags
  const tagCounts = new Map<string, number>();
  for (const p of passages) {
    for (const tag of p.topic_tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nTopic tags (unique): ${tagCounts.size}`);
  for (const [tag, count] of sortedTags) {
    console.log(`  ${tag} (${count} passages)`);
  }

  // Passage size distribution
  const sizes = passages.map((p) => p.end_segment - p.start_segment + 1);
  const durations = computeDurations(passages, segments);

  sizes.sort((a, b) => a - b);
  const sizeMedian =
    sizes.length % 2 === 0
      ? (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2
      : sizes[Math.floor(sizes.length / 2)];
  const sizeAvg = sizes.reduce((a, b) => a + b, 0) / sizes.length;

  console.log(`\nPassage size distribution:`);
  console.log(`  Min: ${sizes[0]} segments (${durations.min.toFixed(1)}s)`);
  console.log(`  Max: ${sizes[sizes.length - 1]} segments (${durations.max.toFixed(1)}s)`);
  console.log(`  Avg: ${sizeAvg.toFixed(1)} segments (${durations.avg.toFixed(1)}s)`);
  console.log(`  Median: ${sizeMedian} segments (${durations.median.toFixed(1)}s)`);

  // Warnings
  const warnings: string[] = [];

  const tooManyTags = passages.filter((p) => p.topic_tags.length >= 4);
  if (tooManyTags.length > 0) {
    warnings.push(`${tooManyTags.length} passage(s) have 4+ topic tags (may be too coarse)`);
  }

  const tooLong = passages.filter((p) => p.end_segment - p.start_segment + 1 > 25);
  for (const p of tooLong) {
    warnings.push(
      `1 passage spans ${p.end_segment - p.start_segment + 1} segments (>25 is unusually long)`
    );
  }

  // Multi-segment overlaps
  for (let i = 0; i < passages.length - 1; i++) {
    const curr = passages[i];
    const next = passages[i + 1];
    const overlapSize = curr.end_segment - next.start_segment + 1;
    if (overlapSize > 1) {
      warnings.push(
        `Passages ${i}→${i + 1} overlap by ${overlapSize} segments (S${next.start_segment}–S${curr.end_segment})`
      );
    }
  }

  const structuralTags = ["introduction", "closing", "wrap-up", "meeting logistics", "next steps"];
  const foundStructural = new Set<string>();
  for (const p of passages) {
    for (const tag of p.topic_tags) {
      if (structuralTags.includes(tag)) foundStructural.add(tag);
    }
  }
  if (foundStructural.size > 0) {
    warnings.push(`Structural tags used: ${[...foundStructural].join(", ")}`);
  }

  const unknownCount = passages.filter((p) => p.speaker === "Unknown Speaker").length;
  if (unknownCount > 0) {
    warnings.push(`Speaker "Unknown Speaker" used ${unknownCount} times`);
  }

  if (missing.length > 0) {
    warnings.push(`${missing.length} segments not covered by any passage`);
  }

  if (warnings.length > 0) {
    console.log(`\nWarnings:`);
    for (const w of warnings) {
      console.log(`  - ${w}`);
    }
  } else {
    console.log(`\nNo warnings.`);
  }
}

// ── List mode ─────────────────────────────────────────────────────────────

async function listAppearances(): Promise<void> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .select("id, title, speakers, scraper_metadata, transcript_source")
    .not("scraper_metadata", "is", null)
    .order("title");

  if (error || !data) {
    console.error("[segmentation-test] Failed to list appearances:", error);
    process.exit(1);
  }

  // Filter to YouTube sources with segments
  const youtube = data.filter(
    (d) =>
      (d.transcript_source as string)?.startsWith("youtube") &&
      Array.isArray(d.scraper_metadata?.segments) &&
      d.scraper_metadata.segments.length > 0
  );

  if (youtube.length === 0) {
    console.log("No YouTube appearances with caption segments found.");
    return;
  }

  console.log("YouTube appearances with caption segments:\n");

  const idW = 38;
  const titleW = 40;
  const segW = 10;
  const spkW = 10;

  console.log(
    `${"ID".padEnd(idW)}| ${"Title".padEnd(titleW)}| ${"Segments".padStart(segW)} | ${"Speakers".padStart(spkW)}`
  );
  console.log(`${"-".repeat(idW)}|${"-".repeat(titleW + 1)}|${"-".repeat(segW + 2)}|${"-".repeat(spkW + 1)}`);

  for (const row of youtube) {
    const segCount = row.scraper_metadata.segments.length;
    const spkCount = Array.isArray(row.speakers) ? row.speakers.length : 0;
    const rawTitle = row.title ?? "Untitled";
    const title = rawTitle.length > titleW - 1 ? rawTitle.slice(0, titleW - 4) + "..." : rawTitle;
    console.log(
      `${row.id.padEnd(idW)}| ${title.padEnd(titleW)}| ${String(segCount).padStart(segW)} | ${String(spkCount).padStart(spkW)}`
    );
  }

  console.log(`\n${youtube.length} appearances total`);
}

// ── Single appearance run ─────────────────────────────────────────────────

async function runSegmentation(
  id: string,
  supabase: ReturnType<typeof createServerClient>,
  anthropic: ReturnType<typeof createAnthropicClient>
): Promise<{ passages: Passage[]; segments: CaptionSegment[]; analysis: AnalysisResult } | null> {
  // Fetch
  console.log(`\n[segmentation-test] Fetching appearance ${id}...`);
  const { data, error } = await supabase
    .from("appearances")
    .select("id, title, speakers, scraper_metadata")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error(`[segmentation-test] Failed to fetch ${id}:`, error);
    return null;
  }

  const segments: CaptionSegment[] | undefined = data.scraper_metadata?.segments;
  const speakers: Speaker[] = data.speakers ?? [];

  if (!segments || segments.length === 0) {
    console.error(
      `[segmentation-test] No segments for "${data.title}" — skipping.`
    );
    return null;
  }

  if (speakers.length === 0) {
    console.warn(`[segmentation-test] Warning: no speakers for "${data.title}".`);
  }

  console.log(
    `[segmentation-test] "${data.title}" — ${segments.length} segments, ${speakers.length} speakers`
  );

  // Build prompt & call
  const { system, user } = buildSegmentationPrompt(segments, speakers);
  console.log(
    `[segmentation-test] Calling Anthropic (Sonnet)... prompt: ${system.length + user.length} chars`
  );

  const startTime = Date.now();

  let response;
  try {
    response = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
      },
      { timeout: 120_000 }
    );
  } catch (e) {
    console.error(`[segmentation-test] API call failed for "${data.title}":`, e);
    return null;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[segmentation-test] Response received in ${elapsed}s`);

  // Extract & write
  const rawText = response.content[0].type === "text" ? response.content[0].text : "";

  const outputDir = join(__dirname, "output");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `segmentation-${id}.json`);
  writeFileSync(outputPath, rawText, "utf-8");
  console.log(`[segmentation-test] Raw output written to ${outputPath}`);

  // Parse & validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch (e) {
    console.error(`[segmentation-test] JSON parse failed for "${data.title}":`, e);
    return null;
  }

  const validation = SegmentationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    console.error(
      `[segmentation-test] Zod validation failed for "${data.title}":`,
      validation.error.format()
    );
    return null;
  }

  const passages = validation.data;

  // Print detailed analysis
  printDetailedAnalysis(data.title, passages, segments);

  const analysis = analyzePassages(data.title, passages, segments, elapsed);

  return { passages, segments, analysis };
}

// ── Cross-appearance comparison ───────────────────────────────────────────

function printComparison(results: AnalysisResult[]): void {
  console.log(`\n\n=== Cross-Appearance Comparison ===\n`);

  const nameW = 40;
  const cols = ["Segs", "Passages", "Avg Size", "Max Size", "Coverage", "Filler", "Context", "Insight", "Tags", "Time"];
  const colW = [6, 10, 10, 10, 10, 8, 9, 9, 6, 8];

  // Header
  let header = "Appearance".padEnd(nameW) + "| ";
  header += cols.map((c, i) => c.padStart(colW[i])).join(" | ");
  console.log(header);
  console.log("-".repeat(nameW) + "|" + "-".repeat(header.length - nameW));

  for (const r of results) {
    const title = r.title.length > nameW - 1 ? r.title.slice(0, nameW - 4) + "..." : r.title;
    const vals = [
      String(r.segmentCount).padStart(colW[0]),
      String(r.passageCount).padStart(colW[1]),
      r.avgSize.toFixed(1).padStart(colW[2]),
      String(r.maxSize).padStart(colW[3]),
      `${r.coveragePct.toFixed(1)}%`.padStart(colW[4]),
      `${r.fillerPct}%`.padStart(colW[5]),
      `${r.contextPct}%`.padStart(colW[6]),
      `${r.insightPct}%`.padStart(colW[7]),
      String(r.uniqueTags).padStart(colW[8]),
      `${r.elapsed}s`.padStart(colW[9]),
    ];
    console.log(`${title.padEnd(nameW)}| ${vals.join(" | ")}`);
  }

  // Aggregate warnings
  const allWarnings: string[] = [];
  for (const r of results) {
    if (r.warnings.length > 0) {
      allWarnings.push(`  ${r.title}: ${r.warnings.join("; ")}`);
    }
  }

  if (allWarnings.length > 0) {
    console.log(`\nWarnings:`);
    for (const w of allWarnings) {
      console.log(w);
    }
  } else {
    console.log(`\nNo warnings across any appearance.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage:\n  npx tsx scripts/test-segmentation.ts --list\n  npx tsx scripts/test-segmentation.ts <id> [id2] [id3] ..."
    );
    process.exit(1);
  }

  if (args[0] === "--list") {
    await listAppearances();
    return;
  }

  const supabase = createServerClient();
  const anthropic = createAnthropicClient();
  const results: AnalysisResult[] = [];

  for (const id of args) {
    try {
      const result = await runSegmentation(id, supabase, anthropic);
      if (result) {
        results.push(result.analysis);
      }
    } catch (e) {
      console.error(`[segmentation-test] Unexpected error for ${id}:`, e);
    }
  }

  if (results.length >= 2) {
    printComparison(results);
  }
}

main();
