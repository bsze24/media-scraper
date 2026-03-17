import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { getAppearanceById, updateProcessingStatus, updateProcessingDetail } from "@lib/db/queries";

export async function POST(
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

  if (row.processing_status === "complete") {
    return NextResponse.json(
      { error: "Appearance already complete" },
      { status: 409 }
    );
  }

  if (row.processing_status === "queued") {
    return NextResponse.json(
      { error: "Appearance already queued" },
      { status: 409 }
    );
  }

  await updateProcessingStatus(id, "queued", null);
  await updateProcessingDetail(id, null);

  return NextResponse.json({ id, status: "queued" });
}
