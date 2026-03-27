import { listAppearancesSummary, searchByFundName } from "@lib/db/queries";
import { formatDate } from "@lib/utils/format-date";
import type { AppearanceListRow } from "@lib/db/types";
import { SearchBar } from "./SearchBar";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 20;

/** Detect if source_name looks like a person's name that's missing from speakers[] */
function detectSpeakerMismatch(row: AppearanceListRow): boolean {
  const source = row.source_name?.trim();
  if (!source) return false;
  // Person names: 2-3 words, no common podcast/org indicators
  const words = source.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const orgIndicators = /\b(capital|partners|associates|fund|group|invest|allocator|mainstream|podcast|llc|inc|management|street|advisory)\b/i;
  if (orgIndicators.test(source)) return false;
  // Check if any speaker name shares a word with source_name
  const sourceWords = new Set(words.map(w => w.toLowerCase()));
  const speakerNames = (row.speakers ?? []).map(s => s.name.toLowerCase());
  const hasMatch = speakerNames.some(name =>
    name.split(/\s+/).some(w => sourceWords.has(w))
  );
  return !hasMatch;
}

function AppearanceTableRow({ row }: { row: AppearanceListRow }) {
  const speakers = (row.speakers ?? [])
    .map((s) => s.name)
    .filter(Boolean)
    .join(", ");
  const bulletCount = row.prep_bullets?.bullets?.length ?? 0;
  const hasGenericSpeakers = (row.speakers ?? []).some(s => /^Speaker \d+$/.test(s.name));
  const hasSpeakerMismatch = detectSpeakerMismatch(row);

  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50">
      <td className="py-2 pr-3">
        <a
          href={`/transcript/${row.id}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          {row.title ?? "Untitled"}
        </a>
      </td>
      <td className="py-2 pr-3 text-xs text-zinc-500">{row.source_name ?? "—"}</td>
      <td className="py-2 pr-3 text-xs text-zinc-500">{formatDate(row.appearance_date) || "—"}</td>
      <td className="py-2 pr-3 text-xs text-zinc-500">
        {speakers || "—"}
        {hasGenericSpeakers && (
          <span className="ml-1.5 text-[10px] text-amber-600" title="Has generic speaker names">needs ID</span>
        )}
        {hasSpeakerMismatch && (
          <span className="ml-1.5 text-[10px] text-red-500" title={`"${row.source_name}" not found in speakers — may need rename`}>host missing</span>
        )}
      </td>
      <td className="py-2 text-xs text-zinc-500 text-right">{bulletCount}</td>
    </tr>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  let rows: AppearanceListRow[];
  let total: number;

  if (query) {
    // searchByFundName filters to complete-only (non-complete have no entity_tags/tsvector)
    const results = await searchByFundName(query);
    rows = results;
    total = results.length;
  } else {
    // Match searchByFundName's complete-only filter so rows don't appear/vanish on search
    const result = await listAppearancesSummary({ page, pageSize: PAGE_SIZE, status: "complete" });
    rows = result.rows;
    total = result.total;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-zinc-900">
        {query ? "Search Results" : "All Appearances"}
      </h1>
      <p className="mb-6 text-sm text-zinc-500">
        {query ? `${total} result${total === 1 ? "" : "s"} for "${query}"` : `${total} total`}
      </p>

      <SearchBar initialQuery={query} />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-200 text-xs font-medium uppercase tracking-wider text-zinc-400">
              <th className="pb-2 pr-3">Title</th>
              <th className="pb-2 pr-3">Source</th>
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Speakers</th>
              <th className="pb-2 text-right">Bullets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AppearanceTableRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>

        {rows.length === 0 && query && (
          <p className="mt-4 text-sm text-zinc-500">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}
      </div>

      {!query && totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} />
      )}
    </main>
  );
}
