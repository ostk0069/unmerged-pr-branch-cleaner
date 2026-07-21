import { jest } from "@jest/globals";
import { cleanBranches, isRateLimitError } from "../src/cleaner.js";
import type { GitHubClient, Logger, PullRequest } from "../src/types.js";

const pulls = (implementation: GitHubClient["listPullRequests"]) =>
  jest.fn(implementation);
const branchLookup = (implementation: GitHubClient["getBranch"]) =>
  jest.fn(implementation);

const pr = (
  ref: string,
  overrides: Partial<PullRequest> = {},
): PullRequest => ({
  merged_at: null,
  closed_at: "2026-01-01T00:00:00Z",
  head: { ref, sha: `sha-${ref}`, repo: { full_name: "owner/repo" } },
  base: { ref: "main", repo: { full_name: "owner/repo" } },
  ...overrides,
});

function setup(overrides: Partial<GitHubClient> = {}) {
  const client: GitHubClient = {
    getRepository: jest.fn(async () => ({
      default_branch: "main",
      node_id: "R_1",
      fork: false,
    })),
    listPullRequests: pulls(async ({ state }) =>
      state === "closed" ? [pr("delete-me")] : [],
    ),
    listBranches: jest.fn(async () => [
      { name: "delete-me", protected: false, commit: { sha: "sha-delete-me" } },
    ]),
    getBranch: branchLookup(async (_owner, _repo, branch) => ({
      name: branch,
      protected: false,
      commit: { sha: `sha-${branch}` },
    })),
    deleteBranchAtomically: jest.fn(async () => undefined),
    ...overrides,
  };
  const logger: Logger = {
    info: jest.fn(),
    notice: jest.fn(),
    warning: jest.fn(),
  };
  return { client, logger };
}

const options = {
  owner: "owner",
  repo: "repo",
  dryRun: false,
  maxDeletions: 20,
  excludedBranches: [] as string[],
  minimumClosedAgeDays: 0,
  allowForkRepositories: false,
  now: () => new Date("2026-07-01T00:00:00Z"),
  sleep: jest.fn(async () => undefined),
};

describe("cleanBranches", () => {
  test("atomically deletes using repository node ID and expected SHA", async () => {
    const { client, logger } = setup();
    const result = await cleanBranches(client, logger, options);
    expect(result.deletedBranches).toEqual(["delete-me"]);
    expect(result.candidateBranches).toEqual(["delete-me"]);
    expect(client.deleteBranchAtomically).toHaveBeenCalledWith({
      repositoryId: "R_1",
      branch: "delete-me",
      expectedSha: "sha-delete-me",
    });
  });

  test("protects same-repository open PR head and base branches", async () => {
    const openHead = pr("delete-me");
    const openBase = pr("stack-head", {
      base: { ref: "stack-base", repo: { full_name: "owner/repo" } },
    });
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed"
          ? [pr("delete-me"), pr("stack-base")]
          : [openHead, openBase],
      ),
      listBranches: jest.fn(async () =>
        ["delete-me", "stack-base"].map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches).toHaveLength(2);
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
  });

  test("rechecks open PR base immediately before deletion", async () => {
    let openCalls = 0;
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) => {
        if (state === "closed") return [pr("delete-me")];
        openCalls += 1;
        return openCalls === 1
          ? []
          : [
              pr("other", {
                base: { ref: "delete-me", repo: { full_name: "owner/repo" } },
              }),
            ];
      }),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toContain("head or base");
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
  });

  test("checks open PR heads and bases again directly before mutation", async () => {
    let openCalls = 0;
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) => {
        if (state === "closed") return [pr("delete-me")];
        openCalls += 1;
        return openCalls < 3
          ? []
          : [
              pr("stack-head", {
                base: {
                  ref: "delete-me",
                  repo: { full_name: "owner/repo" },
                },
              }),
            ];
      }),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toContain(
      "immediately before deletion",
    );
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
  });

  test("aborts before mutation when immediate recheck is rate limited", async () => {
    const names = ["delete-me", "later"];
    let openCalls = 0;
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) => {
        if (state === "closed") return names.map((name) => pr(name));
        openCalls += 1;
        if (openCalls === 3)
          throw Object.assign(new Error("limited"), { status: 429 });
        return [];
      }),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.fatalError).toContain("rate limit");
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
    expect(result.skippedBranches).toContainEqual({
      branch: "later",
      reason: "not attempted after fatal error",
    });
  });

  test("records a non-rate immediate recheck failure and does not mutate", async () => {
    let openCalls = 0;
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) => {
        if (state === "closed") return [pr("delete-me")];
        openCalls += 1;
        if (openCalls === 3)
          throw Object.assign(new Error("server"), { status: 500 });
        return [];
      }),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.failedBranches[0]?.reason).toContain("immediate");
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
  });

  test("does not reserve a fork head but still reserves its same-repository base", async () => {
    const forkOpen = pr("fork-head", {
      head: {
        ref: "fork-head",
        sha: "fork-sha",
        repo: { full_name: "fork/repo" },
      },
      base: { ref: "delete-me", repo: { full_name: "owner/repo" } },
    });
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? [pr("delete-me")] : [forkOpen],
      ),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches).toHaveLength(1);
  });

  test("rejects repository forks by default and allows explicit opt-in", async () => {
    const forkRepository = jest.fn(async () => ({
      default_branch: "main",
      node_id: "R_1",
      fork: true,
    }));
    const first = setup({ getRepository: forkRepository });
    await expect(
      cleanBranches(first.client, first.logger, options),
    ).rejects.toThrow("fork repository");
    const second = setup({ getRepository: forkRepository });
    await expect(
      cleanBranches(second.client, second.logger, {
        ...options,
        allowForkRepositories: true,
      }),
    ).resolves.toBeDefined();
  });

  test("applies exclude globs", async () => {
    const { client, logger } = setup();
    const result = await cleanBranches(client, logger, {
      ...options,
      excludedBranches: ["delete-*", "release/**"],
    });
    expect(result.skippedBranches[0]?.reason).toBe("matched exclude-branches");
  });

  test("requires every matching closed PR to be old enough by using newest closed_at", async () => {
    const newest = pr("delete-me", { closed_at: "2026-06-30T12:00:00Z" });
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? [pr("delete-me"), newest] : [],
      ),
    });
    const result = await cleanBranches(client, logger, {
      ...options,
      minimumClosedAgeDays: 1,
    });
    expect(result.skippedBranches[0]?.reason).toContain("younger");
  });

  test.each([null, "not-a-date"])(
    "skips invalid closed_at %s",
    async (closedAt) => {
      const { client, logger } = setup({
        listPullRequests: pulls(async ({ state }) =>
          state === "closed" ? [pr("delete-me", { closed_at: closedAt })] : [],
        ),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.skippedBranches[0]?.reason).toContain("closed_at");
    },
  );

  test("fails before any mutation when candidates exceed max-deletions", async () => {
    const names = ["a", "b"];
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
    });
    const result = await cleanBranches(client, logger, {
      ...options,
      maxDeletions: 1,
    });
    expect(result.fatalError).toContain("no branches were deleted");
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
  });

  test("dry-run reports all candidates even above max", async () => {
    const names = ["a", "b"];
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
    });
    const result = await cleanBranches(client, logger, {
      ...options,
      dryRun: true,
      maxDeletions: 1,
    });
    expect(result.candidateBranches).toEqual(names);
    expect(
      result.skippedBranches.filter(({ reason }) => reason.includes("dry-run")),
    ).toHaveLength(2);
  });

  test("paces mutations by at least one injected second", async () => {
    const names = ["a", "b"];
    const sleep = jest.fn(async () => undefined);
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
    });
    await cleanBranches(client, logger, { ...options, sleep });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  test.each([
    Object.assign(new Error("limited"), { status: 429 }),
    Object.assign(new Error("limited"), {
      status: 403,
      response: { headers: { "x-ratelimit-remaining": "0" } },
    }),
    Object.assign(new Error("secondary rate limit"), { status: 403 }),
    Object.assign(new Error("GraphQL request failed"), {
      response: {
        status: 200,
        data: {
          errors: [
            { type: "RATE_LIMITED", message: "API rate limit exceeded" },
          ],
        },
      },
    }),
  ])("aborts all remaining mutations on rate limit", async (rateError) => {
    const names = ["a", "b"];
    const mutation = jest.fn(async () => {
      throw rateError;
    });
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
      deleteBranchAtomically: mutation,
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.fatalError).toContain("rate limit");
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(result.skippedBranches).toContainEqual({
      branch: "b",
      reason: "not attempted after fatal error",
    });
  });

  test("classifies an atomic expected-SHA mismatch as changed", async () => {
    const { client, logger } = setup({
      deleteBranchAtomically: jest.fn(async () => {
        throw new Error("beforeOid does not match");
      }),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches[0]?.reason).toContain("atomic deletion");
  });

  test.each([
    [Object.assign(new Error("gone"), { status: 404 }), "not found"],
    [Object.assign(new Error("rule"), { status: 422 }), "HTTP 422"],
  ])(
    "handles normal atomic deletion errors and continues",
    async (error, reason) => {
      const { client, logger } = setup({
        deleteBranchAtomically: jest.fn(async () => {
          throw error;
        }),
      });
      const result = await cleanBranches(client, logger, options);
      expect(
        [...result.skippedBranches, ...result.failedBranches][0]?.reason,
      ).toContain(reason);
    },
  );

  test("fails closed on final API errors and handles missing branches", async () => {
    let openCalls = 0;
    const first = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed"
          ? [pr("delete-me")]
          : ++openCalls > 1
            ? Promise.reject(new Error("api"))
            : [],
      ),
    });
    expect(
      (await cleanBranches(first.client, first.logger, options)).failedBranches,
    ).toHaveLength(1);
    let calls = 0;
    const second = setup({
      getRepository: jest.fn(async () => {
        calls += 1;
        if (calls > 1) throw new Error("api");
        return { default_branch: "main", node_id: "R_1", fork: false };
      }),
    });
    expect(
      (await cleanBranches(second.client, second.logger, options))
        .failedBranches,
    ).toHaveLength(1);
    const third = setup({
      getBranch: jest.fn(async () => {
        throw Object.assign(new Error("gone"), { status: 404 });
      }),
    });
    expect(
      (await cleanBranches(third.client, third.logger, options))
        .skippedBranches,
    ).toHaveLength(1);
    const fourth = setup({
      getBranch: jest.fn(async () => {
        throw Object.assign(new Error("server"), { status: 500 });
      }),
    });
    expect(
      (await cleanBranches(fourth.client, fourth.logger, options))
        .failedBranches,
    ).toHaveLength(1);
  });

  test("fails closed if the repository becomes a fork during final checks", async () => {
    const names = ["a", "b"];
    let calls = 0;
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
      getRepository: jest.fn(async () => ({
        default_branch: "main",
        node_id: "R_1",
        fork: calls++ > 0,
      })),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.failedBranches[0]?.reason).toContain("fork");
    expect(result.skippedBranches).toContainEqual({
      branch: "b",
      reason: "not attempted after fatal error",
    });
  });

  test.each(["open snapshot", "repository snapshot"])(
    "treats rate limit in final %s as fatal before all mutations",
    async (stage) => {
      const names = ["a", "b"];
      let openCalls = 0;
      let repositoryCalls = 0;
      const { client, logger } = setup({
        listPullRequests: pulls(async ({ state }) => {
          if (state === "closed") return names.map((name) => pr(name));
          openCalls += 1;
          if (stage === "open snapshot" && openCalls === 2)
            throw Object.assign(new Error("limited"), { status: 429 });
          return [];
        }),
        listBranches: jest.fn(async () =>
          names.map((name) => ({
            name,
            protected: false,
            commit: { sha: `sha-${name}` },
          })),
        ),
        getRepository: jest.fn(async () => {
          repositoryCalls += 1;
          if (stage === "repository snapshot" && repositoryCalls === 2)
            throw Object.assign(new Error("limited"), {
              status: 403,
              response: { headers: { "x-ratelimit-remaining": "0" } },
            });
          return { default_branch: "main", node_id: "R_1", fork: false };
        }),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.fatalError).toContain("rate limit");
      expect(client.getBranch).not.toHaveBeenCalled();
      expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
      expect(result.skippedBranches).toContainEqual({
        branch: "b",
        reason: "not attempted after fatal error",
      });
    },
  );

  test("stops final checks on a rate limit and records unattempted candidates", async () => {
    const names = ["a", "b"];
    const getBranch = branchLookup(async (_owner, _repo, branch) => {
      if (branch === "a")
        throw Object.assign(new Error("limited"), { status: 429 });
      return {
        name: branch,
        protected: false,
        commit: { sha: `sha-${branch}` },
      };
    });
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
      getBranch,
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.fatalError).toContain("rate limit");
    expect(getBranch).toHaveBeenCalledTimes(1);
    expect(client.deleteBranchAtomically).not.toHaveBeenCalled();
    expect(result.skippedBranches).toContainEqual({
      branch: "b",
      reason: "not attempted after fatal error",
    });
  });

  test("uses one final open/repository snapshot and filtered immediate checks", async () => {
    const names = ["a", "b"];
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed" ? names.map((name) => pr(name)) : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: false,
          commit: { sha: `sha-${name}` },
        })),
      ),
    });
    await cleanBranches(client, logger, options);
    const pullCalls = jest
      .mocked(client.listPullRequests)
      .mock.calls.map(([params]) => params);
    expect(
      pullCalls.filter(
        ({ state, head, base }) =>
          state === "open" && head === undefined && base === undefined,
      ),
    ).toHaveLength(2);
    expect(pullCalls.filter(({ head }) => head !== undefined)).toHaveLength(2);
    expect(pullCalls.filter(({ base }) => base !== undefined)).toHaveLength(2);
    expect(client.getRepository).toHaveBeenCalledTimes(2);
    expect(client.getBranch).toHaveBeenCalledTimes(2);
  });

  test.each([
    { protected: true, defaultBranch: "main", sha: "sha-delete-me" },
    { protected: false, defaultBranch: "delete-me", sha: "sha-delete-me" },
    { protected: false, defaultBranch: "main", sha: "changed" },
  ])(
    "rechecks final branch safety: %#",
    async ({ protected: isProtected, defaultBranch, sha }) => {
      let repositoryCalls = 0;
      const { client, logger } = setup({
        getRepository: jest.fn(async () => ({
          default_branch: repositoryCalls++ === 0 ? "main" : defaultBranch,
          node_id: "R_1",
          fork: false,
        })),
        getBranch: branchLookup(async () => ({
          name: "delete-me",
          protected: isProtected,
          commit: { sha },
        })),
      });
      const result = await cleanBranches(client, logger, options);
      expect(result.skippedBranches[0]?.reason).toContain("final safety");
    },
  );

  test("skips merged, deleted-fork heads, protected, ambiguous and changed branches", async () => {
    const merged = pr("merged", { merged_at: "2026-01-02T00:00:00Z" });
    const orphan = pr("orphan", {
      head: { ref: "orphan", sha: "x", repo: null },
    });
    const old = pr("ambiguous", {
      head: { ref: "ambiguous", sha: "old", repo: { full_name: "owner/repo" } },
    });
    const names = ["protected", "ambiguous", "changed"];
    const { client, logger } = setup({
      listPullRequests: pulls(async ({ state }) =>
        state === "closed"
          ? [
              merged,
              orphan,
              pr("protected"),
              old,
              pr("ambiguous"),
              pr("changed"),
            ]
          : [],
      ),
      listBranches: jest.fn(async () =>
        names.map((name) => ({
          name,
          protected: name === "protected",
          commit: { sha: name === "changed" ? "new" : `sha-${name}` },
        })),
      ),
    });
    const result = await cleanBranches(client, logger, options);
    expect(result.skippedBranches).toHaveLength(3);
  });
});

test("rate-limit detection ignores ordinary 403 and non-errors", () => {
  expect(
    isRateLimitError(Object.assign(new Error("forbidden"), { status: 403 })),
  ).toBe(false);
  expect(isRateLimitError("nope")).toBe(false);
  expect(
    isRateLimitError(
      Object.assign(new Error("GraphQL request failed"), {
        status: 200,
        headers: { "X-RateLimit-Remaining": "0" },
      }),
    ),
  ).toBe(true);
  const receiverAwareHeaders = {
    marker: true,
    get(this: { marker: boolean }, name: string) {
      if (!this.marker) throw new TypeError("Illegal invocation");
      return name.toLowerCase() === "x-ratelimit-remaining" ? "0" : null;
    },
  };
  expect(isRateLimitError({ status: 200, headers: receiverAwareHeaders })).toBe(
    true,
  );
  expect(
    isRateLimitError({
      errors: [{ message: "You have exceeded a secondary rate limit." }],
    }),
  ).toBe(true);
  expect(
    isRateLimitError({
      status: 200,
      errors: [{ message: "API rate limit exceeded for installation." }],
    }),
  ).toBe(true);
  expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
  expect(
    isRateLimitError({
      response: {
        status: 200,
        errors: [{ type: "RATE_LIMITED" }],
      },
    }),
  ).toBe(true);
  expect(
    isRateLimitError(new Error("rate limit configuration is invalid")),
  ).toBe(false);
  expect(
    isRateLimitError(
      Object.assign(new Error("wait"), {
        status: 403,
        response: { headers: { "retry-after": 1 } },
      }),
    ),
  ).toBe(true);
  expect(
    isRateLimitError(
      Object.assign(new Error("bad headers"), {
        status: 403,
        response: "invalid",
      }),
    ),
  ).toBe(false);
});
