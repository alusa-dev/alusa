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
    if (!/\.(ts|tsx|prisma|sql|json)$/.test(entry)) continue;
    const text = readFileSync(path, 'utf8');
    if (/asaasCreditCardToken/.test(text)) matches.push(rel);
  }
}

for (const scope of ['apps', 'packages']) {
  walk(join(root, scope));
}

const prismaSchema = join(root, 'prisma/schema.prisma');
if (/asaasCreditCardToken/.test(readFileSync(prismaSchema, 'utf8'))) {
  matches.push('prisma/schema.prisma');
}

if (matches.length > 0) {
  console.error('[security] Campo local asaasCreditCardToken ainda encontrado:');
  for (const file of matches) console.error(`- ${file}`);
  process.exit(1);
}

console.log('[security] OK: nenhum campo local asaasCreditCardToken encontrado.');
