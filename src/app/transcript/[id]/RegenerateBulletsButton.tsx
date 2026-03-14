"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateBullets } from "@/app/actions";

export function RegenerateBulletsButton({
  appearanceId,
  bulletsGeneratedAt,
}: {
  appearanceId: string;
  bulletsGeneratedAt: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateBullets(appearanceId);
      if (result.success) {
        setShowSuccess(true);
        router.refresh();
        setTimeout(() => setShowSuccess(false), 2000);
      } else {
        setError(result.error ?? "Unknown error");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded border border-[#e0dbd2] px-2.5 py-1 font-[family-name:var(--font-source-sans)] text-[11px] text-[#999] transition-colors hover:border-[#bbb] hover:text-[#555] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? (
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

      {bulletsGeneratedAt && !isPending && !showSuccess && (
        <span className="font-[family-name:var(--font-source-sans)] text-[10px] text-[#bbb]">
          Generated {formatRelativeTime(bulletsGeneratedAt)}
        </span>
      )}

      {error && (
        <span className="font-[family-name:var(--font-source-sans)] text-[11px] text-red-500">
          {error}
        </span>
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
