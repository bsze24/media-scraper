import { describe, it, expect } from "vitest";
import { compressIndices, parseIndices } from "./helpers";

describe("compressIndices", () => {
  it("returns empty string for empty input", () => {
    expect(compressIndices([])).toBe("");
  });

  it("handles single value", () => {
    expect(compressIndices([5])).toBe("5");
  });

  it("compresses consecutive run", () => {
    expect(compressIndices([0, 1, 2, 3])).toBe("0-3");
  });

  it("compresses mixed runs and singles", () => {
    expect(compressIndices([0, 1, 2, 10, 11, 15])).toBe("0-2,10-11,15");
  });

  it("deduplicates input", () => {
    expect(compressIndices([1, 1, 2, 2, 3])).toBe("1-3");
  });

  it("sorts unsorted input", () => {
    expect(compressIndices([3, 1, 2, 0])).toBe("0-3");
  });

  it("filters NaN values", () => {
    expect(compressIndices([1, NaN, 3])).toBe("1,3");
  });
});

describe("parseIndices", () => {
  it("returns empty array for empty string", () => {
    expect(parseIndices("")).toEqual([]);
  });

  it("parses old comma-separated format", () => {
    expect(parseIndices("0,1,2,3")).toEqual([0, 1, 2, 3]);
  });

  it("parses range format", () => {
    expect(parseIndices("0-3,10-12,15")).toEqual([0, 1, 2, 3, 10, 11, 12, 15]);
  });

  it("skips malformed tokens", () => {
    expect(parseIndices("abc,1-3,,5")).toEqual([1, 2, 3, 5]);
  });

  it("skips reversed ranges", () => {
    expect(parseIndices("5-2,10")).toEqual([10]);
  });

  it("deduplicates overlapping ranges", () => {
    expect(parseIndices("1-3,2-5")).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("round-trip", () => {
  it("compress then parse returns original", () => {
    const original = [0, 1, 2, 3, 10, 11, 12, 15];
    expect(parseIndices(compressIndices(original))).toEqual(original);
  });

  it("round-trips empty", () => {
    expect(parseIndices(compressIndices([]))).toEqual([]);
  });

  it("round-trips single value", () => {
    expect(parseIndices(compressIndices([42]))).toEqual([42]);
  });

  it("round-trips large sparse set", () => {
    const original = [0, 1, 2, 5, 10, 11, 12, 13, 14, 20, 50, 51];
    expect(parseIndices(compressIndices(original))).toEqual(original);
  });
});
