import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectName = process.argv[2];

if (!['@alusa/web', '@alusa/admin'].includes(projectName)) {
  console.error(`Projeto inválido para o Ignored Build Step: ${projectName ?? '(ausente)'}`);
  process.exit(1);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.VERCEL_GIT_PREVIOUS_SHA?.trim() || 'HEAD^';
const head = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'HEAD';

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
    stdio: 'inherit',
  },
);

if (result.error || result.status === 2 || result.status == null) {
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
