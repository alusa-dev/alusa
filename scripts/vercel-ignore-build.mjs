import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectName = process.argv[2];

if (!['@alusa/web', '@alusa/admin'].includes(projectName)) {
  console.error(`Projeto inválido para o Ignored Build Step: ${projectName ?? '(ausente)'}`);
  process.exit(1);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.VERCEL_GIT_PREVIOUS_SHA?.trim();
const head = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'HEAD';

// Vercel can provide a shallow checkout (and the first deployment has no
// previous SHA). In either case Turbo cannot prove that the app is unaffected;
// keep the deployment enabled instead of guessing from an incomplete diff.
if (!base || /^0+$/.test(base)) {
  console.error('Base de comparação ausente; mantendo o build por segurança.');
  process.exit(1);
}

const baseCheck = spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], {
  cwd: repositoryRoot,
  stdio: 'ignore',
});
const headCheck = spawnSync('git', ['cat-file', '-e', `${head}^{commit}`], {
  cwd: repositoryRoot,
  stdio: 'ignore',
});

if (baseCheck.status !== 0 || headCheck.status !== 0) {
  console.error('Commits de comparação indisponíveis no checkout da Vercel; mantendo o build.');
  process.exit(1);
}

// Turbo treats a change to docs/architecture/package-dependency-graph.json as
// a root dependency change, even though it cannot affect an application build.
// Classify the complete diff first so documentation-only commits can skip.
const changedPaths = spawnSync('git', ['diff', '--name-only', '--no-renames', base, head], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});

if (changedPaths.error || changedPaths.status !== 0 || !changedPaths.stdout?.trim()) {
  console.error('Não foi possível listar as alterações; mantendo o build por segurança.');
  process.exit(1);
}

const files = changedPaths.stdout.trim().split('\n');
console.log(`Arquivos alterados (${files.length}):\n${files.join('\n')}`);
const isDocumentationPath = (file) => file.startsWith('docs/') || /\.(md|mdx)$/i.test(file);
const documentationOnly = files.every(isDocumentationPath);

if (documentationOnly) {
  console.log('Somente documentação/Markdown alterado; ignorando o build.');
  process.exit(0);
}

// Preserve app-level isolation for direct app changes, including commits that
// also update documentation. Shared packages and global config still use Turbo.
const codeFiles = files.filter((file) => !isDocumentationPath(file));
const appPaths = {
  '@alusa/web': 'apps/web/',
  '@alusa/admin': 'apps/admin/',
};
const appScopedOnly = codeFiles.every((file) =>
  Object.values(appPaths).some((appPath) => file.startsWith(appPath)),
);

if (appScopedOnly) {
  const affectsProject = codeFiles.some((file) => file.startsWith(appPaths[projectName]));
  console.log(
    affectsProject
      ? `Alteração direta em ${projectName}; mantendo o build.`
      : `Alteração direta em outro app; ignorando o build de ${projectName}.`,
  );
  process.exit(affectsProject ? 1 : 0);
}

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'turbo',
    'query',
    'affected',
    '--base',
    base,
    '--head',
    head,
    '--packages',
    projectName,
    '--exit-code',
  ],
  {
    cwd: repositoryRoot,
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error || ![0, 1].includes(result.status)) {
  // Falha na análise nunca pode bloquear uma publicação potencialmente
  // necessária. O código 1 continua o build na Vercel.
  console.error('Não foi possível concluir a análise de impacto; mantendo o build por segurança.');
  process.exit(1);
}

if (result.status === 0) {
  console.log(`Nenhuma alteração afeta ${projectName}; ignorando o build.`);
  process.exit(0);
}

// O Turbo retorna 1 quando há alteração afetada.
console.log(`Alteração afeta ${projectName}; mantendo o build.`);
process.exit(1);
