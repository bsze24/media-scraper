"use client";

import Link from "next/link";

export function Pagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  return (
    <div className="mt-6 flex items-center justify-between text-sm">
      {currentPage > 1 ? (
        <Link
          href={`/search?page=${currentPage - 1}`}
          className="text-blue-600 hover:underline"
        >
          &larr; Previous
        </Link>
      ) : (
        <span className="text-zinc-300">&larr; Previous</span>
      )}

      <span className="text-zinc-500">
        Page {currentPage} of {totalPages}
      </span>

      {currentPage < totalPages ? (
        <Link
          href={`/search?page=${currentPage + 1}`}
          className="text-blue-600 hover:underline"
        >
          Next &rarr;
        </Link>
      ) : (
        <span className="text-zinc-300">Next &rarr;</span>
      )}
    </div>
  );
}
