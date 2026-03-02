import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { detectTranscriptSource } from "@lib/scrapers/registry";
import { getAppearanceByUrl, insertAppearance } from "@lib/db/queries";

const bodySchema = z.object({
  urls: z.array(z.url()).min(1).max(100),
});

export async function POST(req: NextRequest) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const submitted: { id: string; url: string; status: string }[] = [];
  const skipped: { url: string; reason: string }[] = [];

  for (const url of parsed.data.urls) {
    try {
      const source = detectTranscriptSource(url);

      const existing = await getAppearanceByUrl(url);
      if (existing) {
        skipped.push({ url, reason: "already exists" });
        continue;
      }

      const row = await insertAppearance({
        source_url: url,
        transcript_source: source,
      });

      submitted.push({
        id: row.id,
        url: row.source_url,
        status: row.processing_status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      skipped.push({ url, reason: message });
    }
  }

  return NextResponse.json({ submitted, skipped }, { status: 201 });
}
