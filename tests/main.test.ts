import { jest } from "@jest/globals";
import type { CleanupResult } from "../src/types.js";

const inputs: Record<string, string> = {
  "github-token": "token",
  "dry-run": "false",
  "max-deletions": "20",
  "exclude-branches": "release/**",
  "minimum-closed-age-days": "7",
  "allow-fork-repositories": "false",
};
const getInput = jest.fn((name: string) => inputs[name] ?? "");
const setOutput = jest.fn();
const setFailed = jest.fn();
const setSecret = jest.fn();
const summary = {
  addHeading: jest.fn(),
  addTable: jest.fn(),
  addRaw: jest.fn(),
  write: jest.fn(),
};
summary.addHeading.mockImplementation(() => summary);
summary.addTable.mockImplementation(() => summary);
summary.addRaw.mockImplementation(() => summary);
summary.write.mockImplementation(async () => summary);

const cleanBranches = jest.fn<() => Promise<CleanupResult>>();
const createGitHubClient = jest.fn(() => ({ client: true }));
jest.unstable_mockModule("@actions/core", () => ({
  getInput,
  setOutput,
  setFailed,
  setSecret,
  summary,
  info: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));
jest.unstable_mockModule("../src/cleaner.js", () => ({ cleanBranches }));
jest.unstable_mockModule("../src/github-client.js", () => ({
  createGitHubClient,
}));
const { escapeHtml, run, truncateJsonArray } = await import("../src/main.js");

function result(overrides: Partial<CleanupResult> = {}): CleanupResult {
  return {
    candidateBranches: [],
    deletedBranches: [],
    skippedBranches: [],
    failedBranches: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  summary.addHeading.mockImplementation(() => summary);
  summary.addTable.mockImplementation(() => summary);
  summary.addRaw.mockImplementation(() => summary);
  summary.write.mockImplementation(async () => summary);
  process.env.GITHUB_REPOSITORY = "owner/repo";
});

test("masks token, parses safety inputs, and writes totals", async () => {
  cleanBranches.mockResolvedValueOnce(
    result({ candidateBranches: ["deleted"], deletedBranches: ["deleted"] }),
  );
  await run();
  expect(setSecret).toHaveBeenCalledWith("token");
  expect(cleanBranches).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      maxDeletions: 20,
      excludedBranches: ["release/**"],
      minimumClosedAgeDays: 7,
      allowForkRepositories: false,
    }),
  );
  expect(setOutput).toHaveBeenCalledWith("deleted-count", 1);
  expect(setOutput).toHaveBeenCalledWith("deleted-total", 1);
  expect(setOutput).toHaveBeenCalledWith("candidate-count", 1);
  expect(summary.write).toHaveBeenCalled();
  expect(setFailed).not.toHaveBeenCalled();
});

test("fails on branch failures and fatal errors after writing outputs", async () => {
  cleanBranches.mockResolvedValueOnce(
    result({ failedBranches: [{ branch: "bad", reason: "rule" }] }),
  );
  await run();
  expect(setFailed).toHaveBeenCalledWith(
    "1 branch(es) could not be safely processed.",
  );
  cleanBranches.mockResolvedValueOnce(result({ fatalError: "cap exceeded" }));
  await run();
  expect(setFailed).toHaveBeenCalledWith("cap exceeded");
});

test("keeps safe initial outputs when discovery throws", async () => {
  cleanBranches.mockRejectedValueOnce(new Error("discovery failed"));
  await run();
  expect(setOutput).toHaveBeenCalledWith("candidate-branches", "[]");
  expect(setFailed).toHaveBeenCalledWith("discovery failed");
  cleanBranches.mockRejectedValueOnce("non-error failure");
  await run();
  expect(setFailed).toHaveBeenCalledWith("non-error failure");
});

test.each([50, 51])("summary limits %s detail results", async (count) => {
  cleanBranches.mockResolvedValueOnce(
    result({
      deletedBranches: Array.from(
        { length: count },
        (_, index) => `branch-${index}`,
      ),
    }),
  );
  await run();
  const tableCalls = summary.addTable.mock.calls as unknown as [
    [unknown[]],
    [unknown[]],
  ];
  expect(tableCalls[1][0]).toHaveLength(51);
  if (count === 51)
    expect(summary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining("1 additional"),
    );
  else expect(summary.addRaw).not.toHaveBeenCalled();
});

test("escapes every untrusted summary cell", async () => {
  const malicious = "feature/</td><tr><td>Deleted&\"'";
  cleanBranches.mockResolvedValueOnce(
    result({ skippedBranches: [{ branch: malicious, reason: malicious }] }),
  );
  await run();
  const tableCalls = summary.addTable.mock.calls as unknown as [
    [unknown[]],
    [string[][]],
  ];
  expect(JSON.stringify(tableCalls[1][0])).not.toContain("</td>");
  expect(JSON.stringify(tableCalls[1][0])).toContain("&lt;/td&gt;");
  expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
});

test("truncates large JSON outputs below their byte budget", () => {
  const values = Array.from(
    { length: 100 },
    (_, index) => `${index}-${"界".repeat(100)}`,
  );
  const output = truncateJsonArray(values, 1000);
  expect(output.truncated).toBe(true);
  expect(Buffer.byteLength(output.json)).toBeLessThanOrEqual(1000);
  expect(() => JSON.parse(output.json)).not.toThrow();
  expect(truncateJsonArray(["small"], 1000).truncated).toBe(false);
});

test("reports truncation while preserving total counts", async () => {
  const branches = Array.from(
    { length: 2_000 },
    (_, index) => `branch-${index}-${"x".repeat(100)}`,
  );
  cleanBranches.mockResolvedValueOnce(
    result({ candidateBranches: branches, deletedBranches: branches }),
  );
  await run();
  expect(setOutput).toHaveBeenCalledWith("outputs-truncated", "true");
  expect(setOutput).toHaveBeenCalledWith("candidate-count", 2_000);
  expect(setOutput).toHaveBeenCalledWith("deleted-total", 2_000);
});
