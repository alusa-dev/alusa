import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputPath = path.join(root, 'docs/architecture/package-dependency-graph.json');
const compatibilityBaselinePath = path.join(root, 'docs/quality/package-compatibility-baseline.json');
const workspaceRoots = ['apps', 'packages'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const testFilePattern = /(?:\.test|\.spec)\.[^.]+$/;

const forbiddenManifestDependencies = {
  '@alusa/shared': new Set([
    '@alusa/database',
    '@alusa/finance',
    '@alusa/lib',
    '@alusa/platform-billing',
    '@alusa/asaas',
    '@alusa/asaas-gateway',
    '@alusa/ui',
    '@prisma/client',
    'next',
  ]),
  '@alusa/domain': new Set([
    '@alusa/database',
    '@alusa/finance',
    '@alusa/lib',
    '@alusa/platform-billing',
    '@alusa/asaas',
    '@alusa/asaas-gateway',
    '@prisma/client',
    'next',
  ]),
  '@alusa/asaas': new Set([
    '@alusa/admin-auth',
    '@alusa/asaas-gateway',
    '@alusa/database',
    '@alusa/domain',
    '@alusa/finance',
    '@alusa/lib',
    '@alusa/platform-billing',
    '@alusa/shared',
    '@alusa/stripe',
    '@alusa/ui',
    '@alusa/whatsapp',
  ]),
  '@alusa/asaas-gateway': new Set([
    '@alusa/admin-auth',
    '@alusa/database',
    '@alusa/domain',
    '@alusa/finance',
    '@alusa/lib',
    '@alusa/platform-billing',
    '@prisma/client',
    'next',
  ]),
  '@alusa/database': new Set([
    '@alusa/asaas',
    '@alusa/asaas-gateway',
    '@alusa/finance',
    '@alusa/lib',
    '@alusa/platform-billing',
    '@alusa/ui',
    'next',
    'react',
  ]),
  '@alusa/ui': new Set([
    '@alusa/asaas',
    '@alusa/asaas-gateway',
    '@alusa/database',
    '@alusa/domain',
    '@alusa/finance',
    '@alusa/lib',
    'next',
  ]),
  '@alusa/platform-billing': new Set([
    '@alusa/asaas',
    '@alusa/asaas-gateway',
    '@alusa/domain',
    '@alusa/finance',
    '@alusa/lib',
    'next',
  ]),
  '@alusa/whatsapp': new Set([
    '@alusa/database',
    '@alusa/finance',
    '@alusa/lib',
    'next',
  ]),
};

const compatibilityImportAllowlist = new Map([
  [
    '@alusa/lib→@alusa/finance',
    'ponte temporária do adapter de ciclo de vida de aluno; migrar para o bounded context de alunos antes de remover o barrel de compatibilidade',
  ],
]);

function packageDirectories() {
  return workspaceRoots.flatMap((workspaceRoot) => {
    const directory = path.join(root, workspaceRoot);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(directory, entry.name))
      .filter((directoryPath) => fs.existsSync(path.join(directoryPath, 'package.json')));
  });
}

function readPackage(directory) {
  const manifestPath = path.join(directory, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dependencyMap = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  return {
    name: manifest.name,
    directory: path.relative(root, directory),
    manifestPath: path.relative(root, manifestPath),
    dependencies: new Set(Object.keys(dependencyMap ?? {})),
  };
}

function walkSources(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.next', 'coverage', '.turbo'].includes(entry.name)) {
        files.push(...walkSources(absolutePath));
      }
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name)) && !testFilePattern.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function sourceFilesForPackage(directory) {
  return ['src', 'app', 'features', 'lib', 'components'].flatMap((segment) =>
    walkSources(path.join(directory, segment)),
  );
}

function collectWorkspaceImports(source) {
  const imports = new Set();
  const pattern = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](@alusa\/[A-Za-z0-9-]+)(?:\/[^'"]*)?['"]/g;
  for (const match of source.matchAll(pattern)) imports.add(match[1]);
  return imports;
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) visit(node);
  return cycles;
}

function buildGraph() {
  const packages = packageDirectories().map(readPackage).sort((a, b) => a.name.localeCompare(b.name));
  const packageByName = new Map(packages.map((item) => [item.name, item]));
  const manifestGraph = new Map(packages.map((item) => [
    item.name,
    [...item.dependencies].filter((dependency) => packageByName.has(dependency)).sort(),
  ]));
  const forbidden = [];
  const runtimeImports = new Map();

  for (const item of packages) {
    const forbiddenDependencies = forbiddenManifestDependencies[item.name] ?? new Set();
    for (const dependency of item.dependencies) {
      if (forbiddenDependencies.has(dependency)) {
        forbidden.push({ package: item.name, dependency, manifest: item.manifestPath });
      }
    }

    const importsByPackage = new Map();
    for (const file of sourceFilesForPackage(path.join(root, item.directory))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const dependency of collectWorkspaceImports(source)) {
        if (!packageByName.has(dependency)) continue;
        const files = importsByPackage.get(dependency) ?? [];
        files.push(path.relative(root, file));
        importsByPackage.set(dependency, files);
      }
    }
    for (const [dependency, files] of importsByPackage) {
      const edgeKey = `${item.name}→${dependency}`;
      const declared = item.dependencies.has(dependency);
      const compatibilityReason = compatibilityImportAllowlist.get(edgeKey);
      if (!declared && !compatibilityReason) {
        forbidden.push({
          package: item.name,
          dependency,
          files: [...new Set(files)].sort(),
          reason: 'import runtime sem dependência declarada no package.json',
        });
      }
      runtimeImports.set(edgeKey, {
        from: item.name,
        to: dependency,
        declared,
        compatibility: compatibilityReason ?? null,
        files: [...new Set(files)].sort(),
      });
    }
  }

  const cycles = findCycles(manifestGraph);
  const importEdges = [...runtimeImports.values()].sort((a, b) =>
    `${a.from}→${a.to}`.localeCompare(`${b.from}→${b.to}`),
  );
  const declaredEdges = packages.flatMap((item) =>
    (manifestGraph.get(item.name) ?? []).map((dependency) => `${item.name}→${dependency}`),
  ).sort();

  return {
    generatedAt: 'deterministic',
    summary: {
      packages: packages.length,
      declaredWorkspaceEdges: declaredEdges.length,
      runtimeWorkspaceEdges: importEdges.length,
      compatibilityEdges: importEdges.filter((edge) => edge.compatibility).length,
      cycles: cycles.length,
      violations: forbidden.length,
    },
    packages: packages.map((item) => ({
      name: item.name,
      directory: item.directory,
      workspaceDependencies: manifestGraph.get(item.name) ?? [],
    })),
    runtimeImports: importEdges,
    compatibilityImports: importEdges.filter((edge) => edge.compatibility),
    cycles,
    violations: forbidden,
  };
}

const graph = buildGraph();
const serialized = `${JSON.stringify(graph, null, 2)}\n`;
const expectedCompatibilityEdges = fs.existsSync(compatibilityBaselinePath)
  ? new Set(JSON.parse(fs.readFileSync(compatibilityBaselinePath, 'utf8')).map((item) => item.edge))
  : null;
const actualCompatibilityEdges = new Set(graph.compatibilityImports.map((edge) => `${edge.from}→${edge.to}`));
const compatibilityRegressions = expectedCompatibilityEdges
  ? [
      ...[...actualCompatibilityEdges]
        .filter((edge) => !expectedCompatibilityEdges.has(edge))
        .map((edge) => `nova ponte não aprovada: ${edge}`),
      ...[...expectedCompatibilityEdges]
        .filter((edge) => !actualCompatibilityEdges.has(edge))
        .map((edge) => `ponte aprovada ausente: ${edge}`),
    ]
  : [`baseline ausente: ${path.relative(root, compatibilityBaselinePath)}`];

if (process.argv.includes('--write')) {
  fs.writeFileSync(outputPath, serialized, 'utf8');
  console.log(`[package-graph] escrito ${path.relative(root, outputPath)}`);
} else if (!fs.existsSync(outputPath)) {
  console.error(`[package-graph] FALHOU: arquivo ausente ${path.relative(root, outputPath)}`);
  process.exitCode = 1;
} else if (fs.readFileSync(outputPath, 'utf8') !== serialized) {
  console.error('[package-graph] FALHOU: grafo desatualizado; execute pnpm audit:package-graph -- --write.');
  process.exitCode = 1;
}

console.log(`[package-graph] packages=${graph.summary.packages}`);
console.log(`[package-graph] declared-workspace-edges=${graph.summary.declaredWorkspaceEdges}`);
console.log(`[package-graph] runtime-workspace-edges=${graph.summary.runtimeWorkspaceEdges}`);
console.log(`[package-graph] compatibility-edges=${graph.summary.compatibilityEdges}`);
console.log(`[package-graph] cycles=${graph.summary.cycles}`);
console.log(`[package-graph] violations=${graph.summary.violations}`);

if (compatibilityRegressions.length > 0) {
  console.error('[package-graph] FALHOU: baseline de compatibility edges divergente.');
  for (const regression of compatibilityRegressions) console.error(`- ${regression}`);
  process.exitCode = 1;
}

if (graph.cycles.length > 0) {
  console.error('[package-graph] FALHOU: ciclo entre packages do workspace.');
  for (const cycle of graph.cycles) console.error(`- ${cycle.join(' -> ')}`);
  process.exitCode = 1;
}
if (graph.violations.length > 0) {
  console.error('[package-graph] FALHOU: dependência/import proibido ou não declarado.');
  for (const violation of graph.violations) {
    console.error(`- ${violation.package} -> ${violation.dependency}${violation.reason ? ` (${violation.reason})` : ''}`);
  }
  process.exitCode = 1;
}
