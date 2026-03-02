import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseColossusHtml,
  parseColossusDate,
  colossusScraper,
} from "./colossus";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(__dirname, "../../colossus-439.html");
const RAW_HTML = readFileSync(FIXTURE_PATH, "utf-8");

/** Fixture with the content gate div removed so parseColossusHtml succeeds. */
const HTML_NO_GATE = RAW_HTML.replace(
  /<div class="content-gate-obscure"><\/div>/g,
  ""
);

const TEST_URL =
  "https://www.colossus.com/episode/building-alpha-school-and-the-future-of-education/";

// ---------------------------------------------------------------------------
// parseColossusDate
// ---------------------------------------------------------------------------

describe("parseColossusDate", () => {
  it("converts MM.DD.YYYY to ISO date", () => {
    expect(parseColossusDate("08.26.2025")).toBe("2025-08-26");
  });

  it("converts 01.01.2000", () => {
    expect(parseColossusDate("01.01.2000")).toBe("2000-01-01");
  });

  it("returns null for empty string", () => {
    expect(parseColossusDate("")).toBeNull();
  });

  it("returns null for invalid format", () => {
    expect(parseColossusDate("2025-08-26")).toBeNull();
    expect(parseColossusDate("8.26.2025")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseColossusHtml — metadata
// ---------------------------------------------------------------------------

describe("parseColossusHtml", () => {
  const result = parseColossusHtml(HTML_NO_GATE, TEST_URL);

  it("extracts the episode title", () => {
    expect(result.title).toBe(
      "Building Alpha School, and The Future of Education"
    );
  });

  it("parses the date to ISO format", () => {
    expect(result.appearanceDate).toBe("2025-08-26");
  });

  it("sets transcriptSource to colossus", () => {
    expect(result.transcriptSource).toBe("colossus");
  });

  it("extracts the podcast / source name", () => {
    expect(result.sourceName).toBe("Invest Like the Best");
  });

  it("preserves the source URL", () => {
    expect(result.sourceUrl).toBe(TEST_URL);
  });

  // -------------------------------------------------------------------------
  // Episode number in captionData
  // -------------------------------------------------------------------------

  it("stores episodeNumber in captionData", () => {
    expect(result.captionData).toHaveProperty("episodeNumber", 439);
  });

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  it("extracts section headings", () => {
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    expect(result.sections[0]).toEqual({
      heading: "Introduction",
      anchor: "introduction",
    });
  });

  it("also stores sections in captionData", () => {
    const cd = result.captionData as { sections: unknown[] };
    expect(cd.sections).toEqual(result.sections);
  });

  // -------------------------------------------------------------------------
  // Speakers
  // -------------------------------------------------------------------------

  it("detects speakers with correct roles", () => {
    expect(result.speakers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Patrick", role: "host" }),
      ])
    );
  });

  // -------------------------------------------------------------------------
  // Transcript text
  // -------------------------------------------------------------------------

  it("starts the transcript with the first speaker header", () => {
    expect(result.rawTranscript).toMatch(/^Patrick:\n/);
  });

  it("includes all visible paragraphs in the transcript", () => {
    expect(result.rawTranscript).toContain("My guest today is Joe Liemandt");
    expect(result.rawTranscript).toContain(
      "AI tutoring system so effective"
    );
    expect(result.rawTranscript).toContain(
      "trillion-dollar market"
    );
  });

  it("concatenates continuation paragraphs under the same speaker", () => {
    // All 3 paragraphs are from Patrick — should be a single block
    const blocks = result.rawTranscript.split("\n\n");
    // Only one speaker block since all paragraphs belong to Patrick
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatch(/^Patrick:\n/);
  });
});

// ---------------------------------------------------------------------------
// Content gate detection
// ---------------------------------------------------------------------------

describe("content gate detection", () => {
  it("throws when content-gate-obscure div is present", () => {
    expect(() => parseColossusHtml(RAW_HTML, TEST_URL)).toThrow(
      /content gate detected/i
    );
  });
});

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe("colossusScraper.canHandle", () => {
  it("accepts www.colossus.com URLs", () => {
    expect(
      colossusScraper.canHandle(
        "https://www.colossus.com/episode/some-episode/"
      )
    ).toBe(true);
  });

  it("accepts colossus.com without www", () => {
    expect(
      colossusScraper.canHandle("https://colossus.com/episode/some-episode/")
    ).toBe(true);
  });

  it("rejects non-colossus URLs", () => {
    expect(colossusScraper.canHandle("https://youtube.com/watch?v=abc")).toBe(
      false
    );
    expect(colossusScraper.canHandle("https://example.com")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(colossusScraper.canHandle("not a url")).toBe(false);
  });
});
