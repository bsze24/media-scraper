import { searchByFundName } from "@lib/db/queries";
import { formatDate } from "@lib/utils/format-date";
import type { AppearanceRow } from "@lib/db/types";
import type { PrepBullet } from "@/types/bullets";
import { SearchBar } from "./SearchBar";

function AppearanceCard({ row }: { row: AppearanceRow }) {
  const speakers = (row.speakers ?? [])
    .map((s) => s.name)
    .filter(Boolean)
    .join(", ");

  const bullets: PrepBullet[] = row.prep_bullets?.bullets ?? [];

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="mb-2">
        <a
          href={`/transcript/${row.id}`}
          className="text-lg font-semibold text-blue-600 hover:underline dark:text-blue-400"
        >
          {row.title ?? "Untitled"}
        </a>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {row.source_name && <span>{row.source_name}</span>}
          {row.appearance_date && (
            <>
              <span>&middot;</span>
              <span>{formatDate(row.appearance_date)}</span>
            </>
          )}
          {speakers && (
            <>
              <span>&middot;</span>
              <span>{speakers}</span>
            </>
          )}
        </div>
      </div>

      {bullets.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {bullets.map((bullet, i) => (
            <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="mr-1.5 text-zinc-400">&bull;</span>
              {bullet.text}
            </li>
          ))}
        </ul>
      )}

      {row.bullets_generated_at && (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Generated &middot; {formatDate(row.bullets_generated_at)}
        </p>
      )}
    </div>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const results: AppearanceRow[] = query
    ? await searchByFundName(query)
    : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Search
      </h1>

      <SearchBar initialQuery={query} />

      <div className="mt-8">
        {query && results.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}

        {results.length > 0 && (
          <div className="space-y-4">
            {results.map((row) => (
              <AppearanceCard key={row.id} row={row} />
            ))}
          </div>
        )}

        {!query && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Enter a fund name to search across all transcripts.
          </p>
        )}
      </div>
    </main>
  );
}
