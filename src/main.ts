import * as core from "@actions/core";
import { cleanBranches } from "./cleaner.js";
import { createGitHubClient } from "./github-client.js";
import { parseBoolean, parseRepository } from "./input.js";

export async function run(): Promise<void> {
  core.setOutput("deleted-count", 0);
  core.setOutput("deleted-branches", "[]");
  core.setOutput("skipped-branches", "[]");
  core.setOutput("failed-branches", "[]");
  try {
    const token = core.getInput("github-token", { required: true });
    const { owner, repo } = parseRepository(
      process.env.GITHUB_REPOSITORY ?? "",
    );
    const dryRun = parseBoolean(core.getInput("dry-run"), "dry-run");
    const result = await cleanBranches(
      createGitHubClient(token),
      { info: core.info, notice: core.notice, warning: core.warning },
      {
        owner,
        repo,
        dryRun,
      },
    );

    core.setOutput("deleted-count", result.deletedBranches.length);
    core.setOutput("deleted-branches", JSON.stringify(result.deletedBranches));
    core.setOutput("skipped-branches", JSON.stringify(result.skippedBranches));
    core.setOutput("failed-branches", JSON.stringify(result.failedBranches));

    const detailRows: string[][] = [
      ...result.deletedBranches.map((branch) => ["Deleted", branch, "—"]),
      ...result.skippedBranches.map(({ branch, reason }) => [
        "Skipped",
        branch,
        reason,
      ]),
      ...result.failedBranches.map(({ branch, reason }) => [
        "Failed",
        branch,
        reason,
      ]),
    ];
    const detailLimit = 50;
    const displayedDetailRows = detailRows.slice(0, detailLimit);
    const summaryBuilder = core.summary
      .addHeading("Unmerged PR branch cleanup")
      .addTable([
        [
          { data: "Result", header: true },
          { data: "Count", header: true },
        ],
        ["Deleted", String(result.deletedBranches.length)],
        ["Skipped", String(result.skippedBranches.length)],
        ["Failed", String(result.failedBranches.length)],
      ]);
    if (displayedDetailRows.length > 0) {
      summaryBuilder.addHeading("Details", 3).addTable([
        [
          { data: "Result", header: true },
          { data: "Branch", header: true },
          { data: "Reason", header: true },
        ],
        ...displayedDetailRows,
      ]);
    }
    if (detailRows.length > detailLimit) {
      summaryBuilder.addRaw(
        `\n${detailRows.length - detailLimit} additional result(s) omitted. Use the action outputs for the complete list.\n`,
      );
    }
    await summaryBuilder.write();

    if (result.failedBranches.length > 0) {
      core.setFailed(
        `${result.failedBranches.length} branch(es) could not be safely processed.`,
      );
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
