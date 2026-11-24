import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, isSubjectCode, parseTags, typeLabel } from "./format.js";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1048576, "1 MB"],
    [26214400, "25 MB"],
    [1288490189, "1.2 GB"],
  ])("%d -> %s", (bytes, text) => expect(formatBytes(bytes)).toBe(text));

  it("shows a dash for a missing size", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});

describe("formatDate", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it.each([
    ["2026-11-20T11:59:40.000000Z", "just now"],
    ["2026-11-20T11:15:00.000000Z", "45 min ago"],
    ["2026-11-20T07:00:00.000000Z", "5 hr ago"],
    ["2026-11-19T10:00:00.000000Z", "yesterday"],
    ["2026-11-15T12:00:00.000000Z", "5 days ago"],
    ["2026-09-01T12:00:00.000000Z", "1 Sep 2026"],
  ])("%s -> %s", (iso, text) => expect(formatDate(iso, now)).toBe(text));

  it("returns an empty string for an unreadable date", () => {
    expect(formatDate("not a date", now)).toBe("");
  });
});

describe("parseTags", () => {
  it("splits on commas, trims, lower-cases and removes repeats and blanks", () => {
    expect(parseTags(" AWS, lambda ,aws,, S3 ")).toEqual(["aws", "lambda", "s3"]);
  });
  it("gives an empty list for empty input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe("typeLabel", () => {
  it("turns a resource type into words", () => {
    expect(typeLabel("question-paper")).toBe("Question paper");
    expect(typeLabel("notes")).toBe("Notes");
  });
});

describe("isSubjectCode", () => {
  it.each(["UCS531", "ucs531", " UMA010 ", "CS101", "ABCD123"])("accepts %s", (code) => expect(isSubjectCode(code)).toBe(true));
  it.each(["", "UCS", "531", "UCS5311", "U531", "UCS-531", undefined])("rejects %s", (code) => expect(isSubjectCode(code)).toBe(false));
});
