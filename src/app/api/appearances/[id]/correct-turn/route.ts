import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { createServerClient } from "@lib/db/client";
import type { Turn } from "@/types/appearance";

const bodySchema = z.object({
  turn_index: z.number().int().min(0),
  field: z.enum(["speaker", "text"]),
  old_value: z.string(),
  new_value: z.string().min(1),
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

  const { turn_index, field, old_value, new_value } = parsed.data;

  // No-op if same value
  if (old_value === new_value) {
    return NextResponse.json({ no_op: true });
  }

  const supabase = createServerClient();
  const { data: row, error: fetchError } = await supabase
    .from("appearances")
    .select("turns")
    .eq("id", id)
    .single();

  if (fetchError || !row) {
    return NextResponse.json({ error: "Appearance not found" }, { status: 404 });
  }

  const turns: Turn[] = row.turns ?? [];
  const turn = turns[turn_index];
  if (!turn) {
    return NextResponse.json(
      { error: `Turn index ${turn_index} out of range` },
      { status: 400 }
    );
  }

  // Update the specific field
  const updatedTurns = turns.map((t, i) => {
    if (i !== turn_index) return t;
    return {
      ...t,
      [field]: new_value,
      attribution: "source" as const,
      corrected: true,
    };
  });

  const { error: updateError } = await supabase
    .from("appearances")
    .update({ turns: updatedTurns })
    .eq("id", id);

  if (updateError) {
    console.error("[correct-turn] update failed:", updateError);
    return NextResponse.json(
      { error: "Database update failed" },
      { status: 500 }
    );
  }

  // Insert audit row
  await supabase.from("corrections").insert({
    appearance_id: id,
    turn_index,
    field,
    old_value,
    new_value,
    action: "corrected",
  });

  return NextResponse.json({ turns: updatedTurns });
}
