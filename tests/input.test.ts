import { parseBoolean, parseRepository } from "../src/input.js";

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
});
