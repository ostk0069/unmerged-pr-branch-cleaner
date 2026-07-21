import { minimatch } from "minimatch";
import { setTimeout as delay } from "node:timers/promises";
import { isNotFound } from "./errors.js";
import type {
  BranchInfo,
  BranchOutcome,
  CleanerOptions,
  CleanupResult,
  GitHubClient,
  Logger,
  PullRequest,
} from "./types.js";

interface ClosedBranchData {
  shas: Set<string>;
  closedDates: Date[];
  invalidClosedDate: boolean;
}

function isSameRepositoryHead(pr: PullRequest, repository: string): boolean {
  return pr.head.repo?.full_name === repository;
}

function isSameRepositoryBase(pr: PullRequest, repository: string): boolean {
  return pr.base.repo.full_name === repository;
}

function matchesExclusion(branch: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(branch, pattern, { dot: true }));
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return;
  if ("status" in error && typeof error.status === "number")
    return error.status;
  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    typeof error.response.status === "number"
  )
    return error.response.status;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) return;
  if ("get" in headers && typeof headers.get === "function") {
    const value = (headers.get as (header: string) => unknown).call(
      headers,
      name,
    );
    if (typeof value === "string" || typeof value === "number")
      return String(value);
  }
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = entry?.[1];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function errorHeader(error: unknown, name: string): string | undefined {
  if (typeof error !== "object" || error === null) return;
  if ("headers" in error) {
    const direct = headerValue(error.headers, name);
    if (direct !== undefined) return direct;
  }
  if (!("response" in error)) return;
  const response = error.response;
  if (
    typeof response !== "object" ||
    response === null ||
    !("headers" in response)
  )
    return;
  return headerValue(response.headers, name);
}

function rateLimitMessages(error: unknown): string[] {
  const messages: string[] = [];
  if (error instanceof Error) messages.push(error.message);
  if (typeof error !== "object" || error === null) return messages;

  const appendSignals = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === "string") messages.push(item);
      else if (typeof item === "object" && item !== null) {
        if ("message" in item && typeof item.message === "string")
          messages.push(item.message);
        if ("type" in item && typeof item.type === "string")
          messages.push(item.type);
      }
    }
  };

  if ("errors" in error) appendSignals(error.errors);
  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null
  ) {
    const response = error.response;
    if ("errors" in response) appendSignals(response.errors);
    if (
      "data" in response &&
      typeof response.data === "object" &&
      response.data !== null &&
      "errors" in response.data
    ) {
      appendSignals(response.data.errors);
    }
  }
  return messages;
}

export function isRateLimitError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429) return true;
  if (errorHeader(error, "retry-after") !== undefined) return true;
  if (errorHeader(error, "x-ratelimit-remaining")?.trim() === "0") return true;
  return rateLimitMessages(error).some(
    (message) =>
      /\b(?:primary|secondary|api) rate limit(?:ed| exceeded)?\b/i.test(
        message,
      ) ||
      /\brate limit exceeded\b/i.test(message) ||
      /\brate limited\b/i.test(message) ||
      /\babuse detection\b/i.test(message) ||
      /^(?:RATE_LIMITED|RATE_LIMIT|ABUSE_DETECTED)$/i.test(message),
  );
}

function isExpectedShaMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /beforeOid|expected.+(?:oid|sha)|does not match|reference.+changed/i.test(
    message,
  );
}

function skip(
  result: CleanupResult,
  logger: Logger,
  outcome: BranchOutcome,
): void {
  logger.notice(`Skipping ${outcome.branch}: ${outcome.reason}`);
  result.skippedBranches.push(outcome);
}

function fail(
  result: CleanupResult,
  logger: Logger,
  outcome: BranchOutcome,
): void {
  logger.warning(`Failed to process ${outcome.branch}: ${outcome.reason}`);
  result.failedBranches.push(outcome);
}

function markNotAttempted(
  result: CleanupResult,
  logger: Logger,
  branches: readonly string[],
): void {
  for (const branch of branches) {
    skip(result, logger, { branch, reason: "not attempted after fatal error" });
  }
}

export async function cleanBranches(
  client: GitHubClient,
  logger: Logger,
  options: CleanerOptions,
): Promise<CleanupResult> {
  const repository = `${options.owner}/${options.repo}`;
  const result: CleanupResult = {
    candidateBranches: [],
    deletedBranches: [],
    skippedBranches: [],
    failedBranches: [],
  };

  // Keep discovery sequential to avoid avoidable bursts against the REST API.
  const repositoryInfo = await client.getRepository(
    options.owner,
    options.repo,
  );
  if (repositoryInfo.fork && !options.allowForkRepositories) {
    throw new Error(
      "Refusing to run in a fork repository. Set allow-fork-repositories to true only after reviewing the limitations.",
    );
  }
  const closedPullRequests = await client.listPullRequests({
    owner: options.owner,
    repo: options.repo,
    state: "closed",
  });
  const openPullRequests = await client.listPullRequests({
    owner: options.owner,
    repo: options.repo,
    state: "open",
  });
  const remoteBranches = await client.listBranches(options.owner, options.repo);

  const reservedBranches = new Set<string>([repositoryInfo.default_branch]);
  for (const pr of openPullRequests) {
    if (isSameRepositoryHead(pr, repository)) reservedBranches.add(pr.head.ref);
    if (isSameRepositoryBase(pr, repository)) reservedBranches.add(pr.base.ref);
  }

  const closedBranchData = new Map<string, ClosedBranchData>();
  for (const pr of closedPullRequests) {
    if (
      pr.merged_at !== null ||
      !isSameRepositoryHead(pr, repository) ||
      !isSameRepositoryBase(pr, repository)
    )
      continue;
    const data = closedBranchData.get(pr.head.ref) ?? {
      shas: new Set<string>(),
      closedDates: [],
      invalidClosedDate: false,
    };
    data.shas.add(pr.head.sha);
    const closedDate =
      pr.closed_at === null ? new Date(Number.NaN) : new Date(pr.closed_at);
    if (Number.isNaN(closedDate.getTime())) data.invalidClosedDate = true;
    else data.closedDates.push(closedDate);
    closedBranchData.set(pr.head.ref, data);
  }

  const remoteBranchByName = new Map(
    remoteBranches.map((branch) => [branch.name, branch]),
  );
  const initialCandidates = [...closedBranchData.keys()]
    .filter((branch) => remoteBranchByName.has(branch))
    .sort();
  const preliminarilySafe: Array<{ branch: string; expectedSha: string }> = [];
  const now = (options.now ?? (() => new Date()))();
  const minimumAgeMs = options.minimumClosedAgeDays * 86_400_000;

  for (const branch of initialCandidates) {
    const branchInfo = remoteBranchByName.get(branch)!;
    const data = closedBranchData.get(branch)!;
    if (reservedBranches.has(branch)) {
      skip(result, logger, {
        branch,
        reason:
          "used as a default, head, or base branch by an open pull request",
      });
      continue;
    }
    if (matchesExclusion(branch, options.excludedBranches)) {
      skip(result, logger, { branch, reason: "matched exclude-branches" });
      continue;
    }
    if (data.shas.size !== 1) {
      skip(result, logger, { branch, reason: "ambiguous history" });
      continue;
    }
    if (data.invalidClosedDate || data.closedDates.length === 0) {
      skip(result, logger, { branch, reason: "missing or invalid closed_at" });
      continue;
    }
    const newestClosedAt = Math.max(
      ...data.closedDates.map((date) => date.getTime()),
    );
    if (now.getTime() - newestClosedAt < minimumAgeMs) {
      skip(result, logger, {
        branch,
        reason: "newest closed PR is younger than minimum-closed-age-days",
      });
      continue;
    }
    if (branchInfo.protected) {
      skip(result, logger, { branch, reason: "protected branch" });
      continue;
    }
    const [expectedSha] = data.shas;
    if (branchInfo.commit.sha !== expectedSha) {
      skip(result, logger, {
        branch,
        reason: "current SHA does not match a closed pull request head SHA",
      });
      continue;
    }
    preliminarilySafe.push({ branch, expectedSha: expectedSha! });
  }

  // Take run-wide snapshots once. A later per-candidate filtered check closes most of
  // the open-PR window without multiplying full-repository pagination cost.
  const safeToDelete: Array<{ branch: string; expectedSha: string }> = [];
  let latestOpenPullRequests: PullRequest[];
  if (preliminarilySafe.length === 0) return result;
  try {
    latestOpenPullRequests = await client.listPullRequests({
      owner: options.owner,
      repo: options.repo,
      state: "open",
    });
  } catch (error) {
    const [current, ...remaining] = preliminarilySafe;
    const reason = isRateLimitError(error)
      ? "GitHub rate limit encountered during final open-PR snapshot"
      : "failed to recheck open pull request heads and bases";
    fail(result, logger, { branch: current!.branch, reason });
    result.fatalError = reason;
    markNotAttempted(
      result,
      logger,
      remaining.map(({ branch }) => branch),
    );
    return result;
  }

  let latestRepositoryInfo;
  try {
    latestRepositoryInfo = await client.getRepository(
      options.owner,
      options.repo,
    );
  } catch (error) {
    const [current, ...remaining] = preliminarilySafe;
    const reason = isRateLimitError(error)
      ? "GitHub rate limit encountered during final repository snapshot"
      : "failed to recheck repository";
    fail(result, logger, { branch: current!.branch, reason });
    result.fatalError = reason;
    markNotAttempted(
      result,
      logger,
      remaining.map(({ branch }) => branch),
    );
    return result;
  }
  if (latestRepositoryInfo.fork && !options.allowForkRepositories) {
    const [current, ...remaining] = preliminarilySafe;
    const reason = "repository became or was detected as a fork";
    fail(result, logger, {
      branch: current!.branch,
      reason,
    });
    result.fatalError = reason;
    markNotAttempted(
      result,
      logger,
      remaining.map(({ branch }) => branch),
    );
    return result;
  }

  for (let index = 0; index < preliminarilySafe.length; index += 1) {
    const candidate = preliminarilySafe[index]!;
    const { branch, expectedSha } = candidate;
    const isReservedNow = latestOpenPullRequests.some(
      (pr) =>
        (isSameRepositoryHead(pr, repository) && pr.head.ref === branch) ||
        (isSameRepositoryBase(pr, repository) && pr.base.ref === branch),
    );
    if (isReservedNow) {
      skip(result, logger, {
        branch,
        reason: "used as an open pull request head or base during final check",
      });
      continue;
    }

    let latestBranchInfo: BranchInfo;
    try {
      latestBranchInfo = await client.getBranch(
        options.owner,
        options.repo,
        branch,
      );
    } catch (error) {
      if (isRateLimitError(error)) {
        const reason =
          "GitHub rate limit encountered during final branch check";
        fail(result, logger, { branch, reason });
        result.fatalError = reason;
        markNotAttempted(result, logger, [
          ...safeToDelete.map(({ branch: name }) => name),
          ...preliminarilySafe.slice(index + 1).map(({ branch: name }) => name),
        ]);
        return result;
      }
      if (isNotFound(error))
        skip(result, logger, {
          branch,
          reason: "branch not found during final check",
        });
      else fail(result, logger, { branch, reason: "failed to recheck branch" });
      continue;
    }
    if (
      latestBranchInfo.protected ||
      branch === latestRepositoryInfo.default_branch ||
      latestBranchInfo.commit.sha !== expectedSha ||
      matchesExclusion(branch, options.excludedBranches)
    ) {
      skip(result, logger, {
        branch,
        reason: "branch changed during final safety check",
      });
      continue;
    }
    safeToDelete.push(candidate);
  }

  result.candidateBranches = safeToDelete.map(({ branch }) => branch);
  if (options.dryRun) {
    for (const branch of result.candidateBranches) {
      logger.info(`[dry-run] Would delete branch: ${branch}`);
      result.skippedBranches.push({ branch, reason: "dry-run: would delete" });
    }
    if (safeToDelete.length > options.maxDeletions) {
      logger.notice(
        `${safeToDelete.length} candidates exceed max-deletions (${options.maxDeletions}); dry-run remains informational.`,
      );
    }
    return result;
  }

  if (safeToDelete.length > options.maxDeletions) {
    result.fatalError = `${safeToDelete.length} branches passed safety checks, exceeding max-deletions (${options.maxDeletions}); no branches were deleted.`;
    logger.warning(result.fatalError);
    markNotAttempted(result, logger, result.candidateBranches);
    return result;
  }

  const sleep = options.sleep ?? delay;
  let mutationStarted = false;
  for (let index = 0; index < safeToDelete.length; index += 1) {
    const { branch, expectedSha } = safeToDelete[index]!;
    if (mutationStarted) await sleep(1_000);
    let immediatelyOpenHeadPullRequests: PullRequest[];
    let immediatelyOpenBasePullRequests: PullRequest[];
    try {
      immediatelyOpenHeadPullRequests = await client.listPullRequests({
        owner: options.owner,
        repo: options.repo,
        state: "open",
        head: `${options.owner}:${branch}`,
      });
      immediatelyOpenBasePullRequests = await client.listPullRequests({
        owner: options.owner,
        repo: options.repo,
        state: "open",
        base: branch,
      });
    } catch (error) {
      const reason = isRateLimitError(error)
        ? "GitHub rate limit encountered during immediate open-PR recheck; stopped without retrying remaining branches"
        : "failed immediate open pull request head/base recheck";
      fail(result, logger, { branch, reason });
      if (isRateLimitError(error)) {
        result.fatalError = reason;
        markNotAttempted(
          result,
          logger,
          safeToDelete.slice(index + 1).map(({ branch: name }) => name),
        );
        break;
      }
      continue;
    }
    if (
      immediatelyOpenHeadPullRequests.some(
        (pr) => isSameRepositoryHead(pr, repository) && pr.head.ref === branch,
      ) ||
      immediatelyOpenBasePullRequests.some(
        (pr) => isSameRepositoryBase(pr, repository) && pr.base.ref === branch,
      )
    ) {
      skip(result, logger, {
        branch,
        reason:
          "used as an open pull request head or base immediately before deletion",
      });
      continue;
    }
    mutationStarted = true;
    try {
      await client.deleteBranchAtomically({
        repositoryId: repositoryInfo.node_id,
        branch,
        expectedSha,
      });
      logger.info(`Deleted branch: ${branch}`);
      result.deletedBranches.push(branch);
    } catch (error) {
      if (isRateLimitError(error)) {
        const reason =
          "GitHub rate limit encountered; stopped without retrying remaining branches";
        fail(result, logger, { branch, reason });
        result.fatalError = reason;
        markNotAttempted(
          result,
          logger,
          safeToDelete.slice(index + 1).map(({ branch: name }) => name),
        );
        break;
      }
      if (isNotFound(error)) {
        skip(result, logger, {
          branch,
          reason: "branch not found during deletion",
        });
      } else if (isExpectedShaMismatch(error)) {
        skip(result, logger, {
          branch,
          reason: "branch changed before atomic deletion",
        });
      } else {
        const status = errorStatus(error);
        fail(result, logger, {
          branch,
          reason: `atomic branch deletion failed${status === undefined ? "" : ` (HTTP ${status})`}`,
        });
      }
    }
  }
  return result;
}
