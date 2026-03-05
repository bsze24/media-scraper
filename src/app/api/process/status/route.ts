import { NextRequest, NextResponse } from "next/server";
import { checkAdminToken, unauthorizedResponse } from "@lib/api/auth";
import { countByStatus } from "@lib/db/queries";

export async function GET(req: NextRequest) {
  if (!checkAdminToken(req)) {
    return unauthorizedResponse();
  }

  const counts = await countByStatus();
  return NextResponse.json(counts);
}
