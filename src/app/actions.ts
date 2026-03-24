"use server";

import { cookies } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import {
  getAppearanceByUrl,
  insertAppearance,
  listAppearances,
  countByStatus,
  getAppearanceById,
  updateProcessingStatus,
  updateProcessingDetail,
} from "@lib/db/queries";
import { detectTranscriptSource } from "@lib/scrapers/registry";
import { processOne, reprocessBullets } from "@lib/queue/orchestrator";
import type { ProcessingStatus } from "@/types/appearance";

async function requireAdmin(): Promise<void> {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return; // No token configured — dev mode, allow all
  const cookieStore = await cookies();
  const provided = cookieStore.get("admin_token")?.value;
  if (provided !== adminToken) {
    throw new Error("Unauthorized: invalid or missing admin token");
  }
}

export async function submitUrls(urls: string[]): Promise<{
  submitted: { id: string; url: string; status: string }[];
  skipped: { url: string; reason: string }[];
}> {
  const submitted: { id: string; url: string; status: string }[] = [];
  const skipped: { url: string; reason: string }[] = [];

  for (const url of urls) {
    try {
      const source = detectTranscriptSource(url);

      const existing = await getAppearanceByUrl(url);
      if (existing) {
        skipped.push({ url, reason: "already exists" });
        continue;
      }

      const row = await insertAppearance({
        source_url: url,
        transcript_source: source,
      });

      submitted.push({
        id: row.id,
        url: row.source_url,
        status: row.processing_status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      skipped.push({ url, reason: message });
    }
  }

  return { submitted, skipped };
}

export async function processNext(): Promise<{
  id: string;
  success: boolean;
  error?: string;
} | null> {
  await requireAdmin();
  const rows = await listAppearances({ status: "queued", limit: 1 });
  if (rows.length === 0) return null;

  const row = rows[0];
  const result = await processOne(row.id);
  return { id: row.id, ...result };
}

export async function retryAppearance(
  id: string
): Promise<{ id: string; status: string }> {
  await requireAdmin();
  const row = await getAppearanceById(id);
  if (!row) throw new Error("Not found");
  if (row.processing_status === "complete") {
    throw new Error("Appearance already complete");
  }
  if (row.processing_status === "queued") {
    throw new Error("Appearance already queued");
  }

  await updateProcessingStatus(id, "queued", null);
  await updateProcessingDetail(id, null);
  return { id, status: "queued" };
}

export async function getQueueStatus(): Promise<
  Record<ProcessingStatus | "total", number>
> {
  noStore();
  return countByStatus();
}

export async function regenerateBullets(
  appearanceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await reprocessBullets(appearanceId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function validateAdminToken(): Promise<boolean> {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}

export async function getAllAppearances(): Promise<
  {
    id: string;
    source_url: string;
    title: string | null;
    processing_status: ProcessingStatus;
    processing_detail: string | null;
    processing_error: string | null;
    updated_at: string;
    created_at: string;
  }[]
> {
  noStore();
  const rows = await listAppearances({ limit: 200 });
  return rows.map((r) => ({
    id: r.id,
    source_url: r.source_url,
    title: r.title,
    processing_status: r.processing_status,
    processing_detail: r.processing_detail,
    processing_error: r.processing_error,
    updated_at: r.updated_at,
    created_at: r.created_at,
  }));
}
