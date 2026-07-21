export interface PullRequestRepository {
  full_name: string;
}

export interface PullRequestHead {
  ref: string;
  sha: string;
  repo: PullRequestRepository | null;
}

export interface PullRequestBase {
  ref: string;
  repo: PullRequestRepository;
}

export interface PullRequest {
  merged_at: string | null;
  closed_at: string | null;
  head: PullRequestHead;
  base: PullRequestBase;
}

export interface BranchInfo {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

export interface RepositoryInfo {
  default_branch: string;
  node_id: string;
  fork: boolean;
}

export interface GitHubClient {
  listPullRequests(params: {
    owner: string;
    repo: string;
    state: "open" | "closed";
    head?: string;
    base?: string;
  }): Promise<PullRequest[]>;
  listBranches(owner: string, repo: string): Promise<BranchInfo[]>;
  getRepository(owner: string, repo: string): Promise<RepositoryInfo>;
  getBranch(owner: string, repo: string, branch: string): Promise<BranchInfo>;
  deleteBranchAtomically(params: {
    repositoryId: string;
    branch: string;
    expectedSha: string;
  }): Promise<void>;
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
  maxDeletions: number;
  excludedBranches: string[];
  minimumClosedAgeDays: number;
  allowForkRepositories: boolean;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface BranchOutcome {
  branch: string;
  reason: string;
}

export interface CleanupResult {
  candidateBranches: string[];
  deletedBranches: string[];
  skippedBranches: BranchOutcome[];
  failedBranches: BranchOutcome[];
  fatalError?: string;
}
