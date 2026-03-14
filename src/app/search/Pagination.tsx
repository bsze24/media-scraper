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
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          &larr; Previous
        </Link>
      ) : (
        <span className="text-zinc-300 dark:text-zinc-600">&larr; Previous</span>
      )}

      <span className="text-zinc-500">
        Page {currentPage} of {totalPages}
      </span>

      {currentPage < totalPages ? (
        <Link
          href={`/search?page=${currentPage + 1}`}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Next &rarr;
        </Link>
      ) : (
        <span className="text-zinc-300 dark:text-zinc-600">Next &rarr;</span>
      )}
    </div>
  );
}
