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
const base = process.env.VERCEL_GIT_PREVIOUS_SHA?.trim() || 'HEAD^';
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
  `${appDirectory}/postcss.config.*`,
  `${appDirectory}/tailwind.config.*`,
];

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  });
}

const globalDiff = run('git', ['diff', '--quiet', base, 'HEAD', '--', ...alwaysBuildPaths]);

if (globalDiff.error || (globalDiff.status !== 0 && globalDiff.status !== 1)) {
  console.error(`Não foi possível comparar ${base} com HEAD; mantendo o build por segurança.`);
  process.exit(1);
}

if (globalDiff.status === 1) {
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
