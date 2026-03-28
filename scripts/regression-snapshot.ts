import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "../lib/db/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Turn } from "../src/types/appearance";

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
      "id, title, transcript_source, source_name, turns, speakers, sections, entity_tags, prep_bullets, turn_summaries, cleaned_transcript, processing_detail"
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
    const speakerSet = new Set<string>();
    let timestamped = 0;

    for (const turn of turns) {
      if (turn.speaker) speakerSet.add(turn.speaker);
      if (turn.timestamp_seconds != null) timestamped++;
    }

    const tsCoverage =
      turns.length > 0 ? (timestamped / turns.length) * 100 : 0;

    return {
      id: row.id,
      title: row.title,
      transcript_source: row.transcript_source,
      source_name: row.source_name,
      turn_count: turns.length,
      speaker_names: [...speakerSet].sort(),
      timestamp_coverage_pct: parseFloat(tsCoverage.toFixed(1)),
      bullet_count: row.prep_bullets?.bullets?.length ?? 0,
      section_count: row.sections?.length ?? 0,
      entity_fund_count: row.entity_tags?.fund_names?.length ?? 0,
      entity_people_count: row.entity_tags?.key_people?.length ?? 0,
      turn_summary_count: row.turn_summaries?.length ?? 0,
      first_turn_speaker: turns[0]?.speaker ?? null,
      last_turn_speaker: turns[turns.length - 1]?.speaker ?? null,
      cleaned_transcript_length: row.cleaned_transcript?.length ?? 0,
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
}

main();
