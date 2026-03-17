import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { createServerClient } from "@lib/db/client";
import { reprocessTurnSummaries } from "@lib/queue/orchestrator";

export const maxDuration = 300;

interface BulkError {
  id: string;
  title: string | null;
  error: string;
}

export async function POST(req: NextRequest) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  const db = createServerClient();
  const { data: rows, error } = await db
    .from("appearances")
    .select("id, title")
    .eq("processing_status", "complete")
    .is("turn_summaries", null)
    .not("turns", "is", null);

  if (error) throw error;

  if (!rows || rows.length === 0) {
    return NextResponse.json({ total: 0, succeeded: 0, failed: 0, errors: [] });
  }

  const total = rows.length;
  const limit = pLimit(5);
  let succeeded = 0;
  let failed = 0;
  const errors: BulkError[] = [];

  console.log(`[bulk-turn-summaries] starting: ${total} appearances`);

  await Promise.all(
    rows.map((row, i) =>
      limit(async () => {
        const title = row.title ?? row.id;
        console.log(`[bulk-turn-summaries] ${i + 1}/${total}: ${title}`);
        try {
          await reprocessTurnSummaries(row.id);
          succeeded++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ id: row.id, title: row.title, error: msg });
          console.error(`[bulk-turn-summaries] failed: ${row.id} — ${msg}`);
        }
      })
    )
  );

  console.log(`[bulk-turn-summaries] complete: ${succeeded} succeeded, ${failed} failed`);

  return NextResponse.json({ total, succeeded, failed, errors });
}
