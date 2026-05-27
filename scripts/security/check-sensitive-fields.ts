import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', '.next', '.turbo', 'dist', 'node_modules']);
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
    if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
    const text = readFileSync(path, 'utf8');
    if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|TOKEN|API_KEY|PASSWORD)(?![A-Z0-9_])/.test(text)) {
      matches.push(rel);
    }
  }
}

walk(join(root, 'apps'));
walk(join(root, 'packages'));

if (matches.length > 0) {
  console.error('[security] Possivel segredo exposto ao frontend:');
  for (const file of matches) console.error(`- ${file}`);
  process.exit(1);
}

console.log('[security] OK: nenhum NEXT_PUBLIC_* sensivel encontrado.');
