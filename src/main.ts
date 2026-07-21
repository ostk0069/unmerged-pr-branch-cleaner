import * as core from "@actions/core";
import { cleanBranches } from "./cleaner.js";
import { createGitHubClient } from "./github-client.js";
import {
  parseBoolean,
  parseInteger,
  parsePatterns,
  parseRepository,
} from "./input.js";
import type { BranchOutcome } from "./types.js";

const OUTPUT_BUDGET_BYTES = 80 * 1024;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

export function truncateJsonArray<T>(
  values: readonly T[],
  budget = OUTPUT_BUDGET_BYTES,
): {
  json: string;
  truncated: boolean;
} {
  if (Buffer.byteLength(JSON.stringify(values), "utf8") <= budget) {
    return { json: JSON.stringify(values), truncated: false };
  }
  const included: T[] = [];
  for (const value of values) {
    const next = [...included, value];
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > budget) break;
    included.push(value);
  }
  return { json: JSON.stringify(included), truncated: true };
}

function setInitialOutputs(): void {
  for (const name of [
    "deleted-count",
    "deleted-total",
    "skipped-total",
    "failed-total",
    "candidate-count",
  ])
    core.setOutput(name, 0);
  for (const name of [
    "candidate-branches",
    "deleted-branches",
    "skipped-branches",
    "failed-branches",
  ])
    core.setOutput(name, "[]");
  core.setOutput("outputs-truncated", "false");
}

function setResultOutputs(result: {
  candidateBranches: string[];
  deletedBranches: string[];
  skippedBranches: BranchOutcome[];
  failedBranches: BranchOutcome[];
}): void {
  core.setOutput("deleted-count", result.deletedBranches.length);
  core.setOutput("deleted-total", result.deletedBranches.length);
  core.setOutput("skipped-total", result.skippedBranches.length);
  core.setOutput("failed-total", result.failedBranches.length);
  core.setOutput("candidate-count", result.candidateBranches.length);
  const outputs = [
    ["candidate-branches", result.candidateBranches],
    ["deleted-branches", result.deletedBranches],
    ["skipped-branches", result.skippedBranches],
    ["failed-branches", result.failedBranches],
  ] as const;
  let truncated = false;
  for (const [name, values] of outputs) {
    const output = truncateJsonArray(values as readonly unknown[]);
    core.setOutput(name, output.json);
    truncated ||= output.truncated;
  }
  core.setOutput("outputs-truncated", String(truncated));
}

export async function run(): Promise<void> {
  setInitialOutputs();
  try {
    const token = core.getInput("github-token", { required: true });
    core.setSecret(token);
    const { owner, repo } = parseRepository(
      process.env.GITHUB_REPOSITORY ?? "",
    );
    const result = await cleanBranches(
      createGitHubClient(token),
      { info: core.info, notice: core.notice, warning: core.warning },
      {
        owner,
        repo,
        dryRun: parseBoolean(core.getInput("dry-run"), "dry-run"),
        maxDeletions: parseInteger(
          core.getInput("max-deletions"),
          "max-deletions",
          1,
        ),
        excludedBranches: parsePatterns(core.getInput("exclude-branches")),
        minimumClosedAgeDays: parseInteger(
          core.getInput("minimum-closed-age-days"),
          "minimum-closed-age-days",
          0,
        ),
        allowForkRepositories: parseBoolean(
          core.getInput("allow-fork-repositories"),
          "allow-fork-repositories",
        ),
      },
    );
    setResultOutputs(result);

    const detailRows = [
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
    ].map((row) => row.map(escapeHtml));
    const detailLimit = 50;
    const summaryBuilder = core.summary
      .addHeading("Unmerged PR branch cleanup")
      .addTable([
        [
          { data: "Result", header: true },
          { data: "Count", header: true },
        ],
        ["Candidates", String(result.candidateBranches.length)],
        ["Deleted", String(result.deletedBranches.length)],
        ["Skipped", String(result.skippedBranches.length)],
        ["Failed", String(result.failedBranches.length)],
      ]);
    if (detailRows.length > 0) {
      summaryBuilder.addHeading("Details", 3).addTable([
        [
          { data: "Result", header: true },
          { data: "Branch", header: true },
          { data: "Reason", header: true },
        ],
        ...detailRows.slice(0, detailLimit),
      ]);
    }
    if (detailRows.length > detailLimit) {
      summaryBuilder.addRaw(
        `\n${escapeHtml(String(detailRows.length - detailLimit))} additional result(s) omitted. Outputs may also be truncated; inspect outputs-truncated and the total outputs.\n`,
      );
    }
    await summaryBuilder.write();

    if (result.fatalError) core.setFailed(result.fatalError);
    else if (result.failedBranches.length > 0) {
      core.setFailed(
        `${result.failedBranches.length} branch(es) could not be safely processed.`,
      );
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
