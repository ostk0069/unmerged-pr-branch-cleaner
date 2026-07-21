import { isNotFound } from "./errors.js";
import type {
  BranchInfo,
  CleanerOptions,
  CleanupResult,
  GitHubClient,
  Logger,
  PullRequest,
  RepositoryInfo,
} from "./types.js";

function isSameRepositoryPullRequest(
  pr: PullRequest,
  repository: string,
): boolean {
  return (
    pr.head.repo?.full_name === repository &&
    pr.base.repo.full_name === repository
  );
}

export async function cleanBranches(
  client: GitHubClient,
  logger: Logger,
  options: CleanerOptions,
): Promise<CleanupResult> {
  const repository = `${options.owner}/${options.repo}`;
  const [closedPullRequests, openPullRequests, repositoryInfo, remoteBranches] =
    await Promise.all([
      client.listPullRequests({
        owner: options.owner,
        repo: options.repo,
        state: "closed",
      }),
      client.listPullRequests({
        owner: options.owner,
        repo: options.repo,
        state: "open",
      }),
      client.getRepository(options.owner, options.repo),
      client.listBranches(options.owner, options.repo),
    ]);

  const openBranches = new Set(
    openPullRequests
      .filter((pr) => isSameRepositoryPullRequest(pr, repository))
      .map((pr) => pr.head.ref),
  );
  const closedBranchShas = new Map<string, Set<string>>();
  for (const pullRequest of closedPullRequests) {
    if (
      pullRequest.merged_at !== null ||
      !isSameRepositoryPullRequest(pullRequest, repository)
    )
      continue;
    const shas =
      closedBranchShas.get(pullRequest.head.ref) ?? new Set<string>();
    shas.add(pullRequest.head.sha);
    closedBranchShas.set(pullRequest.head.ref, shas);
  }
  const remoteBranchByName = new Map(
    remoteBranches.map((branch) => [branch.name, branch]),
  );
  const candidates = [...closedBranchShas.keys()]
    .filter((branch) => remoteBranchByName.has(branch))
    .sort();

  const result: CleanupResult = {
    deletedBranches: [],
    skippedBranches: [],
    failedBranches: [],
  };

  for (const branch of candidates) {
    const branchInfo = remoteBranchByName.get(branch)!;
    if (branch === repositoryInfo.default_branch || openBranches.has(branch)) {
      logger.notice(`Skipping reserved or open pull request branch: ${branch}`);
      result.skippedBranches.push({
        branch,
        reason:
          branch === repositoryInfo.default_branch
            ? "default branch"
            : "used by an open pull request",
      });
      continue;
    }

    const closedShas = closedBranchShas.get(branch)!;
    if (closedShas.size > 1) {
      logger.notice(
        `Skipping branch with ambiguous closed PR history: ${branch}`,
      );
      result.skippedBranches.push({ branch, reason: "ambiguous history" });
      continue;
    }

    if (branchInfo.protected) {
      logger.notice(`Skipping protected branch: ${branch}`);
      result.skippedBranches.push({ branch, reason: "protected branch" });
      continue;
    }

    if (!closedShas.has(branchInfo.commit.sha)) {
      logger.notice(
        `Skipping branch whose current SHA differs from the closed pull request: ${branch}`,
      );
      result.skippedBranches.push({
        branch,
        reason: "current SHA does not match a closed pull request head SHA",
      });
      continue;
    }

    let currentOpenPullRequests: PullRequest[];
    try {
      currentOpenPullRequests = await client.listPullRequests({
        owner: options.owner,
        repo: options.repo,
        state: "open",
        head: `${options.owner}:${branch}`,
      });
    } catch {
      logger.warning(
        `Failed to recheck open pull requests; branch was not deleted: ${branch}`,
      );
      result.failedBranches.push({
        branch,
        reason: "failed to recheck open pull requests",
      });
      continue;
    }
    if (
      currentOpenPullRequests.some(
        (pr) =>
          isSameRepositoryPullRequest(pr, repository) && pr.head.ref === branch,
      )
    ) {
      logger.notice(
        `Skipping branch currently used by an open pull request: ${branch}`,
      );
      result.skippedBranches.push({
        branch,
        reason: "used by an open pull request during final check",
      });
      continue;
    }

    let latestRepositoryInfo: RepositoryInfo;
    try {
      latestRepositoryInfo = await client.getRepository(
        options.owner,
        options.repo,
      );
    } catch {
      logger.warning(
        `Failed to recheck repository default branch; branch was not deleted: ${branch}`,
      );
      result.failedBranches.push({
        branch,
        reason: "failed to recheck repository default branch",
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
      if (isNotFound(error)) {
        logger.info(`Branch no longer exists: ${branch}`);
        result.skippedBranches.push({
          branch,
          reason: "branch not found during final check",
        });
        continue;
      }
      logger.warning(`Failed to recheck branch; it was not deleted: ${branch}`);
      result.failedBranches.push({
        branch,
        reason: "failed to recheck branch",
      });
      continue;
    }

    if (
      latestBranchInfo.protected ||
      branch === latestRepositoryInfo.default_branch ||
      !closedShas.has(latestBranchInfo.commit.sha)
    ) {
      logger.notice(`Skipping branch changed during safety checks: ${branch}`);
      result.skippedBranches.push({
        branch,
        reason: "branch changed during final safety check",
      });
      continue;
    }

    if (options.dryRun) {
      logger.info(`[dry-run] Would delete branch: ${branch}`);
      result.skippedBranches.push({ branch, reason: "dry-run: would delete" });
      continue;
    }

    try {
      await client.deleteBranch(options.owner, options.repo, branch);
      logger.info(`Deleted branch: ${branch}`);
      result.deletedBranches.push(branch);
    } catch (error) {
      if (isNotFound(error)) {
        logger.info(`Branch no longer exists: ${branch}`);
        result.skippedBranches.push({
          branch,
          reason: "branch not found during deletion",
        });
      } else {
        logger.warning(`Failed to delete branch: ${branch}`);
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? ` (HTTP ${String(error.status)})`
            : "";
        result.failedBranches.push({
          branch,
          reason: `failed to delete branch${status}`,
        });
      }
    }
  }

  return result;
}
