import { jest } from "@jest/globals";
import { cleanBranches } from "../src/cleaner.js";
import type { GitHubClient, Logger, PullRequest } from "../src/types.js";

const mockListPullRequests = (
  implementation: GitHubClient["listPullRequests"],
) => jest.fn(implementation);
const mockGetRepository = (implementation: GitHubClient["getRepository"]) =>
  jest.fn(implementation);
const mockListBranches = (implementation: GitHubClient["listBranches"]) =>
  jest.fn(implementation);
const mockGetBranch = (implementation: GitHubClient["getBranch"]) =>
  jest.fn(implementation);
const mockDeleteBranch = (implementation: GitHubClient["deleteBranch"]) =>
  jest.fn(implementation);

const pr = (
  ref: string,
  state: "merged" | "unmerged" = "unmerged",
  repo = "owner/repo",
): PullRequest => ({
  merged_at: state === "merged" ? "2026-01-01T00:00:00Z" : null,
  head: { ref, sha: `sha-${ref}`, repo: { full_name: repo } },
  base: { repo: { full_name: "owner/repo" } },
});

function setup(overrides: Partial<GitHubClient> = {}) {
  const closed = [
    pr("delete-me"),
    pr("delete-me"),
    pr("merged", "merged"),
    pr("fork", "unmerged", "fork/repo"),
  ];
  const client: GitHubClient = {
    listPullRequests: mockListPullRequests(async ({ state }) =>
      state === "closed" ? closed : [],
    ),
    getRepository: mockGetRepository(async () => ({ default_branch: "main" })),
    listBranches: mockListBranches(async () =>
      ["delete-me", "main", "feature/foo", "bad", "next"].map((name) => ({
        name,
        protected: false,
        commit: { sha: `sha-${name}` },
      })),
    ),
    getBranch: mockGetBranch(async (_owner, _repo, branch) => ({
      name: branch,
      protected: false,
      commit: { sha: `sha-${branch}` },
    })),
    deleteBranch: mockDeleteBranch(async () => undefined),
    ...overrides,
  };
  const logger: Logger = {
    info: jest.fn(),
    notice: jest.fn(),
    warning: jest.fn(),
  };
  return { client, logger };
}

const options = { owner: "owner", repo: "repo", dryRun: false };

describe("cleanBranches", () => {
  test("deletes unique branches from only closed unmerged same-repository PRs", async () => {
    const { client, logger } = setup();
    const result = await cleanBranches(client, logger, options);
    expect(result).toEqual({
      deletedBranches: ["delete-me"],
      skippedBranches: [],
      failedBranches: [],
    });
    expect(client.deleteBranch).toHaveBeenCalledWith(
      "owner",
      "repo",
      "delete-me",
    );
    expect(client.getBranch).toHaveBeenCalledTimes(1);
  });

  test("excludes a pull request whose head repository was deleted", async () => {
    const deletedRepositoryPullRequest = pr("orphaned");
    deletedRepositoryPullRequest.head.repo = null;
    const { client, logger } = setup({
      listPullRequests: mockListPullRequests(async ({ state }) =>
        state === "closed" ? [deletedRepositoryPullRequest] : [],
      ),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result).toEqual({
      deletedBranches: [],
      skippedBranches: [],
      failedBranches: [],
    });
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test("passes a slash-containing branch name through to deletion", async () => {
    const { client, logger } = setup({
      listPullRequests: mockListPullRequests(async ({ state }) =>
        state === "closed" ? [pr("feature/foo")] : [],
      ),
    });
    await cleanBranches(client, logger, options);
    expect(client.deleteBranch).toHaveBeenCalledWith(
      "owner",
      "repo",
      "feature/foo",
    );
  });

  test("rejects discovery errors without deleting a branch", async () => {
    const { client, logger } = setup({
      listPullRequests: mockListPullRequests(async () => {
        throw new Error("discovery failed");
      }),
    });
    await expect(cleanBranches(client, logger, options)).rejects.toThrow(
      "discovery failed",
    );
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test("rejects branch discovery errors without deleting a branch", async () => {
    const { client, logger } = setup({
      listBranches: mockListBranches(async () => {
        throw new Error("branch discovery failed");
      }),
    });
    await expect(cleanBranches(client, logger, options)).rejects.toThrow(
      "branch discovery failed",
    );
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test("ignores missing remote candidates without an individual branch lookup", async () => {
    const { client, logger } = setup({
      listBranches: mockListBranches(async () => []),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result).toEqual({
      deletedBranches: [],
      skippedBranches: [],
      failedBranches: [],
    });
    expect(client.getBranch).not.toHaveBeenCalled();
  });

  test.each(["default", "initially-open"])(
    "skips %s branches",
    async (kind) => {
      const branch = kind === "default" ? "main" : "delete-me";
      const { client, logger } = setup({
        getRepository: mockGetRepository(async () => ({
          default_branch: branch,
        })),
        listPullRequests: mockListPullRequests(async ({ state }) =>
          state === "closed"
            ? [pr("delete-me"), ...(kind === "default" ? [pr("main")] : [])]
            : kind === "initially-open"
              ? [pr("delete-me")]
              : [],
        ),
      });
      const result = await cleanBranches(client, logger, {
        ...options,
      });
      expect(result.skippedBranches.length).toBeGreaterThan(0);
      if (kind !== "default")
        expect(client.deleteBranch).not.toHaveBeenCalled();
    },
  );

  test("skips protected branch", async () => {
    const { client, logger } = setup({
      listBranches: mockListBranches(async () => [
        {
          name: "delete-me",
          protected: true,
          commit: { sha: "sha-delete-me" },
        },
      ]),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches).toHaveLength(1);
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test("skips a branch whose SHA no longer matches the closed PR", async () => {
    const { client, logger } = setup({
      listBranches: mockListBranches(async () => [
        {
          name: "delete-me",
          protected: false,
          commit: { sha: "new-sha" },
        },
      ]),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toContain("SHA does not match");
  });

  test("skips a branch changed between safety checks", async () => {
    const { client, logger } = setup({
      getBranch: mockGetBranch(async () => ({
        name: "delete-me",
        protected: true,
        commit: { sha: "sha-delete-me" },
      })),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toBe(
      "branch changed during final safety check",
    );
  });

  test("skips a branch that becomes the default during safety checks", async () => {
    let calls = 0;
    const { client, logger } = setup({
      getRepository: mockGetRepository(async () => ({
        default_branch: calls++ > 0 ? "delete-me" : "main",
      })),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toBe(
      "branch changed during final safety check",
    );
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test("skips a branch removed between safety checks", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const { client, logger } = setup({
      getBranch: mockGetBranch(async () => {
        throw notFound;
      }),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toContain("final check");
  });

  test("skips a branch with multiple distinct closed head SHAs", async () => {
    const older = pr("delete-me");
    older.head.sha = "older-sha";
    const { client, logger } = setup({
      listPullRequests: mockListPullRequests(async ({ state }) =>
        state === "closed" ? [older, pr("delete-me")] : [],
      ),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches).toEqual([
      { branch: "delete-me", reason: "ambiguous history" },
    ]);
    expect(client.getBranch).not.toHaveBeenCalled();
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test("rechecks open PR immediately before deletion", async () => {
    let calls = 0;
    const { client, logger } = setup({
      listPullRequests: mockListPullRequests(async ({ state, head }) => {
        if (state === "closed") return [pr("delete-me")];
        calls += 1;
        return head ? [pr("delete-me")] : [];
      }),
    });
    const result = await cleanBranches(client, logger, options);
    expect(calls).toBe(2);
    expect(result.skippedBranches).toHaveLength(1);
  });

  test("dry run does not delete", async () => {
    const { client, logger } = setup();
    const result = await cleanBranches(client, logger, {
      ...options,
      dryRun: true,
    });
    expect(result.skippedBranches).toHaveLength(1);
    expect(client.deleteBranch).not.toHaveBeenCalled();
  });

  test.each(["inspect", "recheck", "delete"])(
    "fails closed when %s fails",
    async (stage) => {
      const { client, logger } = setup({
        ...(stage === "inspect"
          ? {
              getBranch: mockGetBranch(async () => {
                throw new Error("boom");
              }),
            }
          : {}),
        ...(stage === "recheck"
          ? {
              listPullRequests: mockListPullRequests(
                async ({ state, head }) => {
                  if (state === "closed") return [pr("delete-me")];
                  if (head) throw new Error("boom");
                  return [];
                },
              ),
            }
          : {}),
        ...(stage === "delete"
          ? {
              deleteBranch: mockDeleteBranch(async () => {
                throw new Error("boom");
              }),
            }
          : {}),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.failedBranches).toHaveLength(1);
    },
  );

  test.each([
    ["open PR", 404, "failed to recheck open pull requests"],
    ["repository", 404, "failed to recheck repository default branch"],
    ["branch", 500, "failed to recheck branch"],
  ])(
    "records an API-specific failure when the final %s recheck returns HTTP %s",
    async (api, status, reason) => {
      const failure = Object.assign(new Error("recheck failed"), { status });
      let repositoryCalls = 0;
      const { client, logger } = setup({
        ...(api === "open PR"
          ? {
              listPullRequests: mockListPullRequests(
                async ({ state, head }) => {
                  if (state === "closed") return [pr("delete-me")];
                  if (head) throw failure;
                  return [];
                },
              ),
            }
          : {}),
        ...(api === "repository"
          ? {
              getRepository: mockGetRepository(async () => {
                if (repositoryCalls++ > 0) throw failure;
                return { default_branch: "main" };
              }),
            }
          : {}),
        ...(api === "branch"
          ? {
              getBranch: mockGetBranch(async () => {
                throw failure;
              }),
            }
          : {}),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.failedBranches).toEqual([{ branch: "delete-me", reason }]);
      expect(result.skippedBranches).toEqual([]);
      expect(client.deleteBranch).not.toHaveBeenCalled();
    },
  );

  test.each(["inspect", "delete"])(
    "counts a 404 during %s as missing",
    async (stage) => {
      const notFound = Object.assign(new Error("not found"), { status: 404 });
      const { client, logger } = setup({
        ...(stage === "inspect"
          ? {
              getBranch: mockGetBranch(async () => {
                throw notFound;
              }),
            }
          : {}),
        ...(stage === "delete"
          ? {
              deleteBranch: mockDeleteBranch(async () => {
                throw notFound;
              }),
            }
          : {}),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.skippedBranches).toHaveLength(1);
      expect(result.failedBranches).toHaveLength(0);
    },
  );

  test.each([403, 409, 422])(
    "records delete HTTP %s and continues with the next candidate",
    async (status) => {
      const failure = Object.assign(new Error("delete failed"), { status });
      const { client, logger } = setup({
        listPullRequests: mockListPullRequests(async ({ state }) =>
          state === "closed" ? [pr("bad"), pr("next")] : [],
        ),
        deleteBranch: mockDeleteBranch(async (_owner, _repo, branch) => {
          if (branch === "bad") throw failure;
        }),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.failedBranches).toEqual([
        { branch: "bad", reason: `failed to delete branch (HTTP ${status})` },
      ]);
      expect(result.deletedBranches).toEqual(["next"]);
      expect(client.deleteBranch).toHaveBeenCalledTimes(2);
    },
  );
});
