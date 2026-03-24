import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { insertManualAppearance } from "@lib/db/queries";
import type { SpeakerRole } from "@/types/appearance";

const speakerRoles: [SpeakerRole, ...SpeakerRole[]] = [
  "host",
  "guest",
  "rowspace",
  "customer",
  "other",
];

const speakerSchema = z.object({
  name: z.string().min(1),
  role: z.enum(speakerRoles),
  affiliation: z.string().optional(),
});

const bodySchema = z.object({
  source_url: z.url(),
  raw_transcript: z.string().min(1),
  title: z.string().min(1),
  appearance_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .optional(),
  source_name: z.string().min(1),
  speakers: z.array(speakerSchema).min(1),
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

  try {
    const row = await insertManualAppearance(parsed.data);
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Database insert failed", detail: message },
      { status: 500 }
    );
  }
}
