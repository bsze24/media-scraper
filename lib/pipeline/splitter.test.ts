import { describe, it, expect } from "vitest";
import {
  splitForProcessing,
  mergeCleaned,
  mergeEntityTags,
  mergePrepBullets,
} from "./splitter";
import type { EntityTags } from "@/types/appearance";
import type { PrepBulletsData } from "@/types/bullets";

// ---------------------------------------------------------------------------
// splitForProcessing
// ---------------------------------------------------------------------------

describe("splitForProcessing", () => {
  it("returns single chunk for short transcript", () => {
    const text = "Patrick:\nHello world.";
    const result = splitForProcessing(text, [], 120_000);
    expect(result).toEqual([text]);
  });

  it("splits at section boundaries for long transcript", () => {
    const sectionA = "## Section A\n" + "a".repeat(70_000);
    const sectionB = "## Section B\n" + "b".repeat(70_000);
    const raw = sectionA + "\n\n" + sectionB;

    const sections = [
      { heading: "## Section A", anchor: "a" },
      { heading: "## Section B", anchor: "b" },
    ];

    const result = splitForProcessing(raw, sections, 80_000);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should be non-empty
    for (const chunk of result) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("cuts at previous section boundary to avoid oversized chunks", () => {
    // Sections at 0, 100k, 130k with 120k target
    // Should cut at 100k (not 130k) so first chunk stays under target
    const sectionA = "## Section A\n" + "a".repeat(99_987);  // ~100k total
    const sectionB = "## Section B\n" + "b".repeat(29_987);  // next 30k
    const sectionC = "## Section C\n" + "c".repeat(50_000);  // trailing
    const raw = sectionA + "\n\n" + sectionB + "\n\n" + sectionC;

    const sections = [
      { heading: "## Section A", anchor: "a" },
      { heading: "## Section B", anchor: "b" },
      { heading: "## Section C", anchor: "c" },
    ];

    const result = splitForProcessing(raw, sections, 120_000);
    expect(result.length).toBeGreaterThan(1);
    // First chunk should be ~100k (section A), not ~130k (sections A+B)
    expect(result[0].length).toBeLessThan(120_000);
  });

  it("splits at speaker turn boundaries when no sections", () => {
    // Build a transcript with many speaker blocks
    const blocks: string[] = [];
    for (let i = 0; i < 20; i++) {
      blocks.push(`Speaker${i % 2}:\n${"x".repeat(10_000)}`);
    }
    const raw = blocks.join("\n\n");

    const result = splitForProcessing(raw, [], 50_000);
    expect(result.length).toBeGreaterThan(1);
    // Verify no chunk exceeds target by too much
    for (const chunk of result) {
      expect(chunk.length).toBeLessThan(60_000); // some slack for last block
    }
  });

  it("hard-splits very long single-block text", () => {
    const raw = "x".repeat(200_000);
    const result = splitForProcessing(raw, [], 80_000);
    expect(result.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// mergeCleaned
// ---------------------------------------------------------------------------

describe("mergeCleaned", () => {
  it("joins chunks with double newlines", () => {
    expect(mergeCleaned(["a", "b", "c"])).toBe("a\n\nb\n\nc");
  });

  it("handles single chunk", () => {
    expect(mergeCleaned(["only"])).toBe("only");
  });

  it("handles empty array", () => {
    expect(mergeCleaned([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// mergeEntityTags
// ---------------------------------------------------------------------------

describe("mergeEntityTags", () => {
  it("merges empty inputs", () => {
    const result = mergeEntityTags([{}, {}]);
    expect(result).toEqual({
      fund_names: [],
      key_people: [],
      sectors_themes: [],
      portfolio_companies: [],
    });
  });

  it("deduplicates fund names case-insensitively", () => {
    const chunk1: EntityTags = {
      fund_names: [{ name: "Apollo", aliases: ["APO"], type: "standalone" }],
    };
    const chunk2: EntityTags = {
      fund_names: [
        { name: "apollo", aliases: ["Apollo Management"], type: "standalone" },
      ],
    };

    const result = mergeEntityTags([chunk1, chunk2]);
    expect(result.fund_names).toHaveLength(1);
    expect(result.fund_names![0].name).toBe("Apollo");
    // Aliases merged & deduped
    expect(result.fund_names![0].aliases).toContain("APO");
    expect(result.fund_names![0].aliases).toContain("Apollo Management");
  });

  it("merges fund parent (first non-null wins)", () => {
    const chunk1: EntityTags = {
      fund_names: [
        { name: "Athene", aliases: [], type: "subsidiary" },
      ],
    };
    const chunk2: EntityTags = {
      fund_names: [
        { name: "Athene", aliases: [], type: "subsidiary", parent: "Apollo" },
      ],
    };

    const result = mergeEntityTags([chunk1, chunk2]);
    expect(result.fund_names![0].parent).toBe("Apollo");
  });

  it("upgrades fund type from subsidiary to standalone", () => {
    const chunk1: EntityTags = {
      fund_names: [
        { name: "Athene", aliases: [], type: "subsidiary", parent: "Apollo" },
      ],
    };
    const chunk2: EntityTags = {
      fund_names: [
        { name: "Athene", aliases: [], type: "standalone" },
      ],
    };

    const result = mergeEntityTags([chunk1, chunk2]);
    expect(result.fund_names![0].type).toBe("standalone");
    // parent preserved from first chunk
    expect(result.fund_names![0].parent).toBe("Apollo");
  });

  it("deduplicates key people case-insensitively", () => {
    const chunk1: EntityTags = {
      key_people: [
        { name: "Marc Rowan", title: "CEO", fund_affiliation: "Apollo" },
      ],
    };
    const chunk2: EntityTags = {
      key_people: [
        { name: "marc rowan", title: "", fund_affiliation: "" },
      ],
    };

    const result = mergeEntityTags([chunk1, chunk2]);
    expect(result.key_people).toHaveLength(1);
    expect(result.key_people![0].title).toBe("CEO");
  });

  it("deduplicates sectors and companies case-insensitively", () => {
    const chunk1: EntityTags = {
      sectors_themes: ["Private Credit", "CLOs"],
      portfolio_companies: ["Acme Inc"],
    };
    const chunk2: EntityTags = {
      sectors_themes: ["private credit", "Real Estate"],
      portfolio_companies: ["acme inc", "Beta Corp"],
    };

    const result = mergeEntityTags([chunk1, chunk2]);
    expect(result.sectors_themes).toEqual([
      "Private Credit",
      "CLOs",
      "Real Estate",
    ]);
    expect(result.portfolio_companies).toEqual(["Acme Inc", "Beta Corp"]);
  });
});

// ---------------------------------------------------------------------------
// mergePrepBullets
// ---------------------------------------------------------------------------

describe("mergePrepBullets", () => {
  it("deduplicates bullets by exact text match", () => {
    const chunk1: PrepBulletsData = {
      bullets: [
        {
          text: "Apollo is expanding",
          supporting_quotes: [],
          vote: null,
          vote_note: null,
        },
      ],
      rowspace_angles: [],
    };
    const chunk2: PrepBulletsData = {
      bullets: [
        {
          text: "Apollo is expanding",
          supporting_quotes: [],
          vote: null,
          vote_note: null,
        },
        {
          text: "New bullet",
          supporting_quotes: [],
          vote: null,
          vote_note: null,
        },
      ],
      rowspace_angles: [],
    };

    const result = mergePrepBullets([chunk1, chunk2]);
    expect(result.bullets).toHaveLength(2);
    expect(result.bullets![0].text).toBe("Apollo is expanding");
    expect(result.bullets![1].text).toBe("New bullet");
  });

  it("deduplicates rowspace_angles by exact text", () => {
    const chunk1: PrepBulletsData = {
      bullets: [],
      rowspace_angles: [{ text: "Angle A", vote: null, vote_note: null }],
    };
    const chunk2: PrepBulletsData = {
      bullets: [],
      rowspace_angles: [
        { text: "Angle A", vote: null, vote_note: null },
        { text: "Angle B", vote: null, vote_note: null },
      ],
    };

    const result = mergePrepBullets([chunk1, chunk2]);
    expect(result.rowspace_angles).toHaveLength(2);
  });

  it("handles empty inputs", () => {
    const result = mergePrepBullets([{}, {}]);
    expect(result).toEqual({ bullets: [], rowspace_angles: [] });
  });
});
