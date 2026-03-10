import { listAppearances, searchByFundName } from "@lib/db/queries";
import { formatDate } from "@lib/utils/format-date";
import type { AppearanceRow } from "@lib/db/types";
import { SearchBar } from "./SearchBar";

const STATUS_COLORS: Record<string, string> = {
  complete: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  queued: "bg-zinc-100 text-zinc-600",
  extracting: "bg-yellow-100 text-yellow-800",
  cleaning: "bg-yellow-100 text-yellow-800",
  analyzing: "bg-blue-100 text-blue-800",
};

function AppearanceRow({ row }: { row: AppearanceRow }) {
  const speakers = (row.speakers ?? [])
    .map((s) => s.name)
    .filter(Boolean)
    .join(", ");
  const bulletCount = row.prep_bullets?.bullets?.length ?? 0;

  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
      <td className="py-2 pr-3">
        <a
          href={`/transcript/${row.id}`}
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {row.title ?? "Untitled"}
        </a>
      </td>
      <td className="py-2 pr-3 text-xs text-zinc-500">{row.source_name ?? "—"}</td>
      <td className="py-2 pr-3 text-xs text-zinc-500">{formatDate(row.appearance_date)}</td>
      <td className="py-2 pr-3 text-xs text-zinc-500">{speakers || "—"}</td>
      <td className="py-2 pr-3">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[row.processing_status] ?? "bg-zinc-100 text-zinc-600"}`}>
          {row.processing_status}
        </span>
      </td>
      <td className="py-2 text-xs text-zinc-500 text-right">{bulletCount}</td>
    </tr>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const rows: AppearanceRow[] = query
    ? await searchByFundName(query)
    : await listAppearances();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        All Appearances
      </h1>
      <p className="mb-6 text-sm text-zinc-500">{rows.length} total</p>

      <SearchBar initialQuery={query} />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-200 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:border-zinc-700">
              <th className="pb-2 pr-3">Title</th>
              <th className="pb-2 pr-3">Source</th>
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Speakers</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2 text-right">Bullets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AppearanceRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>

        {rows.length === 0 && query && (
          <p className="mt-4 text-sm text-zinc-500">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
    </main>
  );
}
