/**
 * Batch-process YouTube URLs through the full pipeline.
 *
 * Phase 1: Insert rows into Supabase (queued status)
 * Phase 2: Process all queued rows with p-limit concurrency
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/batch-process-youtube.ts urls/youtube-batch-1.txt
 */

import * as fs from "fs";
import * as readline from "readline";
import pLimit from "p-limit";
import { insertAppearance, getAppearanceByUrl, listAppearances } from "../lib/db/queries";
import { processAppearance } from "../lib/queue/orchestrator";
import { detectTranscriptSource } from "../lib/scrapers/registry";

function parseUrlFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    console.error(`[error] File not found: ${filePath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const urls = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (urls.length === 0) {
    console.error(`[error] No URLs found in ${filePath} (blank lines and # comments are ignored)`);
    process.exit(1);
  }

  return urls;
}

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("\nPhase 1 complete. Review rows in Supabase, then press Enter to start processing.\n", () => {
      rl.close();
      resolve();
    });
  });
}

async function phase1Insert(urls: string[]): Promise<void> {
  console.log(`\n[insert] Phase 1: Inserting ${urls.length} URLs\n`);

  let created = 0;
  let skipped = 0;

  for (const url of urls) {
    try {
      const existing = await getAppearanceByUrl(url);
      if (existing) {
        console.log(`[insert] Skipped — already exists: ${url}`);
        skipped++;
        continue;
      }

      const source = detectTranscriptSource(url);
      const row = await insertAppearance({ source_url: url, transcript_source: source });
      console.log(`[insert] Created row for ${url} (id: ${row.id})`);
      created++;
    } catch (err) {
      console.error(`[insert] ✗ Failed to insert ${url} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n[insert] ${created} new rows created, ${skipped} skipped (already exist)`);
}

async function phase2Process(): Promise<void> {
  const allQueued = await listAppearances({ status: "queued" });
  // Filter to YouTube sources only — Colossus rows need throttling that
  // this script doesn't implement. Use the orchestrator's processBatch()
  // for Colossus URLs.
  const rows = allQueued.filter((r) =>
    r.transcript_source === "youtube_captions" || r.transcript_source === "youtube_whisper"
  );

  if (rows.length === 0) {
    const skippedColossus = allQueued.length - rows.length;
    console.log(`\n[process] No queued YouTube appearances to process.${skippedColossus > 0 ? ` (${skippedColossus} non-YouTube rows skipped)` : ""}`);
    return;
  }

  if (rows.length < allQueued.length) {
    console.log(`\n[process] Skipping ${allQueued.length - rows.length} non-YouTube queued row(s) — use processBatch() for Colossus`);
  }

  console.log(`\n[process] Phase 2: Processing ${rows.length} queued YouTube appearances (concurrency: 2)\n`);

  const limit = pLimit(2);
  const total = rows.length;
  let succeeded = 0;
  let failed = 0;
  const failedUrls: string[] = [];
  const batchStart = Date.now();

  await Promise.all(
    rows.map((row, i) =>
      limit(async () => {
        const label = row.title ?? row.source_url;
        const n = i + 1;
        console.log(`[process] (${n}/${total}) Starting: ${label}`);
        const start = Date.now();

        try {
          await processAppearance(row.id);
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`[process] (${n}/${total}) ✓ Complete: ${label} (${elapsed}s)`);
          succeeded++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[process] (${n}/${total}) ✗ Failed: ${label} — ${msg}`);
          failed++;
          failedUrls.push(row.source_url);
        }
      })
    )
  );

  const totalElapsed = Date.now() - batchStart;
  const minutes = Math.floor(totalElapsed / 60_000);
  const seconds = Math.floor((totalElapsed % 60_000) / 1000);

  console.log(`\n[batch] Done — ${succeeded} succeeded, ${failed} failed out of ${total} total (${minutes}m ${seconds}s elapsed)`);

  if (failedUrls.length > 0) {
    console.log("\n[batch] Failed URLs:");
    for (const url of failedUrls) {
      console.log(`  ${url}`);
    }
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/batch-process-youtube.ts <urls-file.txt>");
    process.exit(1);
  }

  const urls = parseUrlFile(filePath);
  await phase1Insert(urls);
  await waitForEnter();
  await phase2Process();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
