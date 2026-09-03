import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectName = process.argv[2];
const projectDirectories = {
  '@alusa/web': 'web',
  '@alusa/admin': 'admin',
};

if (!projectDirectories[projectName]) {
  console.error(`Projeto inválido para o Ignored Build Step: ${projectName ?? '(ausente)'}`);
  process.exit(1);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDirectory = `apps/${projectDirectories[projectName]}`;

// O grafo do Turbo não inclui automaticamente todos os artefatos operacionais
// que alteram o resultado do deploy, especialmente o schema/migrations do Prisma.
// Estes caminhos sempre exigem uma nova publicação para evitar falso negativo.
const alwaysBuildPaths = [
  '.npmrc',
  '.vercelignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.base.json',
  'eslint.config.js',
  'vercel.json',
  'prisma/schema.prisma',
  'prisma/migrations',
  'scripts/vercel-ignore-build.mjs',
  `${appDirectory}/package.json`,
  `${appDirectory}/vercel.json`,
  `${appDirectory}/next.config.mjs`,
  `${appDirectory}/proxy.ts`,
  `${appDirectory}/tsconfig.json`,
  `${appDirectory}/postcss.config.cjs`,
  `${appDirectory}/postcss.config.mjs`,
  `${appDirectory}/tailwind.config.js`,
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: '1' },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });
}

function resolveBaseCommit() {
  const candidates = [process.env.VERCEL_GIT_PREVIOUS_SHA?.trim(), 'HEAD^'].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = run('git', ['rev-parse', '--verify', `${candidate}^{commit}`], { capture: true });
    if (resolved.status === 0 && resolved.stdout.trim()) {
      if (candidate !== process.env.VERCEL_GIT_PREVIOUS_SHA?.trim()) {
        console.log(`SHA anterior não disponível; usando ${resolved.stdout.trim()} como fallback.`);
      }
      return resolved.stdout.trim();
    }
  }

  console.error('Nenhum commit base está disponível para comparação; mantendo o build por segurança.');
  process.exit(1);
}

const base = resolveBaseCommit();
const globalDiff = run('git', ['diff', '--name-only', base, 'HEAD', '--'], { capture: true });

if (globalDiff.error || globalDiff.status !== 0) {
  const reason = globalDiff.stderr?.trim().split('\n')[0];
  console.error(`Não foi possível comparar ${base} com HEAD${reason ? ` (${reason})` : ''}; mantendo o build por segurança.`);
  process.exit(1);
}

const changedFiles = globalDiff.stdout.split('\n').filter(Boolean);
const changedOperationalFile = alwaysBuildPaths.some((filePath) =>
  filePath.endsWith('/')
    ? changedFiles.some((changedFile) => changedFile.startsWith(filePath))
    : changedFiles.includes(filePath),
);

if (changedOperationalFile) {
  console.log(`Alteração operacional detectada; mantendo o build de ${projectName}.`);
  process.exit(1);
}

const affected = run('pnpm', [
  'exec',
  'turbo',
  'query',
  'affected',
  '--base',
  base,
  '--head',
  'HEAD',
  '--packages',
  projectName,
  '--exit-code',
]);

if (affected.status === 0) {
  console.log(`Nenhuma alteração afeta ${projectName}; ignorando o build.`);
  process.exit(0);
}

// O Turbo retorna 1 quando há alteração afetada e 2 em caso de erro.
// Ambos devem continuar o build: erro de análise nunca pode bloquear uma
// publicação potencialmente necessária.
console.log(`Alteração afeta ${projectName} ou a análise falhou; mantendo o build.`);
process.exit(1);
