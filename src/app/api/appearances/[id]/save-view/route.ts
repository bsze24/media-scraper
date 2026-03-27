import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { createServerClient } from "@lib/db/client";

const bodySchema = z.object({
  params: z.string().max(2000).nullable(),
});

export async function PATCH(
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
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("appearances")
    .update({ default_view_params: parsed.data.params })
    .eq("id", id);

  if (error) {
    console.error("[save-view] Supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
