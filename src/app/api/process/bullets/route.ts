import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { reprocessBullets } from "@lib/queue/orchestrator";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  let body: { appearanceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { appearanceId } = body;
  if (!appearanceId || typeof appearanceId !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid appearanceId" },
      { status: 400 }
    );
  }

  try {
    await reprocessBullets(appearanceId);
    return NextResponse.json({ success: true, appearanceId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
