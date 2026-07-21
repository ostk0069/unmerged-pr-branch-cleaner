import { jest } from "@jest/globals";

const listPulls = jest.fn();
const getRepository = jest.fn();
const getBranch = jest.fn();
const listBranches = jest.fn();
const deleteRef = jest.fn();
const paginate = jest.fn(async (_endpoint: unknown, params: unknown) => {
  const state = (params as { state: "open" | "closed" }).state;
  return [
    {
      merged_at: null,
      head: {
        ref: `${state}-branch`,
        sha: `${state}-sha`,
        repo: { full_name: "owner/repo" },
      },
      base: { repo: { full_name: "owner/repo" } },
    },
  ];
});
const getOctokit = jest.fn(() => ({
  paginate,
  rest: {
    pulls: { list: listPulls },
    repos: { get: getRepository, getBranch, listBranches },
    git: { deleteRef },
  },
}));

jest.unstable_mockModule("@actions/github", () => ({ getOctokit }));
const { createGitHubClient } = await import("../src/github-client.js");

beforeEach(() => {
  jest.clearAllMocks();
});

test("uses getOctokit pagination with 100 pull requests per page", async () => {
  const client = createGitHubClient("token");
  await client.listPullRequests({
    owner: "owner",
    repo: "repo",
    state: "closed",
  });
  await client.listPullRequests({
    owner: "owner",
    repo: "repo",
    state: "open",
  });

  expect(getOctokit).toHaveBeenCalledWith("token");
  expect(paginate).toHaveBeenNthCalledWith(1, listPulls, {
    owner: "owner",
    repo: "repo",
    state: "closed",
    per_page: 100,
  });
  expect(paginate).toHaveBeenNthCalledWith(2, listPulls, {
    owner: "owner",
    repo: "repo",
    state: "open",
    per_page: 100,
  });
});

test("paginates through branches with 100 branches per page", async () => {
  const client = createGitHubClient("token");
  await client.listBranches("owner", "repo");
  expect(paginate).toHaveBeenCalledWith(listBranches, {
    owner: "owner",
    repo: "repo",
    per_page: 100,
  });
});

test("deletes a slash-containing branch using the full heads ref", async () => {
  const client = createGitHubClient("token");
  await client.deleteBranch("owner", "repo", "feature/foo");
  expect(deleteRef).toHaveBeenCalledWith({
    owner: "owner",
    repo: "repo",
    ref: "heads/feature/foo",
  });
});
