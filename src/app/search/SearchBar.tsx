"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SearchBar({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/search");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by fund name (e.g. Apollo, Warburg Pincus)"
        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
          dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <button
        type="submit"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white
          hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Search
      </button>
    </form>
  );
}
