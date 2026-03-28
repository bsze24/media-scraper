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

function durationOfSegments(
  passages: Passage[],
  segments: CaptionSegment[]
): { min: number; max: number; avg: number; median: number } {
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

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error(
      "Usage: npx tsx scripts/test-segmentation.ts <appearance-id>"
    );
    process.exit(1);
  }

  // 1. Fetch appearance
  console.log(`[segmentation-test] Fetching appearance ${id}...`);
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .select("id, title, speakers, scraper_metadata")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error(`[segmentation-test] Failed to fetch appearance:`, error);
    process.exit(1);
  }

  // 2. Validate inputs
  const segments: CaptionSegment[] | undefined =
    data.scraper_metadata?.segments;
  const speakers: Speaker[] = data.speakers ?? [];

  if (!segments || segments.length === 0) {
    console.error(
      `[segmentation-test] No segments found in scraper_metadata for "${data.title}". This appearance may not be a YouTube source.`
    );
    process.exit(1);
  }

  if (speakers.length === 0) {
    console.warn(
      `[segmentation-test] Warning: no speakers found — attribution will be limited.`
    );
  }

  console.log(
    `[segmentation-test] "${data.title}" — ${segments.length} segments, ${speakers.length} speakers`
  );

  // 3. Build prompt & call Anthropic
  const { system, user } = buildSegmentationPrompt(segments, speakers);
  console.log(
    `[segmentation-test] Calling Anthropic (Sonnet)... prompt: ${system.length + user.length} chars`
  );

  const anthropic = createAnthropicClient();
  const startTime = Date.now();

  const response = await anthropic.messages.create(
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 120_000 }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[segmentation-test] Response received in ${elapsed}s`);

  // 4. Extract text
  const rawText =
    response.content[0].type === "text" ? response.content[0].text : "";

  // 5. Write raw output
  const outputDir = join(__dirname, "output");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `segmentation-${id}.json`);
  writeFileSync(outputPath, rawText, "utf-8");
  console.log(`[segmentation-test] Raw output written to ${outputPath}`);

  // 6. Parse & validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch (e) {
    console.error(`[segmentation-test] Failed to parse JSON:`, e);
    console.error(`[segmentation-test] Raw output saved — inspect manually.`);
    process.exit(1);
  }

  const validation = SegmentationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    console.error(
      `[segmentation-test] Zod validation failed:`,
      validation.error.format()
    );
    console.error(`[segmentation-test] Raw output saved — inspect manually.`);
    process.exit(1);
  }

  const passages = validation.data;

  // 7. Analysis
  console.log(`\n=== Segmentation Results: ${data.title} ===\n`);
  console.log(`Segments: ${segments.length}`);
  console.log(`Passages: ${passages.length}`);

  // Speaker breakdown
  const speakerMap = new Map<
    string,
    { total: number; filler: number; context: number; insight: number }
  >();
  for (const p of passages) {
    const entry = speakerMap.get(p.speaker) ?? {
      total: 0,
      filler: 0,
      context: 0,
      insight: 0,
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
  const total = passages.length;

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
      const prev = overlapCount.get(i) ?? 0;
      overlapCount.set(i, prev + 1);
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
  const durations = durationOfSegments(passages, segments);

  sizes.sort((a, b) => a - b);
  const sizeMedian =
    sizes.length % 2 === 0
      ? (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2
      : sizes[Math.floor(sizes.length / 2)];
  const sizeAvg = sizes.reduce((a, b) => a + b, 0) / sizes.length;

  console.log(`\nPassage size distribution:`);
  console.log(
    `  Min: ${sizes[0]} segments (${durations.min.toFixed(1)}s)`
  );
  console.log(
    `  Max: ${sizes[sizes.length - 1]} segments (${durations.max.toFixed(1)}s)`
  );
  console.log(`  Avg: ${sizeAvg.toFixed(1)} segments (${durations.avg.toFixed(1)}s)`);
  console.log(
    `  Median: ${sizeMedian} segments (${durations.median.toFixed(1)}s)`
  );

  // Warnings
  const warnings: string[] = [];

  const tooManyTags = passages.filter((p) => p.topic_tags.length >= 4);
  if (tooManyTags.length > 0) {
    warnings.push(
      `${tooManyTags.length} passage(s) have 4+ topic tags (may be too coarse)`
    );
  }

  const tooLong = passages.filter(
    (p) => p.end_segment - p.start_segment + 1 > 30
  );
  if (tooLong.length > 0) {
    for (const p of tooLong) {
      warnings.push(
        `1 passage spans ${p.end_segment - p.start_segment + 1} segments (>30 is unusually long)`
      );
    }
  }

  const unknownCount = passages.filter(
    (p) => p.speaker === "Unknown Speaker"
  ).length;
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

main();
