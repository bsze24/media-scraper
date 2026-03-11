import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { listAppearances } from "@lib/db/queries";
import { reprocessBullets } from "@lib/queue/orchestrator";

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

  const appearances = await listAppearances({ status: "complete" });

  if (appearances.length === 0) {
    return NextResponse.json({ total: 0, succeeded: 0, failed: 0, errors: [] });
  }

  const total = appearances.length;
  const limit = pLimit(5);
  let succeeded = 0;
  let failed = 0;
  const errors: BulkError[] = [];

  console.log(`[bulk] starting: ${total} appearances to reprocess`);

  await Promise.all(
    appearances.map((appearance, i) =>
      limit(async () => {
        const title = appearance.title ?? appearance.id;
        console.log(`[bulk] processing appearance ${i + 1} of ${total}: ${title}`);
        try {
          await reprocessBullets(appearance.id);
          succeeded++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ id: appearance.id, title: appearance.title, error: msg });
          console.error(`[bulk] failed: ${appearance.id} — ${msg}`);
        }
      })
    )
  );

  console.log(`[bulk] complete: ${succeeded} succeeded, ${failed} failed`);

  return NextResponse.json({ total, succeeded, failed, errors });
}
