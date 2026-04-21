import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "../lib/db/client";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Turn, Speaker } from "../src/types/appearance";
import type { PrepBulletsData } from "../src/types/bullets";

// ── Types ─────────────────────────────────────────────────────────────────

interface AppearanceSnapshot {
  id: string;
  title: string | null;
  transcript_source: string;
  source_name: string | null;
  turn_count: number;
  speaker_names: string[];
  timestamp_coverage_pct: number;
  bullet_count: number;
  section_count: number;
  entity_fund_count: number;
  entity_people_count: number;
  turn_summary_count: number;
  first_turn_speaker: string | null;
  last_turn_speaker: string | null;
  cleaned_transcript_length: number;
  segment_count: number;
  passage_count: number;
  // Gap #1: turn content fingerprint
  turn_text_hash: string;
  // Gap #2: section anchor coverage on turns
  turns_with_section_anchor: number;
  // Gap #3: attribution distribution
  attribution_source: number;
  attribution_inferred: number;
  attribution_unset: number;
  // Gap #4: corrected turns
  corrected_turn_count: number;
  // Gap #5: bullet structure depth
  total_supporting_quotes: number;
  quotes_with_section_anchor: number;
  // Gap #6: speaker roles
  speaker_roles: Record<string, string>;
  // Gap #7: processing warnings
  processing_error: string | null;
  processing_detail: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function shortId(id: string): string {
  return id.slice(0, 8);
}

function truncate(s: string | null, maxLen: number): string {
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen - 3) + "..." : s;
}

function shortSource(source: string): string {
  const map: Record<string, string> = {
    youtube_captions: "yt_caps",
    youtube_whisper: "yt_whisper",
    colossus: "colossus",
    capital_allocators: "cap_alloc",
    acquired: "acquired",
    odd_lots: "odd_lots",
  };
  return map[source] ?? source;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createServerClient();

  console.log("[regression-snapshot] Fetching all complete appearances...");

  const { data, error } = await supabase
    .from("appearances")
    .select(
      "id, title, transcript_source, source_name, turns, speakers, sections, entity_tags, prep_bullets, turn_summaries, cleaned_transcript, processing_detail, processing_error, scraper_metadata"
    )
    .eq("processing_status", "complete")
    .order("title");

  if (error || !data) {
    console.error("[regression-snapshot] Failed to fetch appearances:", error);
    process.exit(1);
  }

  console.log(`[regression-snapshot] Found ${data.length} complete appearances.`);

  // Build snapshots
  const snapshots: AppearanceSnapshot[] = data.map((row) => {
    const turns: Turn[] = row.turns ?? [];
    const speakers: Speaker[] = row.speakers ?? [];
    const bullets: PrepBulletsData = row.prep_bullets ?? {};
    const speakerSet = new Set<string>();
    let timestamped = 0;
    let turnsWithAnchor = 0;
    let attrSource = 0;
    let attrInferred = 0;
    let attrUnset = 0;
    let correctedCount = 0;

    for (const turn of turns) {
      if (turn.speaker) speakerSet.add(turn.speaker);
      if (turn.timestamp_seconds != null) timestamped++;
      if (turn.section_anchor) turnsWithAnchor++;
      if (turn.attribution === "source") attrSource++;
      else if (turn.attribution === "inferred") attrInferred++;
      else attrUnset++;
      if (turn.corrected) correctedCount++;
    }

    const tsCoverage =
      turns.length > 0 ? (timestamped / turns.length) * 100 : 0;

    // Gap #1: deterministic hash of all turn text for content change detection
    const turnTextConcat = turns.map((t) => `${t.turn_index}:${t.speaker}:${t.text}`).join("\n");
    const turnTextHash = createHash("sha256").update(turnTextConcat).digest("hex").slice(0, 16);

    // Gap #5: bullet structure depth
    let totalQuotes = 0;
    let quotesWithAnchor = 0;
    for (const b of bullets.bullets ?? []) {
      totalQuotes += b.supporting_quotes.length;
      for (const sq of b.supporting_quotes) {
        if (sq.section_anchor) quotesWithAnchor++;
      }
    }

    // Gap #6: speaker roles
    const speakerRoles: Record<string, string> = {};
    for (const s of speakers) {
      speakerRoles[s.name] = s.role;
    }

    return {
      id: row.id,
      title: row.title,
      transcript_source: row.transcript_source,
      source_name: row.source_name,
      turn_count: turns.length,
      speaker_names: [...speakerSet].sort(),
      timestamp_coverage_pct: parseFloat(tsCoverage.toFixed(1)),
      bullet_count: bullets.bullets?.length ?? 0,
      section_count: row.sections?.length ?? 0,
      entity_fund_count: row.entity_tags?.fund_names?.length ?? 0,
      entity_people_count: row.entity_tags?.key_people?.length ?? 0,
      turn_summary_count: row.turn_summaries?.length ?? 0,
      first_turn_speaker: turns[0]?.speaker ?? null,
      last_turn_speaker: turns[turns.length - 1]?.speaker ?? null,
      cleaned_transcript_length: row.cleaned_transcript?.length ?? 0,
      segment_count: Array.isArray(row.scraper_metadata?.segments)
        ? row.scraper_metadata.segments.length
        : 0,
      passage_count: 0, // placeholder — no passages table yet
      turn_text_hash: turnTextHash,
      turns_with_section_anchor: turnsWithAnchor,
      attribution_source: attrSource,
      attribution_inferred: attrInferred,
      attribution_unset: attrUnset,
      corrected_turn_count: correctedCount,
      total_supporting_quotes: totalQuotes,
      quotes_with_section_anchor: quotesWithAnchor,
      speaker_roles: speakerRoles,
      processing_error: row.processing_error ?? null,
      processing_detail: row.processing_detail ?? null,
    };
  });

  // Write JSON
  const today = new Date().toISOString().slice(0, 10);
  const outputDir = join(__dirname, "output");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `regression-snapshot-${today}.json`);
  writeFileSync(outputPath, JSON.stringify(snapshots, null, 2), "utf-8");
  console.log(`[regression-snapshot] Written to ${outputPath}\n`);

  // Summary table
  console.log(`=== Regression Snapshot: ${today} ===\n`);

  const idW = 10;
  const titleW = 36;
  const srcW = 11;
  const turnsW = 7;
  const spkW = 10;
  const tsW = 9;
  const bulW = 9;
  const secW = 10;
  const entW = 10;
  const sumW = 11;
  const segW = 8;
  const clnW = 11;

  const header = [
    "ID (8ch)".padEnd(idW),
    "Title".padEnd(titleW),
    "Source".padEnd(srcW),
    "Turns".padStart(turnsW),
    "Speakers".padStart(spkW),
    "TS Cov".padStart(tsW),
    "Bullets".padStart(bulW),
    "Sections".padStart(secW),
    "Entities".padStart(entW),
    "Summaries".padStart(sumW),
    "Segs".padStart(segW),
    "Clean Len".padStart(clnW),
  ].join(" | ");

  console.log(header);
  console.log(
    "-".repeat(header.length)
  );

  for (const s of snapshots) {
    const entityTotal = s.entity_fund_count + s.entity_people_count;
    const row = [
      shortId(s.id).padEnd(idW),
      truncate(s.title, titleW).padEnd(titleW),
      shortSource(s.transcript_source).padEnd(srcW),
      String(s.turn_count).padStart(turnsW),
      String(s.speaker_names.length).padStart(spkW),
      `${s.timestamp_coverage_pct.toFixed(1)}%`.padStart(tsW),
      String(s.bullet_count).padStart(bulW),
      String(s.section_count).padStart(secW),
      String(entityTotal).padStart(entW),
      String(s.turn_summary_count).padStart(sumW),
      String(s.segment_count || "-").padStart(segW),
      String(s.cleaned_transcript_length).padStart(clnW),
    ].join(" | ");
    console.log(row);
  }

  // Aggregate summary
  const ytSnapshots = snapshots.filter((s) =>
    s.transcript_source.startsWith("youtube")
  );
  const colSnapshots = snapshots.filter(
    (s) => s.transcript_source === "colossus"
  );
  const otherSnapshots = snapshots.filter(
    (s) =>
      !s.transcript_source.startsWith("youtube") &&
      s.transcript_source !== "colossus"
  );

  const avgTsCov = (arr: AppearanceSnapshot[]) =>
    arr.length > 0
      ? (
          arr.reduce((sum, s) => sum + s.timestamp_coverage_pct, 0) /
          arr.length
        ).toFixed(1)
      : "N/A";

  const totalBullets = snapshots.reduce((sum, s) => sum + s.bullet_count, 0);
  const totalTurns = snapshots.reduce((sum, s) => sum + s.turn_count, 0);

  console.log(`\nSummary:`);
  console.log(`  Total appearances: ${snapshots.length}`);
  console.log(
    `  YouTube: ${ytSnapshots.length} (avg ${avgTsCov(ytSnapshots)}% timestamp coverage)`
  );
  console.log(
    `  Colossus: ${colSnapshots.length} (avg ${avgTsCov(colSnapshots)}% timestamp coverage)`
  );
  if (otherSnapshots.length > 0) {
    console.log(
      `  Other: ${otherSnapshots.length} (avg ${avgTsCov(otherSnapshots)}% timestamp coverage)`
    );
  }
  console.log(`  Total bullets: ${totalBullets.toLocaleString()}`);
  console.log(`  Total turns: ${totalTurns.toLocaleString()}`);

  // Speaker name inventory
  const speakerAppearances = new Map<string, number>();
  for (const s of snapshots) {
    for (const name of s.speaker_names) {
      speakerAppearances.set(name, (speakerAppearances.get(name) ?? 0) + 1);
    }
  }

  const sortedSpeakers = [...speakerAppearances.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  console.log(`\nSpeaker names across all appearances:`);
  for (const [name, count] of sortedSpeakers) {
    const generic =
      /^Speaker \d+$/i.test(name) || name === "Unknown Speaker"
        ? " (generic)"
        : "";
    console.log(`  "${name}" — ${count} appearance${count > 1 ? "s" : ""}${generic}`);
  }

  // Gap #10: Automated diff against most recent previous snapshot
  const snapshotFiles = readdirSync(outputDir)
    .filter((f) => f.startsWith("regression-snapshot-") && f.endsWith(".json") && f !== `regression-snapshot-${today}.json`)
    .sort()
    .reverse();

  if (snapshotFiles.length > 0) {
    const prevPath = join(outputDir, snapshotFiles[0]);
    console.log(`\n=== Diff vs ${snapshotFiles[0]} ===\n`);

    const prevSnapshots: AppearanceSnapshot[] = JSON.parse(readFileSync(prevPath, "utf-8"));
    const prevById = new Map(prevSnapshots.map((s) => [s.id, s]));
    const currById = new Map(snapshots.map((s) => [s.id, s]));

    // New / removed appearances
    const added = snapshots.filter((s) => !prevById.has(s.id));
    const removed = prevSnapshots.filter((s) => !currById.has(s.id));
    if (added.length > 0) console.log(`  Added (${added.length}): ${added.map((s) => truncate(s.title, 40)).join(", ")}`);
    if (removed.length > 0) console.log(`  Removed (${removed.length}): ${removed.map((s) => truncate(s.title, 40)).join(", ")}`);

    // Per-appearance field diffs
    const diffFields: (keyof AppearanceSnapshot)[] = [
      "turn_count", "bullet_count", "section_count", "entity_fund_count",
      "entity_people_count", "turn_summary_count", "timestamp_coverage_pct",
      "cleaned_transcript_length", "segment_count", "passage_count",
      "turn_text_hash", "turns_with_section_anchor",
      "attribution_source", "attribution_inferred", "corrected_turn_count",
      "total_supporting_quotes", "quotes_with_section_anchor",
    ];

    let changedCount = 0;
    for (const curr of snapshots) {
      const prev = prevById.get(curr.id);
      if (!prev) continue;

      const diffs: string[] = [];
      for (const field of diffFields) {
        const pv = prev[field];
        const cv = curr[field];
        // Skip object/array fields — compare primitives only
        if (typeof pv !== typeof cv || typeof pv === "object") continue;
        if (pv !== cv) {
          diffs.push(`${field}: ${pv} → ${cv}`);
        }
      }

      if (diffs.length > 0) {
        changedCount++;
        console.log(`  ${truncate(curr.title, 40)}:`);
        for (const d of diffs) console.log(`    ${d}`);
      }
    }

    if (changedCount === 0 && added.length === 0 && removed.length === 0) {
      console.log("  No changes detected.");
    }
  } else {
    console.log("\n  No previous snapshot found for comparison.");
  }
}

main();
