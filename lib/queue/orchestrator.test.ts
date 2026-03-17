import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppearanceRow } from "@lib/db/types";
import type { ScraperResult } from "@/types/scraper";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAppearanceById = vi.fn();
const mockListAppearances = vi.fn();
const mockUpdateProcessingStatus = vi.fn();
const mockClaimForProcessing = vi.fn();
const mockWriteExtractResult = vi.fn();
const mockWriteCleanResult = vi.fn();
const mockWriteEntitiesResult = vi.fn();
const mockWriteTurnSummaries = vi.fn();
const mockUpdateProcessingError = vi.fn();
const mockWriteBulletsResult = vi.fn();
const mockInvalidateFundOverviewCache = vi.fn();
const mockExtractFundNames = vi.fn();
const mockAppendProcessingWarning = vi.fn();
const mockRemoveProcessingWarning = vi.fn();

vi.mock("@lib/db/queries", () => ({
  getAppearanceById: (...args: unknown[]) => mockGetAppearanceById(...args),
  listAppearances: (...args: unknown[]) => mockListAppearances(...args),
  updateProcessingStatus: (...args: unknown[]) =>
    mockUpdateProcessingStatus(...args),
  claimForProcessing: (...args: unknown[]) => mockClaimForProcessing(...args),
  writeExtractResult: (...args: unknown[]) => mockWriteExtractResult(...args),
  writeCleanResult: (...args: unknown[]) => mockWriteCleanResult(...args),
  writeEntitiesResult: (...args: unknown[]) =>
    mockWriteEntitiesResult(...args),
  writeTurnSummaries: (...args: unknown[]) => mockWriteTurnSummaries(...args),
  updateProcessingError: (...args: unknown[]) => mockUpdateProcessingError(...args),
  appendProcessingWarning: (...args: unknown[]) => mockAppendProcessingWarning(...args),
  removeProcessingWarning: (...args: unknown[]) => mockRemoveProcessingWarning(...args),
  writeBulletsResult: (...args: unknown[]) => mockWriteBulletsResult(...args),
  invalidateFundOverviewCache: (...args: unknown[]) =>
    mockInvalidateFundOverviewCache(...args),
  extractFundNames: (...args: unknown[]) => mockExtractFundNames(...args),
}));

const mockExtract = vi.fn();
vi.mock("@lib/scrapers/registry", () => ({
  getScraperForUrl: () => ({ canHandle: () => true, extract: mockExtract }),
}));

const mockColossusDelay = vi.fn().mockResolvedValue(undefined);
vi.mock("@lib/scrapers/colossus", () => ({
  colossusDelay: () => mockColossusDelay(),
}));

const mockParseTurns = vi.fn();
vi.mock("@lib/scrapers/parse-turns", () => ({
  parseTurns: (...args: unknown[]) => mockParseTurns(...args),
}));

const mockSplitForProcessing = vi.fn();
const mockMergeCleaned = vi.fn();
const mockMergeEntityTags = vi.fn();
const mockMergePrepBullets = vi.fn();
vi.mock("@lib/pipeline/splitter", () => ({
  splitForProcessing: (...args: unknown[]) => mockSplitForProcessing(...args),
  mergeCleaned: (...args: unknown[]) => mockMergeCleaned(...args),
  mergeEntityTags: (...args: unknown[]) => mockMergeEntityTags(...args),
  mergePrepBullets: (...args: unknown[]) => mockMergePrepBullets(...args),
}));

const mockCleanTranscript = vi.fn();
vi.mock("@lib/pipeline/clean", () => ({
  cleanTranscript: (...args: unknown[]) => mockCleanTranscript(...args),
}));

const mockExtractEntities = vi.fn();
vi.mock("@lib/pipeline/entities", () => ({
  extractEntities: (...args: unknown[]) => mockExtractEntities(...args),
}));

const mockGenerateTurnSummaries = vi.fn();
vi.mock("@lib/pipeline/turn-summaries", () => ({
  generateTurnSummaries: (...args: unknown[]) =>
    mockGenerateTurnSummaries(...args),
}));

const mockGeneratePrepBullets = vi.fn();
vi.mock("@lib/pipeline/bullets", () => ({
  generatePrepBullets: (...args: unknown[]) =>
    mockGeneratePrepBullets(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<AppearanceRow> = {}): AppearanceRow {
  return {
    id: "row-1",
    source_url: "https://www.colossus.com/episodes/test",
    transcript_source: "colossus",
    source_name: null,
    title: null,
    appearance_date: null,
    speakers: [],
    raw_transcript: null,
    scraper_metadata: null,
    cleaned_transcript: null,
    entity_tags: {},
    prep_bullets: {},
    turns: null,
    turn_summaries: null,
    sections: [],
    prompt_context_snapshot: null,
    bullets_generated_at: null,
    processing_status: "queued",
    processing_error: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const scraperResult: ScraperResult = {
  title: "Test Episode",
  appearanceDate: "2026-01-15",
  sourceName: "Invest Like the Best",
  transcriptSource: "colossus",
  speakers: [{ name: "Patrick", role: "host" }],
  rawTranscript: "Patrick:\nHello world",
  captionData: { episodeNumber: 100, sections: [{ heading: "Intro", anchor: "intro" }] },
  sections: [{ heading: "Intro", anchor: "intro" }],
  sourceUrl: "https://www.colossus.com/episodes/test",
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  processAppearance,
  processBatch,
  processOne,
  reprocessBullets,
  reprocessTurnSummaries,
} from "./orchestrator";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: parseTurns returns a simple turn array
  mockParseTurns.mockReturnValue([
    { speaker: "Patrick", text: "Hello world", turn_index: 0 },
  ]);
  // Default: claim always succeeds
  mockClaimForProcessing.mockResolvedValue(true);
  // Default: turn summaries returns matching result
  mockGenerateTurnSummaries.mockResolvedValue({
    summaries: [{ speaker: "Patrick", summary: "Says hello", turn_index: 0 }],
  });
});

describe("processAppearance", () => {
  it("drives a queued row through all pipeline steps", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({
      cleaned_transcript: "cleaned text",
    });
    mockExtractEntities.mockResolvedValue({
      entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "standalone" }] },
    });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [], rowspace_angles: [] },
    });
    mockExtractFundNames.mockReturnValue(["Apollo"]);

    await processAppearance("row-1");

    // Verify status transitions in order
    const statusCalls = mockUpdateProcessingStatus.mock.calls.map(
      (c: unknown[]) => c[1]
    );
    expect(statusCalls).toEqual([
      "cleaning",
      "analyzing",
      "complete",
    ]);

    // Verify extract output maps ScraperResult fields correctly
    expect(mockWriteExtractResult).toHaveBeenCalledWith("row-1", {
      title: "Test Episode",
      appearance_date: "2026-01-15",
      source_name: "Invest Like the Best",
      speakers: [{ name: "Patrick", role: "host" }],
      raw_transcript: "Patrick:\nHello world",
      scraper_metadata: { episodeNumber: 100, sections: [{ heading: "Intro", anchor: "intro" }] },
      turns: [{ speaker: "Patrick", text: "Hello world", turn_index: 0 }],
      sections: [{ heading: "Intro", anchor: "intro" }],
    });

    // Verify write calls
    expect(mockWriteCleanResult).toHaveBeenCalledWith(
      "row-1",
      { cleaned_transcript: "cleaned text" },
    );
    expect(mockWriteEntitiesResult).toHaveBeenCalledWith(
      "row-1",
      { entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "standalone" }] } },
    );
    expect(mockWriteBulletsResult).toHaveBeenCalledWith(
      "row-1",
      { prep_bullets: { bullets: [], rowspace_angles: [] } },
    );

    // Verify fund cache invalidated
    expect(mockInvalidateFundOverviewCache).toHaveBeenCalledWith(["Apollo"]);
  });

  it("passes sections from ScraperResult to generatePrepBullets", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({
      cleaned_transcript: "cleaned",
    });
    mockExtractEntities.mockResolvedValue({ entity_tags: {} });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    await processAppearance("row-1");

    expect(mockGeneratePrepBullets).toHaveBeenCalledWith(
      "cleaned",
      {},
      [{ heading: "Intro", anchor: "intro" }],
      "colossus"
    );
  });

  it("sets status to failed on scraper error", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockRejectedValue(new Error("Content gate detected"));

    await expect(processAppearance("row-1")).rejects.toThrow(
      "Content gate detected"
    );

    expect(mockUpdateProcessingStatus).toHaveBeenCalledWith(
      "row-1",
      "failed",
      "Content gate detected"
    );
  });

  it("sets status to failed on LLM error", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockRejectedValue(new Error("API rate limit"));

    await expect(processAppearance("row-1")).rejects.toThrow("API rate limit");

    expect(mockUpdateProcessingStatus).toHaveBeenCalledWith(
      "row-1",
      "failed",
      "API rate limit"
    );
  });

  it("rejects row with status 'complete'", async () => {
    mockGetAppearanceById.mockResolvedValue(
      makeRow({ processing_status: "complete" })
    );

    await expect(processAppearance("row-1")).rejects.toThrow(
      'expected "queued" or "failed"'
    );

    // No pipeline calls should have been made
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockCleanTranscript).not.toHaveBeenCalled();
    expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
  });

  it("allows retrying a failed row", async () => {
    mockGetAppearanceById.mockResolvedValue(
      makeRow({ processing_status: "failed" })
    );
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({
      cleaned_transcript: "cleaned",
    });
    mockExtractEntities.mockResolvedValue({ entity_tags: {} });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    await processAppearance("row-1");

    const statusCalls = mockUpdateProcessingStatus.mock.calls.map(
      (c: unknown[]) => c[1]
    );
    expect(statusCalls).toEqual([
      "cleaning",
      "analyzing",
      "complete",
    ]);
  });
});

describe("processBatch", () => {
  it("returns correct processed/failed counts", async () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" }), makeRow({ id: "c" })];
    mockListAppearances.mockResolvedValue(rows);

    // a succeeds, b fails, c succeeds
    mockGetAppearanceById
      .mockResolvedValueOnce(makeRow({ id: "a" }))
      .mockResolvedValueOnce(makeRow({ id: "b" }))
      .mockResolvedValueOnce(makeRow({ id: "c" }));

    mockExtract
      .mockResolvedValueOnce(scraperResult)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(scraperResult);

    mockCleanTranscript.mockResolvedValue({ cleaned_transcript: "cleaned" });
    mockExtractEntities.mockResolvedValue({ entity_tags: {} });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    const result = await processBatch(10);

    expect(result).toEqual({ processed: 2, failed: 1 });
  });

  it("calls colossusDelay between items but not after last", async () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
    mockListAppearances.mockResolvedValue(rows);

    mockGetAppearanceById
      .mockResolvedValueOnce(makeRow({ id: "a" }))
      .mockResolvedValueOnce(makeRow({ id: "b" }));

    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({ cleaned_transcript: "cleaned" });
    mockExtractEntities.mockResolvedValue({ entity_tags: {} });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    await processBatch(10);

    // Should be called once (between item 0 and 1), not twice
    expect(mockColossusDelay).toHaveBeenCalledTimes(1);
  });
});

describe("processOne", () => {
  it("returns success on happy path", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({ cleaned_transcript: "cleaned" });
    mockExtractEntities.mockResolvedValue({ entity_tags: {} });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    const result = await processOne("row-1");
    expect(result).toEqual({ success: true });
  });

  it("returns error without throwing", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockRejectedValue(new Error("boom"));

    const result = await processOne("row-1");
    expect(result).toEqual({ success: false, error: "boom" });
  });
});

describe("reprocessBullets", () => {
  const completeRow = makeRow({
    processing_status: "complete",
    title: "Test Episode",
    cleaned_transcript: "cleaned text",
    entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "standalone" }] },
    sections: [{ heading: "Intro", anchor: "intro" }],
    transcript_source: "colossus",
  });

  it("calls generatePrepBullets with correct args from DB row", async () => {
    mockGetAppearanceById.mockResolvedValue(completeRow);
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [{ text: "b1" }], rowspace_angles: [] },
      prompt_context_snapshot: "snapshot",
    });
    mockExtractFundNames.mockReturnValue(["Apollo"]);

    await reprocessBullets("row-1");

    expect(mockGeneratePrepBullets).toHaveBeenCalledWith(
      "cleaned text",
      { fund_names: [{ name: "Apollo", aliases: [], type: "standalone" }] },
      [{ heading: "Intro", anchor: "intro" }],
      "colossus"
    );
    expect(mockWriteBulletsResult).toHaveBeenCalledWith(
      "row-1",
      {
        prep_bullets: { bullets: [{ text: "b1" }], rowspace_angles: [] },
        prompt_context_snapshot: "snapshot",
      },
      { force: true }
    );
    expect(mockInvalidateFundOverviewCache).toHaveBeenCalledWith(["Apollo"]);
  });

  it("does not call scraping, cleaning, or entity extraction", async () => {
    mockGetAppearanceById.mockResolvedValue(completeRow);
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    await reprocessBullets("row-1");

    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockCleanTranscript).not.toHaveBeenCalled();
    expect(mockExtractEntities).not.toHaveBeenCalled();
  });

  it("throws if cleaned_transcript is null", async () => {
    mockGetAppearanceById.mockResolvedValue(
      makeRow({
        processing_status: "complete",
        cleaned_transcript: null,
        entity_tags: { fund_names: [] },
      })
    );

    await expect(reprocessBullets("row-1")).rejects.toThrow(
      "No cleaned_transcript"
    );
  });

  it("throws if entity_tags is empty", async () => {
    mockGetAppearanceById.mockResolvedValue(
      makeRow({
        processing_status: "complete",
        cleaned_transcript: "text",
        entity_tags: {},
      })
    );

    await expect(reprocessBullets("row-1")).rejects.toThrow(
      "No entity_tags"
    );
  });

  it("does not change processing_status", async () => {
    mockGetAppearanceById.mockResolvedValue(completeRow);
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    await reprocessBullets("row-1");

    expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
  });
});

describe("processAppearance — chunked path", () => {
  const longTranscript = "x".repeat(130_000); // >120k threshold
  const longScraperResult: ScraperResult = {
    ...scraperResult,
    rawTranscript: longTranscript,
  };

  it("uses chunking for transcripts >= 120k chars", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(longScraperResult);

    // splitForProcessing returns 2 chunks for the raw transcript
    mockSplitForProcessing.mockReturnValue(["chunk1_raw", "chunk2_raw"]);

    // Clean step: each chunk produces cleaned output
    mockCleanTranscript
      .mockResolvedValueOnce({ cleaned_transcript: "chunk1_clean" })
      .mockResolvedValueOnce({ cleaned_transcript: "chunk2_clean" });
    mockMergeCleaned.mockReturnValue("merged_clean");

    // Entity step: re-split the cleaned text, then extract from each chunk
    mockExtractEntities
      .mockResolvedValueOnce({
        entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "standalone" }] },
      })
      .mockResolvedValueOnce({
        entity_tags: { fund_names: [{ name: "Bridgewater", aliases: [], type: "standalone" }] },
      });
    mockMergeEntityTags.mockReturnValue({
      fund_names: [
        { name: "Apollo", aliases: [], type: "standalone" },
        { name: "Bridgewater", aliases: [], type: "standalone" },
      ],
    });

    // Bullets step
    mockGeneratePrepBullets
      .mockResolvedValueOnce({
        prep_bullets: { bullets: [{ text: "b1" }], rowspace_angles: [] },
      })
      .mockResolvedValueOnce({
        prep_bullets: { bullets: [{ text: "b2" }], rowspace_angles: [] },
      });
    mockMergePrepBullets.mockReturnValue({
      bullets: [{ text: "b1" }, { text: "b2" }],
      rowspace_angles: [],
    });

    mockExtractFundNames.mockReturnValue(["Apollo", "Bridgewater"]);

    await processAppearance("row-1");

    // splitForProcessing called for raw transcript
    expect(mockSplitForProcessing).toHaveBeenCalled();

    // cleanTranscript called once per chunk
    expect(mockCleanTranscript).toHaveBeenCalledTimes(2);
    expect(mockMergeCleaned).toHaveBeenCalledWith(["chunk1_clean", "chunk2_clean"]);

    // extractEntities called for each cleaned chunk
    expect(mockExtractEntities).toHaveBeenCalledTimes(2);
    expect(mockMergeEntityTags).toHaveBeenCalled();

    // generatePrepBullets called for each cleaned chunk
    expect(mockGeneratePrepBullets).toHaveBeenCalledTimes(2);
    expect(mockMergePrepBullets).toHaveBeenCalled();

    // Final write calls use merged results
    expect(mockWriteCleanResult).toHaveBeenCalledWith(
      "row-1",
      { cleaned_transcript: "merged_clean" },
    );
    expect(mockWriteBulletsResult).toHaveBeenCalledWith(
      "row-1",
      {
        prep_bullets: {
          bullets: [{ text: "b1" }, { text: "b2" }],
          rowspace_angles: [],
        },
      },
    );

    // Status transitions still correct
    const statusCalls = mockUpdateProcessingStatus.mock.calls.map(
      (c: unknown[]) => c[1]
    );
    expect(statusCalls).toEqual([
      "cleaning",
      "analyzing",
      "complete",
    ]);
  });

  it("does not chunk short transcripts", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult); // short transcript
    mockCleanTranscript.mockResolvedValue({ cleaned_transcript: "cleaned" });
    mockExtractEntities.mockResolvedValue({ entity_tags: {} });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [] },
    });
    mockExtractFundNames.mockReturnValue([]);

    await processAppearance("row-1");

    // splitForProcessing should not be called for short transcripts
    expect(mockSplitForProcessing).not.toHaveBeenCalled();
    expect(mockMergeCleaned).not.toHaveBeenCalled();
    expect(mockMergeEntityTags).not.toHaveBeenCalled();
    expect(mockMergePrepBullets).not.toHaveBeenCalled();

    // Single-pass pipeline
    expect(mockCleanTranscript).toHaveBeenCalledTimes(1);
    expect(mockExtractEntities).toHaveBeenCalledTimes(1);
    expect(mockGeneratePrepBullets).toHaveBeenCalledTimes(1);
  });
});

describe("pipeline validations", () => {
  // A transcript long enough to pass extract_too_short (>=500 chars)
  const normalTranscript = "x".repeat(600);

  function setupHappyPath(overrides: Partial<ScraperResult> = {}) {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue({ ...scraperResult, rawTranscript: normalTranscript, ...overrides });
    // Cleaned output within normal ratio range (0.30–1.50) of 600 chars
    mockCleanTranscript.mockResolvedValue({ cleaned_transcript: "c".repeat(400) });
    mockExtractEntities.mockResolvedValue({
      entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "primary" }] },
    });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [{ text: "b1" }, { text: "b2" }, { text: "b3" }], rowspace_angles: [] },
    });
    mockExtractFundNames.mockReturnValue(["Apollo"]);
  }

  it("does not append warnings on a normal successful run", async () => {
    setupHappyPath();
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).not.toHaveBeenCalled();
  });

  it("appends extract_too_short when rawTranscript < 500 chars", async () => {
    setupHappyPath({ rawTranscript: "short" });
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("extract_too_short")
    );
  });

  it("appends clean_ratio_warning when ratio is too low", async () => {
    // rawTranscript is ~20 chars from scraperResult, cleaned is 12000 chars
    // We need raw > cleaned*3.33 for ratio < 0.30
    const longRaw = "x".repeat(10_000);
    setupHappyPath({ rawTranscript: longRaw });
    // cleaned_transcript is only "cleaned text" (12 chars) → ratio ~0.001
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("clean_ratio_warning")
    );
  });

  it("appends turns_low_count when few turns from long transcript", async () => {
    const longRaw = "x".repeat(15_000);
    setupHappyPath({ rawTranscript: longRaw });
    // mockParseTurns returns 1 turn by default (from beforeEach)
    // Cleaned text is short so clean_ratio_warning also fires, that's fine
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("turns_low_count")
    );
  });

  it("appends turn_summaries_incomplete when summaries have warning", async () => {
    setupHappyPath();
    mockGenerateTurnSummaries.mockResolvedValue({
      summaries: [{ speaker: "Patrick", summary: "Says hello", turn_index: 0 }],
      warning: "turn_summaries_incomplete: expected 2, got 1, missing turn_indexes: [1]",
    });
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("turn_summaries_incomplete")
    );
  });

  it("appends entities_no_funds on substantial transcript with no funds", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    // Cleaned transcript > 10k chars
    mockCleanTranscript.mockResolvedValue({
      cleaned_transcript: "c".repeat(15_000),
    });
    mockExtractEntities.mockResolvedValue({ entity_tags: { fund_names: [] } });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [{ text: "b1" }, { text: "b2" }, { text: "b3" }], rowspace_angles: [] },
    });
    mockExtractFundNames.mockReturnValue([]);
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("entities_no_funds")
    );
  });

  it("appends bullets_low_count on substantial transcript with few bullets", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({
      cleaned_transcript: "c".repeat(15_000),
    });
    mockExtractEntities.mockResolvedValue({
      entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "primary" }] },
    });
    mockGeneratePrepBullets.mockResolvedValue({
      prep_bullets: { bullets: [{ text: "b1" }], rowspace_angles: [] },
    });
    mockExtractFundNames.mockReturnValue(["Apollo"]);
    await processAppearance("row-1");
    expect(mockAppendProcessingWarning).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("bullets_low_count")
    );
  });

  it("still completes successfully with warnings — status is 'complete'", async () => {
    setupHappyPath({ rawTranscript: "short" }); // triggers extract_too_short
    await processAppearance("row-1");
    const statusCalls = mockUpdateProcessingStatus.mock.calls.map(
      (c: unknown[]) => c[1]
    );
    expect(statusCalls).toContain("complete");
  });
});
