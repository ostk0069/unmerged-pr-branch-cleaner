export interface PullRequestHead {
  ref: string;
  sha: string;
  repo: { full_name: string } | null;
}

export interface PullRequest {
  merged_at: string | null;
  head: PullRequestHead;
  base: { repo: { full_name: string } };
}

export interface BranchInfo {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

export interface RepositoryInfo {
  default_branch: string;
}

export interface GitHubClient {
  listPullRequests(params: {
    owner: string;
    repo: string;
    state: "open" | "closed";
    head?: string;
  }): Promise<PullRequest[]>;
  listBranches(owner: string, repo: string): Promise<BranchInfo[]>;
  getRepository(owner: string, repo: string): Promise<RepositoryInfo>;
  getBranch(owner: string, repo: string, branch: string): Promise<BranchInfo>;
  deleteBranch(owner: string, repo: string, branch: string): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  notice(message: string): void;
  warning(message: string): void;
}

export interface CleanerOptions {
  owner: string;
  repo: string;
  dryRun: boolean;
}

export interface BranchOutcome {
  branch: string;
  reason: string;
}

export interface CleanupResult {
  deletedBranches: string[];
  skippedBranches: BranchOutcome[];
  failedBranches: BranchOutcome[];
}
