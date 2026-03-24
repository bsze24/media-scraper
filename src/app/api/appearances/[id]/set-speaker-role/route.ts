import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { createServerClient } from "@lib/db/client";
import type { Speaker } from "@/types/appearance";

const bodySchema = z.object({
  speaker_name: z.string().min(1),
  role: z.enum(["host", "guest", "panelist", "moderator", "interviewer"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdminToken(req)) return unauthorizedResponse();

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { speaker_name, role } = parsed.data;

  const supabase = createServerClient();
  const { data: row, error: fetchError } = await supabase
    .from("appearances")
    .select("speakers")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Appearance not found" }, { status: 404 });
  }

  const speakers: Speaker[] = row.speakers ?? [];
  const speaker = speakers.find((s) => s.name === speaker_name);
  if (!speaker) {
    return NextResponse.json(
      { error: `Speaker "${speaker_name}" not found` },
      { status: 404 }
    );
  }

  // No-op if same role
  if (speaker.role === role) {
    return NextResponse.json({ no_op: true });
  }

  const oldRole = speaker.role;
  const updatedSpeakers = speakers.map((s) =>
    s.name === speaker_name ? { ...s, role } : s
  );

  const { error: updateError } = await supabase
    .from("appearances")
    .update({ speakers: updatedSpeakers })
    .eq("id", id);

  if (updateError) {
    console.error("[set-speaker-role] update failed:", updateError);
    return NextResponse.json(
      { error: "Database update failed" },
      { status: 500 }
    );
  }

  // Insert audit row
  await supabase.from("corrections").insert({
    appearance_id: id,
    turn_index: null,
    field: "role",
    old_value: oldRole,
    new_value: role,
    action: "corrected",
  });

  return NextResponse.json({ speakers: updatedSpeakers });
}
