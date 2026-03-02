import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { getAppearanceById } from "@lib/db/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  const { id } = await params;
  const row = await getAppearanceById(id);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    source_url: row.source_url,
    title: row.title,
    processing_status: row.processing_status,
    processing_error: row.processing_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
