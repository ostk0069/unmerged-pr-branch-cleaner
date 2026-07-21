import {
  parseBoolean,
  parseInteger,
  parsePatterns,
  parseRepository,
} from "../src/input.js";

describe("input parsers", () => {
  test("parses booleans case-insensitively", () => {
    expect(parseBoolean(" TRUE ", "value")).toBe(true);
    expect(parseBoolean("false", "value")).toBe(false);
  });
  test("rejects invalid booleans", () =>
    expect(() => parseBoolean("yes", "dry-run")).toThrow("dry-run"));
  test("parses repository", () =>
    expect(parseRepository("owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    }));
  test.each(["repo", "/repo", "owner/", "a/b/c"])(
    "rejects repository %s",
    (value) => {
      expect(() => parseRepository(value)).toThrow("owner/name");
    },
  );
  test("parses integers and patterns", () => {
    expect(parseInteger(" 20 ", "max", 1)).toBe(20);
    expect(parsePatterns("release/**, keep\nfoo")).toEqual([
      "release/**",
      "keep",
      "foo",
    ]);
  });
  test.each(["-1", "1.5", "wat"])("rejects integer %s", (value) => {
    expect(() => parseInteger(value, "days", 0)).toThrow("days");
  });
  test("rejects an integer outside JavaScript's safe range", () => {
    expect(() => parseInteger("999999999999999999999", "max", 1)).toThrow(
      "max",
    );
  });
});
