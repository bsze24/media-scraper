"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  submitUrls,
  processNext,
  retryAppearance,
  getQueueStatus,
  getAllAppearances,
} from "./actions";
import type { ProcessingStatus } from "@/types/appearance";

type StatusCounts = Record<ProcessingStatus | "total", number>;

interface AppearanceItem {
  id: string;
  source_url: string;
  title: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_at: string;
}

const STATUS_BADGES: Record<
  ProcessingStatus,
  { label: string; className: string }
> = {
  queued: {
    label: "queued",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  },
  extracting: {
    label: "extracting",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  cleaning: {
    label: "cleaning",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  analyzing: {
    label: "analyzing",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  },
  complete: {
    label: "done",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  failed: {
    label: "failed",
    className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
};

function truncateUrl(url: string, max = 50): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + "\u2026";
}

export default function Home() {
  const [urlText, setUrlText] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [appearances, setAppearances] = useState<AppearanceItem[]>([]);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const stopRef = useRef(false);

  const refresh = useCallback(async () => {
    const [newAppearances, newCounts] = await Promise.all([
      getAllAppearances(),
      getQueueStatus(),
    ]);
    setAppearances(newAppearances);
    setCounts(newCounts);
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 5s while there are non-terminal items
  useEffect(() => {
    const hasActive = appearances.some(
      (a) =>
        a.processing_status !== "complete" && a.processing_status !== "failed"
    );
    if (!hasActive || processing) return;

    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [appearances, processing, refresh]);

  async function handleSubmit() {
    const urls = urlText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (urls.length === 0) return;

    setSubmitting(true);
    setSubmitMessage("");
    try {
      const result = await submitUrls(urls);
      const parts: string[] = [];
      if (result.submitted.length > 0) {
        parts.push(`${result.submitted.length} submitted`);
      }
      if (result.skipped.length > 0) {
        parts.push(
          `${result.skipped.length} skipped (${result.skipped.map((s) => s.reason).join(", ")})`
        );
      }
      setSubmitMessage(parts.join(", "));
      setUrlText("");
      await refresh();
    } catch (err) {
      setSubmitMessage(
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProcessAll() {
    setProcessing(true);
    stopRef.current = false;

    try {
      while (!stopRef.current) {
        const result = await processNext();
        if (!result) break; // No more queued items
        await refresh();
        if (!result.success) {
          // Continue to next item even if one fails
          continue;
        }
      }
    } finally {
      setProcessing(false);
      await refresh();
    }
  }

  function handleStop() {
    stopRef.current = true;
  }

  async function handleRetry(id: string) {
    try {
      await retryAppearance(id);
      await refresh();
    } catch (err) {
      console.error("Retry failed:", err);
    }
  }

  const activeCount =
    (counts?.extracting ?? 0) + (counts?.cleaning ?? 0) + (counts?.analyzing ?? 0);

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Meeting Prep Tool — Admin
        </h1>

        {/* URL Submission */}
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label
            htmlFor="url-input"
            className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Paste URLs (one per line)
          </label>
          <textarea
            id="url-input"
            className="w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            rows={5}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder="https://www.colossus.com/episodes/..."
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting || urlText.trim().length === 0}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {submitting ? "Submitting\u2026" : "Submit URLs"}
            </button>
            {submitMessage && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {submitMessage}
              </span>
            )}
          </div>
        </section>

        {/* Status Bar */}
        {counts && (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Queued: <strong>{counts.queued}</strong>
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                Processing: <strong>{activeCount}</strong>
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                Done: <strong>{counts.complete}</strong>
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                Failed: <strong>{counts.failed}</strong>
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={handleProcessAll}
                  disabled={processing || (counts.queued ?? 0) === 0}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {processing ? "Processing\u2026" : "Process All"}
                </button>
                {processing && (
                  <button
                    onClick={handleStop}
                    className="rounded border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Appearances Table */}
        {appearances.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-950">
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    URL
                  </th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    Title
                  </th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    Status
                  </th>
                  <th className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {appearances.map((a) => {
                  const badge = STATUS_BADGES[a.processing_status];
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <td
                        className="max-w-[200px] truncate px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300"
                        title={a.source_url}
                      >
                        {truncateUrl(a.source_url)}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2 text-zinc-700 dark:text-zinc-300">
                        {a.title ?? "\u2014"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {a.processing_error && (
                          <span
                            className="ml-2 text-xs text-red-500"
                            title={a.processing_error}
                          >
                            {a.processing_error.slice(0, 40)}
                            {a.processing_error.length > 40 ? "\u2026" : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {a.processing_status === "failed" && (
                          <button
                            onClick={() => handleRetry(a.id)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
