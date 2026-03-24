import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { createServerClient } from "@lib/db/client";
import type { Speaker, EntityTags, Turn } from "@/types/appearance";
import type { PrepBulletsData } from "@/types/bullets";

const bodySchema = z.object({
  old_name: z.string().min(1),
  new_name: z.string().min(1),
  role: z
    .enum(["host", "guest", "rowspace", "customer", "other"])
    .optional(),
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

  const { old_name, new_name, role } = parsed.data;

  // No-op if same name and no role change
  if (old_name === new_name && !role) {
    return NextResponse.json({ no_op: true });
  }

  const supabase = createServerClient();
  const { data: row, error: fetchError } = await supabase
    .from("appearances")
    .select(
      "speakers, turns, turn_summaries, prep_bullets, entity_tags, cleaned_transcript"
    )
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Appearance not found" }, { status: 404 });
  }

  const speakers: Speaker[] = row.speakers ?? [];

  // Validate old_name exists
  if (!speakers.some((s) => s.name === old_name)) {
    return NextResponse.json(
      { error: `Speaker "${old_name}" not found` },
      { status: 404 }
    );
  }

  // Reject if new_name already exists as a different speaker
  const nameChanged = old_name !== new_name;
  if (nameChanged && speakers.some((s) => s.name === new_name)) {
    return NextResponse.json(
      { error: `Speaker "${new_name}" already exists` },
      { status: 400 }
    );
  }

  const turns: Turn[] = row.turns ?? [];
  const turnSummaries: Array<{
    speaker: string;
    summary: string;
    turn_index: number;
  }> = row.turn_summaries ?? [];
  const prepBullets: PrepBulletsData = row.prep_bullets ?? { bullets: [] };
  const entityTags: EntityTags = row.entity_tags ?? {};
  let cleanedTranscript: string = row.cleaned_transcript ?? "";

  // 1. speakers[]
  const updatedSpeakers = speakers.map((s) => {
    if (s.name !== old_name) return s;
    return {
      ...s,
      name: old_name === new_name ? s.name : new_name,
      ...(role ? { role } : {}),
    };
  });

  // 2. turns[] — update speaker, set attribution + corrected (skip if name unchanged)
  let turnsUpdated = 0;
  const updatedTurns = nameChanged
    ? turns.map((t) => {
        if (t.speaker !== old_name) return t;
        turnsUpdated++;
        return {
          ...t,
          speaker: new_name,
          attribution: "source" as const,
          corrected: true,
        };
      })
    : turns;

  // 3-6: Only update remaining locations if name actually changed
  let bulletsUpdated = 0;
  const updatedTurnSummaries = nameChanged
    ? turnSummaries.map((ts) =>
        ts.speaker === old_name ? { ...ts, speaker: new_name } : ts
      )
    : turnSummaries;

  const updatedBullets: PrepBulletsData = nameChanged
    ? {
        ...prepBullets,
        bullets: (prepBullets.bullets ?? []).map((b) => ({
          ...b,
          supporting_quotes: b.supporting_quotes.map((sq) => {
            if (sq.speaker !== old_name) return sq;
            bulletsUpdated++;
            return { ...sq, speaker: new_name };
          }),
        })),
      }
    : prepBullets;

  const updatedEntityTags: EntityTags = nameChanged
    ? {
        ...entityTags,
        key_people: (entityTags.key_people ?? []).map((kp) =>
          kp.name === old_name ? { ...kp, name: new_name } : kp
        ),
      }
    : entityTags;

  if (nameChanged) {
    const escapedOldName = old_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const transcriptRegex = new RegExp(`^${escapedOldName}:`, "gm");
    cleanedTranscript = cleanedTranscript.replace(
      transcriptRegex,
      () => `${new_name}:`
    );
  }

  // Single UPDATE
  const { error: updateError } = await supabase
    .from("appearances")
    .update({
      speakers: updatedSpeakers,
      turns: updatedTurns,
      turn_summaries: updatedTurnSummaries,
      prep_bullets: updatedBullets,
      entity_tags: updatedEntityTags,
      cleaned_transcript: cleanedTranscript,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[rename-speaker] update failed:", updateError);
    return NextResponse.json(
      { error: "Database update failed" },
      { status: 500 }
    );
  }

  // Insert audit row (turn_index null for renames)
  await supabase.from("corrections").insert({
    appearance_id: id,
    turn_index: null,
    field: "speaker",
    old_value: old_name,
    new_value: new_name,
    action: "corrected",
  });

  return NextResponse.json({
    speakers: updatedSpeakers,
    turns: updatedTurns,
    turn_summaries: updatedTurnSummaries,
    prep_bullets: updatedBullets,
    entity_tags: updatedEntityTags,
    turns_updated: turnsUpdated,
    bullets_updated: bulletsUpdated,
  });
}
