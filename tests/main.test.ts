import { jest } from "@jest/globals";
import type { CleanupResult } from "../src/types.js";

const getInput = jest.fn((name: string) => {
  if (name === "github-token") return "token";
  if (name === "dry-run") return "false";
  return "";
});
const setOutput = jest.fn();
const setFailed = jest.fn();
const summary = {
  addHeading: jest.fn(),
  addTable: jest.fn(),
  addRaw: jest.fn(),
  write: jest.fn(async () => summary),
};
summary.addHeading.mockImplementation(() => summary);
summary.addTable.mockImplementation(() => summary);
summary.addRaw.mockImplementation(() => summary);

const cleanBranches = jest.fn<() => Promise<CleanupResult>>();
const createGitHubClient = jest.fn(() => ({ client: true }));

jest.unstable_mockModule("@actions/core", () => ({
  getInput,
  setOutput,
  setFailed,
  summary,
  info: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));
jest.unstable_mockModule("../src/cleaner.js", () => ({ cleanBranches }));
jest.unstable_mockModule("../src/github-client.js", () => ({
  createGitHubClient,
}));

const { run } = await import("../src/main.js");

beforeEach(() => {
  jest.clearAllMocks();
  summary.addHeading.mockImplementation(() => summary);
  summary.addTable.mockImplementation(() => summary);
  summary.addRaw.mockImplementation(() => summary);
  summary.write.mockImplementation(async () => summary);
  process.env.GITHUB_REPOSITORY = "owner/repo";
});

test("writes practical outputs and a job summary", async () => {
  cleanBranches.mockResolvedValueOnce({
    deletedBranches: ["deleted"],
    skippedBranches: [{ branch: "kept", reason: "protected branch" }],
    failedBranches: [],
  });
  await run();

  expect(setOutput).toHaveBeenCalledWith("deleted-count", 1);
  expect(setOutput).toHaveBeenCalledWith(
    "deleted-branches",
    JSON.stringify(["deleted"]),
  );
  expect(setOutput).toHaveBeenCalledWith(
    "skipped-branches",
    JSON.stringify([{ branch: "kept", reason: "protected branch" }]),
  );
  expect(setOutput).toHaveBeenCalledWith("failed-branches", "[]");
  expect(summary.addTable).toHaveBeenCalled();
  expect(summary.write).toHaveBeenCalled();
  expect(setFailed).not.toHaveBeenCalled();
});

test("marks the action failed after reporting branch failures", async () => {
  cleanBranches.mockResolvedValueOnce({
    deletedBranches: [],
    skippedBranches: [],
    failedBranches: [{ branch: "bad", reason: "failed to delete branch" }],
  });
  await run();
  expect(setOutput).toHaveBeenCalledWith(
    "failed-branches",
    JSON.stringify([{ branch: "bad", reason: "failed to delete branch" }]),
  );
  expect(summary.write).toHaveBeenCalled();
  expect(setFailed).toHaveBeenCalledWith(
    "1 branch(es) could not be safely processed.",
  );
});

test("keeps zero-value outputs and fails when discovery throws", async () => {
  cleanBranches.mockRejectedValueOnce(new Error("discovery failed"));
  await run();
  expect(setOutput).toHaveBeenCalledWith("deleted-count", 0);
  expect(setOutput).toHaveBeenCalledWith("deleted-branches", "[]");
  expect(setFailed).toHaveBeenCalledWith("discovery failed");
});

test("shows exactly 50 detail rows without an omission note", async () => {
  cleanBranches.mockResolvedValueOnce({
    deletedBranches: Array.from(
      { length: 50 },
      (_, index) => `branch-${index}`,
    ),
    skippedBranches: [],
    failedBranches: [],
  });
  await run();
  const tableCalls = summary.addTable.mock.calls as unknown as [
    [unknown[]],
    [unknown[]],
  ];
  expect(summary.addTable).toHaveBeenCalledTimes(2);
  expect(tableCalls[1][0]).toHaveLength(51);
  expect(summary.addRaw).not.toHaveBeenCalled();
});

test("limits 51 results to 50 detail rows and reports one omission", async () => {
  cleanBranches.mockResolvedValueOnce({
    deletedBranches: Array.from(
      { length: 51 },
      (_, index) => `branch-${index}`,
    ),
    skippedBranches: [],
    failedBranches: [],
  });
  await run();
  const tableCalls = summary.addTable.mock.calls as unknown as [
    [unknown[]],
    [unknown[]],
  ];
  expect(summary.addTable).toHaveBeenCalledTimes(2);
  expect(tableCalls[1][0]).toHaveLength(51);
  expect(summary.addRaw).toHaveBeenCalledWith(
    expect.stringContaining("1 additional result(s) omitted"),
  );
});
