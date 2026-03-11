/**
 * Manual verification script for bullets reprocess.
 * Run: npx tsx --env-file=.env.local scripts/test-bullets-reprocess.ts
 *
 * Requires:
 * - .env.local with ADMIN_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 * - Dev server running on localhost:3000
 */

import { createClient } from "@supabase/supabase-js";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

if (!ADMIN_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing required env vars: ADMIN_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // 1. Find a complete appearance
  const { data: rows, error: fetchErr } = await supabase
    .from("appearances")
    .select("id, title")
    .eq("processing_status", "complete")
    .limit(1);

  if (fetchErr) throw fetchErr;
  if (!rows || rows.length === 0) {
    console.error("No complete appearances found");
    process.exit(1);
  }

  const { id, title } = rows[0];
  console.log(`Testing reprocess on: ${title} (${id})`);

  // 2. Call POST /api/process/bullets
  const res = await fetch(`${BASE_URL}/api/process/bullets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ appearanceId: id }),
  });

  if (!res.ok) {
    const body = await res.json();
    console.error(`API returned ${res.status}:`, body);
    process.exit(1);
  }

  console.log("API call succeeded, verifying DB row...\n");

  // 3. Query DB and assert
  const { data: row, error: dbErr } = await supabase
    .from("appearances")
    .select("prep_bullets, bullets_generated_at, prompt_context_snapshot, processing_status")
    .eq("id", id)
    .single();

  if (dbErr) throw dbErr;

  let passed = 0;
  let failed = 0;

  function check(name: string, ok: boolean) {
    if (ok) {
      console.log(`  PASS  ${name}`);
      passed++;
    } else {
      console.log(`  FAIL  ${name}`);
      failed++;
    }
  }

  // prep_bullets is not null and is valid JSON
  const hasBullets = row.prep_bullets != null && typeof row.prep_bullets === "object";
  check("prep_bullets is present and valid", hasBullets);

  // bullets_generated_at is within the last 60 seconds
  const genAt = row.bullets_generated_at ? new Date(row.bullets_generated_at) : null;
  const isRecent = genAt != null && (Date.now() - genAt.getTime()) < 60_000;
  check("bullets_generated_at is within last 60s", isRecent);

  // prompt_context_snapshot is a non-empty string
  const hasSnapshot = typeof row.prompt_context_snapshot === "string" && row.prompt_context_snapshot.length > 0;
  check("prompt_context_snapshot is non-empty", hasSnapshot);

  // processing_status is still 'complete'
  check("processing_status is still 'complete'", row.processing_status === "complete");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
