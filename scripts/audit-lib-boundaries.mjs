import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';

const workspaceRoot = new URL('..', import.meta.url).pathname;
const runtimeRoots = [
  'apps/web/app',
  'apps/web/src',
  'apps/web/features',
  'apps/web/lib',
  'apps/web/scripts',
  'apps/admin/app',
  'apps/admin/src',
  'apps/admin/features',
  'apps/admin/lib',
  'apps/admin/scripts',
  'apps/mobile/src',
  ...['packages'].flatMap((relativePath) => {
    const packagesDirectory = path.join(workspaceRoot, relativePath);
    try {
      return fsSync.readdirSync(packagesDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(relativePath, entry.name, 'src'));
    } catch {
      return [];
    }
  }),
].map((relativePath) => path.join(workspaceRoot, relativePath));
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const genericLibImport = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@alusa\/lib['"]/g;

const ignoredDirectories = new Set(['node_modules', 'dist', '.next', '.vercel', 'coverage', '.turbo']);

async function walk(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return ignoredDirectories.has(entry.name) ? [] : walk(filePath);
      }
      const isTestFile = /(?:\.test|\.spec)\.[^.]+$/.test(entry.name);
      return sourceExtensions.has(path.extname(entry.name)) && !isTestFile ? [filePath] : [];
    }),
  );
  return files.flat();
}

const files = (await Promise.all(runtimeRoots.map(walk))).flat();
const violations = [];

for (const filePath of files) {
  const source = await fs.readFile(filePath, 'utf8');
  const matches = [...source.matchAll(genericLibImport)];
  for (const match of matches) {
    const line = source.slice(0, match.index).split('\n').length;
    violations.push(`${path.relative(workspaceRoot, filePath)}:${line}`);
  }
}

if (violations.length > 0) {
  console.error('[lib-boundaries] Imports do barrel genérico encontrados no runtime do workspace:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log('[lib-boundaries] OK: nenhum import de @alusa/lib no barrel genérico do runtime do workspace.');
}
