import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppearanceRow } from "@lib/db/types";
import type { ScraperResult } from "@/types/scraper";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAppearanceById = vi.fn();
const mockListAppearances = vi.fn();
const mockUpdateProcessingStatus = vi.fn();
const mockWriteExtractResult = vi.fn();
const mockWriteCleanResult = vi.fn();
const mockWriteEntitiesResult = vi.fn();
const mockWriteBulletsResult = vi.fn();
const mockInvalidateFundOverviewCache = vi.fn();
const mockExtractFundNames = vi.fn();

vi.mock("@lib/db/queries", () => ({
  getAppearanceById: (...args: unknown[]) => mockGetAppearanceById(...args),
  listAppearances: (...args: unknown[]) => mockListAppearances(...args),
  updateProcessingStatus: (...args: unknown[]) =>
    mockUpdateProcessingStatus(...args),
  writeExtractResult: (...args: unknown[]) => mockWriteExtractResult(...args),
  writeCleanResult: (...args: unknown[]) => mockWriteCleanResult(...args),
  writeEntitiesResult: (...args: unknown[]) =>
    mockWriteEntitiesResult(...args),
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

const mockCleanTranscript = vi.fn();
vi.mock("@lib/pipeline/clean", () => ({
  cleanTranscript: (...args: unknown[]) => mockCleanTranscript(...args),
}));

const mockExtractEntities = vi.fn();
vi.mock("@lib/pipeline/entities", () => ({
  extractEntities: (...args: unknown[]) => mockExtractEntities(...args),
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
    raw_caption_data: null,
    cleaned_transcript: null,
    entity_tags: {},
    prep_bullets: {},
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
} from "./orchestrator";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processAppearance", () => {
  it("drives a queued row through all pipeline steps", async () => {
    mockGetAppearanceById.mockResolvedValue(makeRow());
    mockExtract.mockResolvedValue(scraperResult);
    mockCleanTranscript.mockResolvedValue({
      cleaned_transcript: "cleaned text",
    });
    mockExtractEntities.mockResolvedValue({
      entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "primary" }] },
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
      "extracting",
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
      raw_caption_data: { episodeNumber: 100, sections: [{ heading: "Intro", anchor: "intro" }] },
    });

    // Verify force: true on all write calls
    expect(mockWriteCleanResult).toHaveBeenCalledWith(
      "row-1",
      { cleaned_transcript: "cleaned text" },
      { force: true }
    );
    expect(mockWriteEntitiesResult).toHaveBeenCalledWith(
      "row-1",
      { entity_tags: { fund_names: [{ name: "Apollo", aliases: [], type: "primary" }] } },
      { force: true }
    );
    expect(mockWriteBulletsResult).toHaveBeenCalledWith(
      "row-1",
      { prep_bullets: { bullets: [], rowspace_angles: [] } },
      { force: true }
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
      "extracting",
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
