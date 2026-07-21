import { getOctokit } from "@actions/github";
import type {
  BranchInfo,
  GitHubClient,
  PullRequest,
  RepositoryInfo,
} from "./types.js";

export function createGitHubClient(token: string): GitHubClient {
  const octokit = getOctokit(token);
  return {
    async listPullRequests({ owner, repo, state, head }) {
      const data = await octokit.paginate(octokit.rest.pulls.list, {
        owner,
        repo,
        state,
        ...(head === undefined ? {} : { head }),
        per_page: 100,
      });
      return data as PullRequest[];
    },
    async getRepository(owner, repo) {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return data as RepositoryInfo;
    },
    async listBranches(owner, repo) {
      const data = await octokit.paginate(octokit.rest.repos.listBranches, {
        owner,
        repo,
        per_page: 100,
      });
      return data as BranchInfo[];
    },
    async getBranch(owner, repo, branch) {
      const { data } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch,
      });
      return data as BranchInfo;
    },
    async deleteBranch(owner, repo, branch) {
      await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    },
  };
}
