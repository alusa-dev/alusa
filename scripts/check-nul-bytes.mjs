import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ROOTS = ['apps/web', 'packages/finance'];
const roots = process.argv.slice(2);

const rootsToScan = roots.length ? roots : DEFAULT_ROOTS;

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
]);

function shouldScanFile(filePath) {
  return (
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.mts') ||
    filePath.endsWith('.cts')
  );
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      yield* walk(fullPath);
      continue;
    }

    if (entry.isFile() && shouldScanFile(fullPath)) {
      yield fullPath;
    }
  }
}

function containsNulByte(buffer) {
  return buffer.includes(0);
}

async function main() {
  const repoRoot = process.cwd();

  const offendingFiles = [];

  for (const root of rootsToScan) {
    const absoluteRoot = path.isAbsolute(root) ? root : path.join(repoRoot, root);

    for await (const filePath of walk(absoluteRoot)) {
      let buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        continue;
      }

      if (containsNulByte(buffer)) {
        offendingFiles.push(path.relative(repoRoot, filePath));
      }
    }
  }

  if (!offendingFiles.length) {
    process.stdout.write('OK: nenhum byte NUL encontrado.\n');
    return;
  }

  process.stderr.write('ERRO: arquivos com bytes NUL encontrados:\n');
  for (const f of offendingFiles) process.stderr.write(`- ${f}\n`);

  process.exitCode = 1;
}

await main();
