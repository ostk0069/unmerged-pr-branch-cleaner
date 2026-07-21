import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function assertContained(parent, child, label) {
  const relativePath = relative(parent, child);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} resolves outside ${parent}: ${child}`);
  }
}

async function readPackageInstance(node, dependencyName, nodeModulesRoot) {
  if (
    !node ||
    typeof node !== "object" ||
    typeof node.version !== "string" ||
    typeof node.path !== "string"
  ) {
    throw new Error(
      `Invalid installed dependency entry for ${dependencyName}.`,
    );
  }

  const packageDirectory = await realpath(node.path);
  assertContained(
    nodeModulesRoot,
    packageDirectory,
    `${dependencyName} package`,
  );

  const packageJsonPath = await realpath(
    join(packageDirectory, "package.json"),
  );
  assertContained(
    packageDirectory,
    packageJsonPath,
    `${dependencyName} package.json`,
  );
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (
    packageJson.name !== dependencyName ||
    packageJson.version !== node.version
  ) {
    throw new Error(
      `Installed metadata mismatch for ${dependencyName}@${node.version}: ` +
        `${packageJson.name}@${packageJson.version}.`,
    );
  }

  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const documentNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^(license|copying|notice)([._-].*)?$/i.test(name))
    .sort(compare);
  if (documentNames.length === 0) {
    throw new Error(
      `No LICENSE, COPYING, or NOTICE file found for ${dependencyName}.`,
    );
  }

  const documents = [];
  for (const name of documentNames) {
    const documentPath = await realpath(join(packageDirectory, name));
    assertContained(
      packageDirectory,
      documentPath,
      `${dependencyName} ${name}`,
    );
    if (!(await stat(documentPath)).isFile()) {
      throw new Error(`License artifact is not a file: ${documentPath}`);
    }
    documents.push({
      name,
      text: (await readFile(documentPath, "utf8")).trim(),
    });
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
    license: packageJson.license ?? "See text below",
    documents,
    path: packageDirectory,
  };
}

function formatSection(packageRecord) {
  const documentText =
    packageRecord.documents.length === 1
      ? packageRecord.documents[0].text
      : packageRecord.documents
          .map(({ name, text }) => `### ${name}\n\n${text}`)
          .join("\n\n");
  return `## ${packageRecord.name}@${packageRecord.version}\n\nLicense: ${packageRecord.license}\n\n${documentText}`;
}

export async function buildThirdPartyNotices({
  installedGraph,
  projectRoot,
  expectedDirectDependencies,
}) {
  const roots = Array.isArray(installedGraph)
    ? installedGraph
    : [installedGraph];
  if (roots.length !== 1 || !roots[0] || typeof roots[0] !== "object") {
    throw new Error("Expected exactly one installed workspace root.");
  }

  const canonicalRoot = await realpath(projectRoot);
  const nodeModulesRoot = await realpath(join(canonicalRoot, "node_modules"));
  const rootDependencies = roots[0].dependencies ?? {};
  const missingDirectDependencies = expectedDirectDependencies.filter(
    (name) => !Object.hasOwn(rootDependencies, name),
  );
  if (missingDirectDependencies.length > 0) {
    throw new Error(
      `Installed production graph is missing direct dependencies: ${missingDirectDependencies.sort(compare).join(", ")}.`,
    );
  }

  const visitedInstances = new Set();
  const packagesByIdentity = new Map();
  async function visitDependencies(dependencies) {
    for (const dependencyName of Object.keys(dependencies ?? {}).sort(
      compare,
    )) {
      const node = dependencies[dependencyName];
      const instance = await readPackageInstance(
        node,
        dependencyName,
        nodeModulesRoot,
      );
      const instanceKey = `${instance.name}@${instance.version}\0${instance.path}`;
      if (!visitedInstances.has(instanceKey)) {
        visitedInstances.add(instanceKey);

        const identity = `${instance.name}@${instance.version}`;
        const comparable = JSON.stringify({
          license: instance.license,
          documents: instance.documents,
        });
        const existing = packagesByIdentity.get(identity);
        if (existing && existing.comparable !== comparable) {
          throw new Error(
            `License artifacts differ between instances of ${identity}.`,
          );
        }
        packagesByIdentity.set(identity, { instance, comparable });
      }

      // pnpm may omit children on one deduped occurrence and expand them on another.
      await visitDependencies(node.dependencies);
      await visitDependencies(node.optionalDependencies);
    }
  }

  await visitDependencies(rootDependencies);
  await visitDependencies(roots[0].optionalDependencies);

  const sections = [...packagesByIdentity.values()]
    .map(({ instance }) => formatSection(instance))
    .sort(compare);
  return `# Third-Party Notices\n\nThis distribution includes the following production dependencies.\n\n${sections.join("\n\n---\n\n")}\n`;
}
