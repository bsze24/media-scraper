import { NextRequest, NextResponse } from "next/server";

export function checkAdminToken(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  console.log(`[auth] token present: ${!!token}, expected present: ${!!expected}, match: ${token === expected}`);
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return token === expected;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
