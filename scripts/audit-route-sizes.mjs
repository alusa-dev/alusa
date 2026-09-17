import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const maxLines = Number(process.env.ROUTE_MAX_LINES ?? 300);
const routeRoots = ['apps/web/app/api', 'apps/admin/app/api'];

function walk(directory) {
  const absoluteDirectory = path.join(root, directory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path.relative(root, absolutePath)));
    else if (
      /\.(ts|tsx)$/.test(entry.name)
      && !/(?:\.test|\.spec)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      files.push(absolutePath);
    }
  }
  return files;
}

const routes = routeRoots.flatMap(walk);
const oversized = routes
  .map((file) => ({ file, lines: fs.readFileSync(file, 'utf8').split('\n').length - 1 }))
  .filter((item) => item.lines > maxLines)
  .sort((a, b) => b.lines - a.lines);

console.log(`[route-sizes] api-modules=${routes.length} max-lines=${maxLines} oversized=${oversized.length}`);
for (const item of oversized) {
  console.error(`- ${path.relative(root, item.file)} (${item.lines} linhas)`);
}

if (oversized.length > 0) {
  console.error('[route-sizes] FALHOU: extraia regras de negócio para serviços/casos de uso antes de ampliar o handler.');
  process.exitCode = 1;
} else {
  console.log('[route-sizes] OK: todos os route handlers estão dentro do limite arquitetural.');
}
