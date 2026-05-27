import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', '.next', '.turbo', 'dist', 'node_modules']);
const ignoredFiles = new Set(['pnpm-lock.yaml']);
const matches: string[] = [];

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    const rel = relative(root, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (ignoredFiles.has(entry) || !/\.(ts|tsx|js|jsx|json|md|mjs|cjs|env|example)$/.test(entry)) continue;
    const text = readFileSync(path, 'utf8');
    if (/twilio|TWILIO_/i.test(text)) matches.push(rel);
  }
}

for (const scope of ['apps', 'packages', 'prisma']) {
  walk(join(root, scope));
}

if (matches.length > 0) {
  console.error('[security] Twilio ainda aparece em codigo ativo:');
  for (const file of matches) console.error(`- ${file}`);
  process.exit(1);
}

console.log('[security] OK: nenhum codigo ativo Twilio encontrado.');
