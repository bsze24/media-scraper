import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./client", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "./client";
import {
  writeCleanResult,
  writeEntitiesResult,
  writeBulletsResult,
  invalidateFundOverviewCache,
  searchByFundName,
  extractFundNames,
} from "./queries";
import type { AppearanceRow } from "./types";
import type { EntityTags } from "@/types/appearance";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a chainable mock that mimics the Supabase query builder.
 * Every method returns itself; awaiting it resolves to `response`.
 */
function mockChain(response: { data: any; error: any } = { data: null, error: null }) {
  const chain: any = {};
  const methods = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "in", "contains", "or",
    "textSearch", "order", "limit", "range",
    "single", "maybeSingle", "filter",
  ];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Make it thenable so `await` resolves to response
  chain.then = (onFulfilled: any, onRejected?: any) =>
    Promise.resolve(response).then(onFulfilled, onRejected);

  return chain;
}

function makeTestRow(overrides: Partial<AppearanceRow> = {}): AppearanceRow {
  return {
    id: "test-id",
    source_url: "https://example.com/test",
    transcript_source: "colossus",
    source_name: "Invest Like the Best",
    title: "Test Appearance",
    appearance_date: "2024-01-15",
    speakers: [{ name: "Patrick O'Shaughnessy", role: "host" }],
    raw_transcript: "Raw text...",
    raw_caption_data: null,
    cleaned_transcript: "Cleaned text...",
    entity_tags: {},
    prep_bullets: {},
    turns: null,
    turn_summaries: null,
    sections: [],
    prompt_context_snapshot: null,
    bullets_generated_at: null,
    processing_status: "complete",
    processing_error: null,
    created_at: "2024-01-15T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// writeCleanResult — idempotency
// ---------------------------------------------------------------------------

describe("writeCleanResult", () => {
  it("writes when cleaned_transcript is null", async () => {
    const checkChain = mockChain({
      data: { cleaned_transcript: null },
      error: null,
    });
    const writeChain = mockChain({ data: null, error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(writeChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const result = await writeCleanResult("abc", {
      cleaned_transcript: "Clean text",
    });

    expect(result).toBe(true);
    expect(mockClient.from).toHaveBeenCalledTimes(2);
    expect(writeChain.update).toHaveBeenCalledWith({
      cleaned_transcript: "Clean text",
    });
  });

  it("no-ops when cleaned_transcript is already populated", async () => {
    const checkChain = mockChain({
      data: { cleaned_transcript: "Already clean" },
      error: null,
    });

    const mockClient = {
      from: vi.fn().mockReturnValue(checkChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const result = await writeCleanResult("abc", {
      cleaned_transcript: "New text",
    });

    expect(result).toBe(false);
    // Only the check query, no update
    expect(mockClient.from).toHaveBeenCalledTimes(1);
  });

  it("writes when force=true even if populated", async () => {
    const writeChain = mockChain({ data: null, error: null });

    const mockClient = {
      from: vi.fn().mockReturnValue(writeChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const result = await writeCleanResult(
      "abc",
      { cleaned_transcript: "Overwrite" },
      { force: true }
    );

    expect(result).toBe(true);
    // Skips the check, goes straight to update
    expect(mockClient.from).toHaveBeenCalledTimes(1);
    expect(writeChain.update).toHaveBeenCalledWith({
      cleaned_transcript: "Overwrite",
    });
  });
});

// ---------------------------------------------------------------------------
// writeEntitiesResult — idempotency
// ---------------------------------------------------------------------------

describe("writeEntitiesResult", () => {
  it("writes when entity_tags is empty default", async () => {
    const checkChain = mockChain({
      data: { entity_tags: {} },
      error: null,
    });
    const writeChain = mockChain({ data: null, error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(writeChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const tags: EntityTags = {
      fund_names: [{ name: "Apollo", aliases: [], type: "primary" }],
    };

    const result = await writeEntitiesResult("abc", { entity_tags: tags });

    expect(result).toBe(true);
    expect(mockClient.from).toHaveBeenCalledTimes(2);
    expect(writeChain.update).toHaveBeenCalledWith({ entity_tags: tags });
  });

  it("no-ops when entity_tags is already populated", async () => {
    const checkChain = mockChain({
      data: {
        entity_tags: {
          fund_names: [{ name: "Blackstone", aliases: [], type: "primary" }],
        },
      },
      error: null,
    });

    const mockClient = {
      from: vi.fn().mockReturnValue(checkChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const result = await writeEntitiesResult("abc", {
      entity_tags: {
        fund_names: [{ name: "Apollo", aliases: [], type: "primary" }],
      },
    });

    expect(result).toBe(false);
    expect(mockClient.from).toHaveBeenCalledTimes(1);
  });

  it("writes when force=true even if populated", async () => {
    const writeChain = mockChain({ data: null, error: null });

    const mockClient = {
      from: vi.fn().mockReturnValue(writeChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const tags: EntityTags = {
      fund_names: [{ name: "KKR", aliases: [], type: "primary" }],
    };

    const result = await writeEntitiesResult(
      "abc",
      { entity_tags: tags },
      { force: true }
    );

    expect(result).toBe(true);
    expect(mockClient.from).toHaveBeenCalledTimes(1);
    expect(writeChain.update).toHaveBeenCalledWith({ entity_tags: tags });
  });
});

// ---------------------------------------------------------------------------
// writeBulletsResult — idempotency
// ---------------------------------------------------------------------------

describe("writeBulletsResult", () => {
  it("writes when prep_bullets is empty default", async () => {
    const checkChain = mockChain({
      data: { prep_bullets: {} },
      error: null,
    });
    const writeChain = mockChain({ data: null, error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(checkChain)
        .mockReturnValueOnce(writeChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const bullets = {
      bullets: [
        {
          text: "Apollo focuses on distressed debt",
          supporting_quotes: [],
          vote: null,
          vote_note: null,
        },
      ],
    };

    const result = await writeBulletsResult("abc", { prep_bullets: bullets });

    expect(result).toBe(true);
    expect(mockClient.from).toHaveBeenCalledTimes(2);
  });

  it("no-ops when prep_bullets is already populated", async () => {
    const checkChain = mockChain({
      data: {
        prep_bullets: {
          bullets: [{ text: "Existing bullet", supporting_quotes: [], vote: null, vote_note: null }],
        },
      },
      error: null,
    });

    const mockClient = {
      from: vi.fn().mockReturnValue(checkChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const result = await writeBulletsResult("abc", {
      prep_bullets: { bullets: [{ text: "New", supporting_quotes: [], vote: null, vote_note: null }] },
    });

    expect(result).toBe(false);
    expect(mockClient.from).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// invalidateFundOverviewCache — multi-fund
// ---------------------------------------------------------------------------

describe("invalidateFundOverviewCache", () => {
  it("deletes cache entries for all provided fund names", async () => {
    const deleteChain = mockChain({ data: null, error: null });

    const mockClient = {
      from: vi.fn().mockReturnValue(deleteChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    await invalidateFundOverviewCache(["Apollo", "Blackstone", "KKR"]);

    expect(mockClient.from).toHaveBeenCalledWith("fund_overview_cache");
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.in).toHaveBeenCalledWith("fund_name", [
      "Apollo",
      "Blackstone",
      "KKR",
    ]);
  });

  it("no-ops for empty array", async () => {
    const mockClient = { from: vi.fn() };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    await invalidateFundOverviewCache([]);

    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// extractFundNames + invalidation integration
// ---------------------------------------------------------------------------

describe("extractFundNames", () => {
  it("extracts all fund names from entity_tags", () => {
    const tags: EntityTags = {
      fund_names: [
        { name: "Apollo Global Management", aliases: ["Apollo"], type: "primary" },
        { name: "Blackstone", aliases: [], type: "primary" },
        { name: "KKR", aliases: ["Kohlberg Kravis Roberts"], type: "primary" },
      ],
    };

    const names = extractFundNames(tags);

    expect(names).toEqual([
      "Apollo Global Management",
      "Blackstone",
      "KKR",
    ]);
  });

  it("returns empty array for empty entity_tags", () => {
    expect(extractFundNames({})).toEqual([]);
  });

  it("returns empty array when fund_names is undefined", () => {
    expect(extractFundNames({ sectors_themes: ["PE"] })).toEqual([]);
  });

  it("integrates with invalidateFundOverviewCache for multi-fund invalidation", async () => {
    const deleteChain = mockChain({ data: null, error: null });
    const mockClient = {
      from: vi.fn().mockReturnValue(deleteChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    // Simulate what the orchestrator does: extract names then invalidate
    const tags: EntityTags = {
      fund_names: [
        { name: "Apollo", aliases: [], type: "primary" },
        { name: "Blackstone", aliases: [], type: "primary" },
        { name: "KKR", aliases: [], type: "primary" },
      ],
    };
    const names = extractFundNames(tags);
    await invalidateFundOverviewCache(names);

    expect(deleteChain.in).toHaveBeenCalledWith("fund_name", [
      "Apollo",
      "Blackstone",
      "KKR",
    ]);
  });
});

// ---------------------------------------------------------------------------
// searchByFundName
// ---------------------------------------------------------------------------

describe("searchByFundName", () => {
  it("returns entity tag matches", async () => {
    const row = makeTestRow({
      id: "row-1",
      entity_tags: {
        fund_names: [{ name: "Apollo", aliases: [], type: "primary" }],
      },
    });

    const nameChain = mockChain({ data: [row], error: null });
    const aliasChain = mockChain({ data: [], error: null });
    const ftsChain = mockChain({ data: [], error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(nameChain)
        .mockReturnValueOnce(aliasChain)
        .mockReturnValueOnce(ftsChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const results = await searchByFundName("Apollo");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("row-1");
    expect(nameChain.contains).toHaveBeenCalledWith("entity_tags", {
      fund_names: [{ name: "Apollo" }],
    });
    expect(aliasChain.contains).toHaveBeenCalledWith("entity_tags", {
      fund_names: [{ aliases: ["Apollo"] }],
    });
  });

  it("returns full-text search matches when no entity tag hits", async () => {
    const row = makeTestRow({ id: "row-fts" });

    const nameChain = mockChain({ data: [], error: null });
    const aliasChain = mockChain({ data: [], error: null });
    const ftsChain = mockChain({ data: [row], error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(nameChain)
        .mockReturnValueOnce(aliasChain)
        .mockReturnValueOnce(ftsChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const results = await searchByFundName("Apollo");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("row-fts");
    expect(ftsChain.textSearch).toHaveBeenCalledWith(
      "transcript_search_vector",
      "Apollo",
      { type: "plain" }
    );
  });

  it("deduplicates results across tiers", async () => {
    const row = makeTestRow({ id: "shared-row" });

    // Same row found by name and FTS
    const nameChain = mockChain({ data: [row], error: null });
    const aliasChain = mockChain({ data: [], error: null });
    const ftsChain = mockChain({ data: [row], error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(nameChain)
        .mockReturnValueOnce(aliasChain)
        .mockReturnValueOnce(ftsChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const results = await searchByFundName("Apollo");

    expect(results).toHaveLength(1);
  });

  it("prioritizes entity tag matches over full-text matches", async () => {
    const tagRow = makeTestRow({ id: "tag-hit", title: "Apollo Deep Dive" });
    const ftsRow = makeTestRow({ id: "fts-hit", title: "Mentioned Apollo once" });

    const nameChain = mockChain({ data: [tagRow], error: null });
    const aliasChain = mockChain({ data: [], error: null });
    const ftsChain = mockChain({ data: [ftsRow], error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(nameChain)
        .mockReturnValueOnce(aliasChain)
        .mockReturnValueOnce(ftsChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    const results = await searchByFundName("Apollo");

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("tag-hit"); // entity tag match comes first
    expect(results[1].id).toBe("fts-hit");
  });

  it("only returns complete appearances", async () => {
    const nameChain = mockChain({ data: [], error: null });
    const aliasChain = mockChain({ data: [], error: null });
    const ftsChain = mockChain({ data: [], error: null });

    const mockClient = {
      from: vi.fn()
        .mockReturnValueOnce(nameChain)
        .mockReturnValueOnce(aliasChain)
        .mockReturnValueOnce(ftsChain),
    };
    vi.mocked(createServerClient).mockReturnValue(mockClient as any);

    await searchByFundName("Apollo");

    // All tiers filter on processing_status = complete
    expect(nameChain.eq).toHaveBeenCalledWith("processing_status", "complete");
    expect(aliasChain.eq).toHaveBeenCalledWith("processing_status", "complete");
    expect(ftsChain.eq).toHaveBeenCalledWith("processing_status", "complete");
  });
});
