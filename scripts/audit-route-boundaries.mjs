import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/architecture/api-route-boundary-baseline.json'), 'utf8'),
);

function apiSourceFiles(directory) {
  const absoluteDirectory = path.join(root, directory);
  const result = [];
  if (!fs.existsSync(absoluteDirectory)) return result;
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) result.push(...apiSourceFiles(path.relative(root, absolutePath)));
    else if (
      /\.(ts|tsx)$/.test(entry.name)
      && !/(?:\.test|\.spec)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      result.push(absolutePath);
    }
  }
  return result;
}

function hasDirectPrismaImport(source) {
  // `prisma-tenant` is an approved tenant-aware adapter, not a raw ORM client.
  // Type-only imports from @prisma/client do not create a persistence boundary.
  const runtimeSource = source.replace(
    /import\s+type[\s\S]*?from\s*["']@prisma\/client["'];?/g,
    '',
  );
  return [...runtimeSource.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].some((match) => {
    const specifier = match[1];
    return specifier === '@alusa/database'
      || specifier === '@alusa/lib/prisma'
      || specifier === '@/src/prisma'
      || specifier === '@/lib/prisma'
      || specifier === '@/prisma/client';
  });
}

const routeFiles = [
  ...apiSourceFiles('apps/web/app/api'),
  ...apiSourceFiles('apps/admin/app/api'),
].filter((file) => path.basename(file) === 'route.ts');
const files = [
  ...apiSourceFiles('apps/web/app/api'),
  ...apiSourceFiles('apps/admin/app/api'),
];
const directPrisma = files.filter((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return hasDirectPrismaImport(source);
});
const directPrismaPaths = directPrisma.map((file) => path.relative(root, file)).sort();
const baselineDirectPrismaPaths = new Set(baseline.directPrismaRoutePaths ?? []);
const newDirectPrismaPaths = directPrismaPaths.filter((file) => !baselineDirectPrismaPaths.has(file));
const directAsaas = files.filter((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return /(?:from|require\()\s*["'][^"']*@alusa\/(?:asaas|asaas-gateway)[^"']*["']/.test(source);
});
const routeErrorMessageLeaks = files.filter((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  return lines.some((line, index) => {
    if (!/\breturn\b/.test(line)) return false;
    const returnedExpression = lines.slice(index, index + 16).join(' ').split(';', 1)[0];
    // Domain messages may be intentionally returned for 4xx business errors.
    // A generic 5xx must never expose the caught exception, regardless of the
    // local variable name or helper used by the route.
    const isServerErrorResponse = /(?:\b500\b|status\s*:\s*5\d\d)/.test(returnedExpression);
    if (!isServerErrorResponse) return false;
    return /(?:error|err|e)\s+instanceof\s+Error\s*\?\s*(?:error|err|e)\.message/.test(returnedExpression)
      || /\((?:error|err|e)\s+as\s+Error\)\.message/.test(returnedExpression)
      || /\breturn\b[^;]*String\((?:error|err|e)\)/.test(returnedExpression);
  });
});

const relative = (file) => path.relative(root, file);
console.log(`[route-boundaries] routes=${routeFiles.length}`);
console.log(`[route-boundaries] api-modules=${files.length}`);
console.log(`[route-boundaries] direct-prisma=${directPrisma.length} baseline=${baseline.directPrismaRoutes}`);
console.log(`[route-boundaries] new-direct-prisma-paths=${newDirectPrismaPaths.length}`);
console.log(`[route-boundaries] direct-asaas=${directAsaas.length}`);
console.log(`[route-boundaries] probable-error-message-returns=${routeErrorMessageLeaks.length}`);

if (directAsaas.length > 0) {
  console.error('[route-boundaries] FALHOU: route handlers não podem importar o cliente Asaas diretamente.');
  for (const file of directAsaas) console.error(`- ${relative(file)}`);
  process.exitCode = 1;
}

if (directPrisma.length > baseline.directPrismaRoutes) {
  console.error(
    `[route-boundaries] FALHOU: o número de routes com Prisma direto aumentou (${directPrisma.length} > ${baseline.directPrismaRoutes}).`,
  );
  process.exitCode = 1;
} else {
  console.log('[route-boundaries] OK: o baseline de Prisma direto não aumentou; novas extrações devem reduzi-lo.');
}

if (newDirectPrismaPaths.length > 0) {
  console.error('[route-boundaries] FALHOU: novas rotas com Prisma direto precisam de migração ou exceção explícita.');
  for (const file of newDirectPrismaPaths) console.error(`- ${file}`);
  process.exitCode = 1;
}

if (routeErrorMessageLeaks.length > 0) {
  console.error('[route-boundaries] FALHOU: handlers não podem retornar Error.message ou String(error) ao cliente.');
  for (const file of routeErrorMessageLeaks.slice(0, 20)) console.error(`- ${relative(file)}`);
  if (routeErrorMessageLeaks.length > 20) console.error(`- ... e mais ${routeErrorMessageLeaks.length - 20}`);
  process.exitCode = 1;
}
