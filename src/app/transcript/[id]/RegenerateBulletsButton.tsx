"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { regenerateBullets } from "@/app/actions";

// Sonnet 4: $3/MTok input, $15/MTok output
const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;
const PROMPT_OVERHEAD_CHARS = 18_000; // system prompt + entity_tags + sections JSON
const ESTIMATED_OUTPUT_TOKENS = 3_000; // typical bullets response
const CHARS_PER_TOKEN = 4;

function estimateCost(transcriptCharCount: number): {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
} {
  const inputTokens = Math.ceil(
    (transcriptCharCount + PROMPT_OVERHEAD_CHARS) / CHARS_PER_TOKEN
  );
  const outputTokens = ESTIMATED_OUTPUT_TOKENS;
  const totalCost =
    inputTokens * INPUT_COST_PER_TOKEN +
    outputTokens * OUTPUT_COST_PER_TOKEN;
  return { inputTokens, outputTokens, totalCost };
}

export function RegenerateBulletsButton({
  appearanceId,
  bulletsGeneratedAt,
  transcriptCharCount,
}: {
  appearanceId: string;
  bulletsGeneratedAt: string | null;
  transcriptCharCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isLoading = isRegenerating || isPending;

  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    setError(null);
    setIsRegenerating(true);
    const result = await regenerateBullets(appearanceId);
    setIsRegenerating(false);
    if (result.success) {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
      startTransition(() => {
        router.refresh();
      });
    } else {
      setError(result.error ?? "Unknown error");
    }
  }, [appearanceId, router, startTransition]);

  const { inputTokens, outputTokens, totalCost } =
    estimateCost(transcriptCharCount);

  return (
    <div className="relative flex items-center gap-3">
      <button
        onClick={() => setShowConfirm(true)}
        disabled={isLoading || showConfirm}
        className="inline-flex items-center gap-1.5 rounded border border-[#e0dbd2] px-2.5 py-1 font-[family-name:var(--font-source-sans)] text-[11px] text-[#999] transition-colors hover:border-[#bbb] hover:text-[#555] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading && !showSuccess ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[#ccc] border-t-[#888]" />
            Regenerating…
          </>
        ) : showSuccess ? (
          <>
            <span className="text-green-600">&#10003;</span>
            <span className="text-green-600">Updated!</span>
          </>
        ) : (
          <>
            <span className="text-xs">&#8635;</span>
            Regenerate Bullets
          </>
        )}
      </button>

      {bulletsGeneratedAt && !isLoading && !showSuccess && (
        <span className="font-[family-name:var(--font-source-sans)] text-[10px] text-[#bbb]">
          Generated {formatRelativeTime(bulletsGeneratedAt)}
        </span>
      )}

      {error && (
        <span className="font-[family-name:var(--font-source-sans)] text-[11px] text-red-500">
          {error}
        </span>
      )}

      {showConfirm && (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-72 rounded border border-[#e0dbd2] bg-white p-3 shadow-lg font-[family-name:var(--font-source-sans)]">
          <p className="mb-2 text-[12px] font-medium text-[#333]">
            Regenerate bullets?
          </p>
          <div className="mb-3 space-y-0.5 text-[10.5px] text-[#888]">
            <p>~{(inputTokens / 1000).toFixed(1)}k input tokens + ~{(outputTokens / 1000).toFixed(1)}k output tokens</p>
            <p>Estimated cost: ${totalCost.toFixed(3)}</p>
            <p>Takes ~60 seconds</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="rounded border border-[#c9a84c] bg-[#c9a84c] px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#b8922a]"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded border border-[#e0dbd2] px-3 py-1 text-[11px] text-[#999] transition-colors hover:border-[#bbb] hover:text-[#555]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
