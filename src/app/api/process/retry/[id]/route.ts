import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { getAppearanceById, updateProcessingStatus } from "@lib/db/queries";

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

  if (row.processing_status !== "failed") {
    return NextResponse.json(
      {
        error: `Cannot retry: status is "${row.processing_status}", expected "failed"`,
      },
      { status: 409 }
    );
  }

  await updateProcessingStatus(id, "queued");

  return NextResponse.json({ id, status: "queued" });
}
