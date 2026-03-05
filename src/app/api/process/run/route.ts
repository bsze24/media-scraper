import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { processBatch } from "@lib/queue/orchestrator";

export const maxDuration = 300;

const bodySchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(1),
});

export async function POST(req: NextRequest) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // No body or invalid JSON — use defaults
    body = {};
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await processBatch(parsed.data.limit);
  return NextResponse.json(result);
}
