import { jest } from "@jest/globals";

const listPulls = jest.fn();
const getRepository = jest.fn(async () => ({
  data: { default_branch: "main", node_id: "R", fork: false },
}));
const getBranch = jest.fn(async () => ({
  data: { name: "a", protected: false, commit: { sha: "abc" } },
}));
const listBranches = jest.fn();
const graphql = jest.fn<(query: string, variables: unknown) => Promise<object>>(
  async () => ({}),
);
const paginate = jest.fn(async (endpoint: unknown) =>
  endpoint === listBranches ? [] : [],
);
const getOctokit = jest.fn(() => ({
  paginate,
  graphql,
  rest: {
    pulls: { list: listPulls },
    repos: { get: getRepository, getBranch, listBranches },
  },
}));

jest.unstable_mockModule("@actions/github", () => ({ getOctokit }));
const { createGitHubClient } = await import("../src/github-client.js");

beforeEach(() => jest.clearAllMocks());

test("paginates pull requests and branches", async () => {
  const client = createGitHubClient("token");
  await client.listPullRequests({
    owner: "owner",
    repo: "repo",
    state: "closed",
    head: "owner:branch",
  });
  await client.listBranches("owner", "repo");
  expect(paginate).toHaveBeenNthCalledWith(1, listPulls, {
    owner: "owner",
    repo: "repo",
    state: "closed",
    head: "owner:branch",
    per_page: 100,
  });
  expect(paginate).toHaveBeenNthCalledWith(2, listBranches, {
    owner: "owner",
    repo: "repo",
    per_page: 100,
  });
  await client.listPullRequests({
    owner: "owner",
    repo: "repo",
    state: "open",
  });
  expect(paginate).toHaveBeenNthCalledWith(3, listPulls, {
    owner: "owner",
    repo: "repo",
    state: "open",
    per_page: 100,
  });
  await client.listPullRequests({
    owner: "owner",
    repo: "repo",
    state: "open",
    base: "stack/base",
  });
  expect(paginate).toHaveBeenNthCalledWith(4, listPulls, {
    owner: "owner",
    repo: "repo",
    state: "open",
    base: "stack/base",
    per_page: 100,
  });
});

test("reads repository and branch metadata", async () => {
  const client = createGitHubClient("token");
  await client.getRepository("owner", "repo");
  await client.getBranch("owner", "repo", "feature/foo");
  expect(getBranch).toHaveBeenCalledWith({
    owner: "owner",
    repo: "repo",
    branch: "feature/foo",
  });
});

test("uses updateRefs compare-and-delete for slash and HTML branch names", async () => {
  const client = createGitHubClient("token");
  await client.deleteBranchAtomically({
    repositoryId: "R_1",
    branch: "feature/</td>",
    expectedSha: "a".repeat(40),
  });
  const variables = graphql.mock.calls[0]![1] as {
    input: { repositoryId: string; refUpdates: unknown[] };
  };
  expect(graphql.mock.calls[0]![0]).toContain("updateRefs");
  expect(graphql.mock.calls[0]![0]).toContain("UpdateRefsInput");
  expect(variables.input.repositoryId).toBe("R_1");
  expect(variables.input.refUpdates).toEqual([
    {
      name: "refs/heads/feature/</td>",
      beforeOid: "a".repeat(40),
      afterOid: "0".repeat(40),
    },
  ]);
});
