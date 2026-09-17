import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = JSON.parse(read('package.json'));
const workspaceYaml = read('pnpm-workspace.yaml');
const lockfile = path.join(root, 'pnpm-lock.yaml');

assert(fs.existsSync(lockfile), 'pnpm-lock.yaml não encontrado.');
assert(fs.existsSync(path.join(root, '.env.test.example')), '.env.test.example não encontrado.');
assert(packageJson.packageManager === 'pnpm@9.0.0', 'packageManager deve permanecer em pnpm@9.0.0.');
assert(packageJson.engines?.node === '>=22.13.0 <23', 'A versão suportada do Node deve ser >=22.13.0 <23.');

for (const entry of ['apps', 'packages']) {
  const directory = path.join(root, entry);
  assert(fs.existsSync(directory), `Diretório ${entry}/ não encontrado.`);
  if (!fs.existsSync(directory)) continue;

  const projects = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'));
  assert(projects.length > 0, `${entry}/* não encontrou nenhum projeto.`);
  for (const project of projects) {
    assert(
      fs.existsSync(path.join(directory, project.name, 'package.json')),
      `${entry}/${project.name} não possui package.json.`,
    );
    if (entry === 'packages') {
      assert(
        fs.existsSync(path.join(directory, project.name, 'README.md')),
        `${entry}/${project.name} não possui README.md de ownership.`,
      );
    }
  }
}

assert(!/^\s+-\s+['"](?:mcp|context7)(?:\/|['"])/m.test(workspaceYaml), 'pnpm-workspace.yaml contém workspace ausente (mcp/context7).');

for (const relativePath of ['.vscode/tasks.json', 'apps/.vscode/tasks.json', 'mcp.config.json', '.vscode/mcp.json']) {
  if (!relativePath.endsWith('.json')) continue;
  if (relativePath.includes('tasks')) {
    const tasks = JSON.parse(read(relativePath));
    const labels = tasks.tasks.map((task) => task.label);
    assert(new Set(labels).size === labels.length, `${relativePath} contém labels de task duplicados.`);
    continue;
  }
  JSON.parse(read(relativePath));
}

for (const relativePath of ['apps/web/tsconfig.json', 'apps/web/tsconfig.build.json']) {
  const content = read(relativePath);
  assert(!content.includes('context7'), `${relativePath} contém referência a context7 ausente.`);
}

if (failures.length > 0) {
  console.error('[workspace:check] FALHOU');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[workspace:check] OK: estrutura, versões, lockfile, tasks e referências locais consistentes.');
}
