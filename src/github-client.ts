import { getOctokit } from "@actions/github";
import type {
  BranchInfo,
  GitHubClient,
  PullRequest,
  RepositoryInfo,
} from "./types.js";

const ZERO_OID = "0".repeat(40);

export function createGitHubClient(token: string): GitHubClient {
  const octokit = getOctokit(token);
  return {
    async listPullRequests({ owner, repo, state, head, base }) {
      const data = await octokit.paginate(octokit.rest.pulls.list, {
        owner,
        repo,
        state,
        ...(head === undefined ? {} : { head }),
        ...(base === undefined ? {} : { base }),
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
    async deleteBranchAtomically({ repositoryId, branch, expectedSha }) {
      await octokit.graphql(
        `mutation DeleteBranchAtomically($input: UpdateRefsInput!) {
          updateRefs(input: $input) { clientMutationId }
        }`,
        {
          input: {
            repositoryId,
            refUpdates: [
              {
                name: `refs/heads/${branch}`,
                beforeOid: expectedSha,
                afterOid: ZERO_OID,
              },
            ],
          },
        },
      );
    },
  };
}
