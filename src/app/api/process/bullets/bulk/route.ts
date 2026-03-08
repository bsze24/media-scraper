import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { listAppearances } from "@lib/db/queries";
import { reprocessBullets } from "@lib/queue/orchestrator";

async function runBulkReprocess(
  ids: string[]
): Promise<{ completed: number; failed: number }> {
  const limit = pLimit(2);
  let completed = 0;
  let failed = 0;

  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        try {
          await reprocessBullets(id);
          completed++;
          console.log(`[bulk-bullets] Completed ${id} (${completed + failed}/${ids.length})`);
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[bulk-bullets] Failed ${id}: ${msg}`);
        }
      })
    )
  );

  return { completed, failed };
}

export async function POST(req: NextRequest) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  const appearances = await listAppearances({ status: "complete" });
  const ids = appearances.map((a) => a.id);

  if (ids.length === 0) {
    return NextResponse.json({ status: "no_work", total: 0 });
  }

  // WARNING: fire-and-forget — this promise will be killed on Vercel after
  // response sends. Local dev only until job queue is wired (tech debt #14).
  // Replace with Inngest, BullMQ, or Supabase-backed queue before deploying.
  const promise = runBulkReprocess(ids);
  promise
    .then((r) =>
      console.log(
        `[bulk-bullets] Done: ${r.completed} completed, ${r.failed} failed`
      )
    )
    .catch((e) => console.error(`[bulk-bullets] Fatal:`, e));

  return NextResponse.json({ status: "started", total: ids.length });
}
