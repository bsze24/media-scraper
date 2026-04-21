"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  submitUrls,
  processNext,
  retryAppearance,
  deleteAppearance,
  getQueueStatus,
  getAllAppearances,
  validateAdminToken,
} from "./actions";
import type { ProcessingStatus } from "@/types/appearance";

type StatusCounts = Record<ProcessingStatus | "total", number>;

interface AppearanceItem {
  id: string;
  source_url: string;
  source_name: string | null;
  title: string | null;
  processing_status: ProcessingStatus;
  processing_detail: string | null;
  processing_error: string | null;
  updated_at: string;
  created_at: string;
}

const STATUS_BADGES: Record<
  ProcessingStatus,
  { label: string; className: string }
> = {
  queued: {
    label: "queued",
    className: "bg-zinc-200 text-zinc-700",
  },
  extracting: {
    label: "extracting",
    className: "bg-blue-100 text-blue-700",
  },
  cleaning: {
    label: "cleaning",
    className: "bg-blue-100 text-blue-700",
  },
  analyzing: {
    label: "analyzing",
    className:
      "bg-yellow-100 text-yellow-700",
  },
  complete: {
    label: "done",
    className:
      "bg-green-100 text-green-700",
  },
  failed: {
    label: "failed",
    className: "bg-red-100 text-red-700",
  },
};

const IN_FLIGHT_STATUSES: Set<ProcessingStatus> = new Set([
  "extracting",
  "cleaning",
  "analyzing",
]);

function truncateUrl(url: string, max = 50): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 1) + "\u2026";
}

function formatElapsed(updatedAt: string): string {
  const elapsed = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000);
  if (elapsed < 0) return "0s";
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m ${secs}s`;
}

function getAdminCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)admin_token=([^;]*)/);
  return match ? match[1] : null;
}

function setAdminCookie(token: string) {
  document.cookie = `admin_token=${token}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

export default function Home() {
  const [urlText, setUrlText] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [appearances, setAppearances] = useState<AppearanceItem[]>([]);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [resettingInFlight, setResettingInFlight] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showCopied, setShowCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef(false);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setShowCopied(true);
    copiedTimerRef.current = setTimeout(() => setShowCopied(false), 1500);
  }, []);

  // Check for existing admin cookie on mount
  useEffect(() => {
    if (getAdminCookie()) setAuthed(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [newAppearances, newCounts] = await Promise.all([
        getAllAppearances(),
        getQueueStatus(),
      ]);
      setAppearances(newAppearances);
      setCounts(newCounts);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      console.error("Failed to load appearances:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh every 5s while there are non-terminal items or processing is active
  useEffect(() => {
    const hasActive = appearances.some(
      (a) =>
        a.processing_status !== "complete" && a.processing_status !== "failed"
    );
    if (!hasActive && !processing) return;

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
      let isFirst = true;
      while (!stopRef.current) {
        // Rate-limit between items (skip delay before first item)
        if (!isFirst) {
          await new Promise((r) => setTimeout(r, 3000));
        }
        isFirst = false;

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

  async function handleRetryAllFailed() {
    const failedRows = appearances.filter((a) => a.processing_status === "failed");
    if (failedRows.length === 0) return;

    const confirmed = window.confirm(`Reset ${failedRows.length} failed row${failedRows.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;

    setRetryingAll(true);
    try {
      for (const row of failedRows) {
        try {
          await retryAppearance(row.id);
        } catch (err) {
          console.error(`Retry failed for ${row.id}:`, err);
        }
      }
    } finally {
      setRetryingAll(false);
      await refresh();
    }
  }

  async function handleResetInFlight() {
    const inFlightRows = appearances.filter((a) => IN_FLIGHT_STATUSES.has(a.processing_status));
    if (inFlightRows.length === 0) return;

    const confirmed = window.confirm(`Reset ${inFlightRows.length} in-flight row${inFlightRows.length === 1 ? "" : "s"} back to queued?`);
    if (!confirmed) return;

    setResettingInFlight(true);
    const failedIds: string[] = [];
    try {
      for (const row of inFlightRows) {
        try {
          await retryAppearance(row.id);
        } catch (err) {
          failedIds.push(row.id);
          console.error(`Reset failed for ${row.id}:`, err);
        }
      }
      if (failedIds.length > 0) {
        setResetError(`Reset failed for ${failedIds.length} of ${inFlightRows.length} rows: [${failedIds.join(", ")}]`);
      } else {
        setResetError(null);
      }
    } finally {
      setResettingInFlight(false);
      await refresh();
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this appearance? This cannot be undone.");
    if (!confirmed) return;
    try {
      await deleteAppearance(id);
      await refresh();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  const activeCount =
    (counts?.extracting ?? 0) + (counts?.cleaning ?? 0) + (counts?.analyzing ?? 0);

  const failedCount = counts?.failed ?? 0;

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans">
        <div className="w-80 space-y-4">
          <h1 className="text-lg font-semibold text-zinc-900">
            Admin Login
          </h1>
          <input
            type="password"
            placeholder="Admin token"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              setAuthError(false);
            }}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && tokenInput.trim()) {
                setAdminCookie(tokenInput.trim());
                const valid = await validateAdminToken();
                if (valid) {
                  setAuthed(true);
                  refresh();
                } else {
                  setAuthError(true);
                }
              }
            }}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500"
          />
          <button
            onClick={async () => {
              if (!tokenInput.trim()) return;
              setAdminCookie(tokenInput.trim());
              const valid = await validateAdminToken();
              if (valid) {
                setAuthed(true);
                refresh();
              } else {
                setAuthError(true);
              }
            }}
            className="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Sign in
          </button>
          {authError && (
            <p className="text-xs text-red-500">Invalid token</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans">
      <div className="mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Meeting Prep Tool — Admin
        </h1>

        {/* URL Submission */}
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <label
            htmlFor="url-input"
            className="mb-2 block text-sm font-medium text-zinc-700"
          >
            Paste URLs (one per line)
          </label>
          <textarea
            id="url-input"
            className="w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none"
            rows={5}
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder="https://www.colossus.com/episodes/..."
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting || urlText.trim().length === 0}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {submitting ? "Submitting\u2026" : "Submit URLs"}
            </button>
            {submitMessage && (
              <span className="text-sm text-zinc-600">
                {submitMessage}
              </span>
            )}
          </div>
        </section>

        {/* Status Bar */}
        {counts && (
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-zinc-600">
                Queued: <strong>{counts.queued}</strong>
              </span>
              <span className="text-zinc-600">
                Processing: <strong>{activeCount}</strong>
              </span>
              <span className="text-zinc-600">
                Done: <strong>{counts.complete}</strong>
              </span>
              <span className="text-zinc-600">
                Failed: <strong>{counts.failed}</strong>
              </span>
              <div className="ml-auto flex gap-2">
                {activeCount > 0 && !processing && (
                  <button
                    onClick={handleResetInFlight}
                    disabled={resettingInFlight}
                    className="rounded border border-orange-300 px-4 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                  >
                    {resettingInFlight ? "Resetting\u2026" : "Reset In-Flight"}
                  </button>
                )}
                {failedCount > 0 && (
                  <button
                    onClick={handleRetryAllFailed}
                    disabled={retryingAll}
                    className="rounded border border-amber-300 px-4 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {retryingAll ? "Retrying\u2026" : "Retry All Failed"}
                  </button>
                )}
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
                    className="rounded border border-red-300 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Error Banners */}
        {loadError && (
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <strong>Load error:</strong> {loadError}
          </section>
        )}
        {resetError && (
          <section className="flex items-start justify-between rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
            <span><strong>Reset error:</strong> {resetError}</span>
            <button onClick={() => setResetError(null)} aria-label="Dismiss" className="ml-4 text-orange-400 hover:text-orange-700">&times;</button>
          </section>
        )}

        {/* Appearances Table */}
        {appearances.length > 0 && (
          <section className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-3 py-1 font-medium text-zinc-600">ID</th>
                  <th className="px-3 py-1 font-medium text-zinc-600">Source</th>
                  <th className="px-3 py-1 font-medium text-zinc-600">Title</th>
                  <th className="px-3 py-1 font-medium text-zinc-600">Status</th>
                  <th className="px-3 py-1 font-medium text-zinc-600">Detail</th>
                  <th className="px-3 py-1 font-medium text-zinc-600">Action</th>
                </tr>
              </thead>
              <tbody>
                {appearances.map((a) => {
                  const badge = STATUS_BADGES[a.processing_status];
                  const isInFlight = IN_FLIGHT_STATUSES.has(a.processing_status);
                  const isComplete = a.processing_status === "complete";
                  const isFailed = a.processing_status === "failed";
                  const canRetry = !isComplete && a.processing_status !== "queued";
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-zinc-100"
                    >
                      <td className="whitespace-nowrap px-3 py-1 font-mono text-xs text-zinc-500">
                        <button
                          onClick={() => copyToClipboard(a.id)}
                          title="Click to copy"
                          className="cursor-pointer hover:text-zinc-900"
                        >
                          {a.id}
                        </button>
                      </td>
                      <td className="px-3 py-1 text-xs text-zinc-500">
                        {a.source_name ?? "\u2014"}
                      </td>
                      <td className="px-3 py-1 text-zinc-700">
                        {isComplete ? (
                          <a
                            href={`/transcript/${a.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {a.title ?? "\u2014"}
                          </a>
                        ) : (
                          <a
                            href={a.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {a.title || truncateUrl(a.source_url, 50)}
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-1">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {isInFlight && (
                          <span className="ml-2 text-xs text-zinc-400">
                            {formatElapsed(a.updated_at)}
                          </span>
                        )}
                        {isFailed && a.processing_error && (
                          <button
                            onClick={() => copyToClipboard(a.processing_error!)}
                            title="Click to copy"
                            className="ml-2 max-w-xs cursor-pointer break-words text-left text-xs text-red-500 hover:text-red-700"
                          >
                            {a.processing_error}
                          </button>
                        )}
                        {isComplete && a.processing_error && (
                          <button
                            onClick={() => copyToClipboard(a.processing_error!)}
                            title="Click to copy"
                            className="ml-2 max-w-xs cursor-pointer break-words text-left text-xs text-amber-500 hover:text-amber-700"
                          >
                            {a.processing_error}
                          </button>
                        )}
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs text-zinc-500">
                        {a.processing_detail ? (
                          <button
                            onClick={() => copyToClipboard(a.processing_detail!)}
                            title="Click to copy"
                            className="cursor-pointer break-words text-left hover:text-zinc-900"
                          >
                            {a.processing_detail}
                          </button>
                        ) : "\u2014"}
                      </td>
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-2">
                          {canRetry && (
                            <button
                              onClick={() => handleRetry(a.id)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-500"
                            >
                              Retry
                            </button>
                          )}
                          {!isComplete && !isInFlight && (
                            <button
                              onClick={() => handleDelete(a.id)}
                              className="text-xs font-medium text-red-500 hover:text-red-700"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* Copied toast */}
      {showCopied && (
        <div className="fixed bottom-6 right-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          Copied!
        </div>
      )}
    </div>
  );
}
