import { promises as fs } from 'node:fs';
import path from 'node:path';

const workspaceRoot = new globalThis.URL('..', import.meta.url).pathname;
const apiRoots = [
  path.join(workspaceRoot, 'apps', 'web', 'app', 'api'),
  path.join(workspaceRoot, 'apps', 'admin', 'app', 'api'),
];
const boundaryInventoryPath = path.join(
  workspaceRoot,
  'docs',
  'architecture',
  'api-route-boundary-inventory.json',
);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      return [fullPath];
    }),
  );

  return files.flat();
}

function relative(filePath) {
  return path.relative(workspaceRoot, filePath).replaceAll(path.sep, '/');
}

function countMatches(files, predicate) {
  return files.filter(predicate);
}

const routeFiles = (await Promise.all(apiRoots.map((apiRoot) => walk(apiRoot))))
  .flat()
  .filter((file) => file.endsWith('route.ts'));
const fileTexts = await Promise.all(
  routeFiles.map(async (filePath) => ({
    filePath,
    relativePath: relative(filePath),
    source: await fs.readFile(filePath, 'utf8'),
  })),
);

const usesDtoSchema = countMatches(fileTexts, ({ source }) => /\b[A-Za-z]+DTOSchema\b/.test(source));
const usesFeatureOrLibDtos = countMatches(
  fileTexts,
  ({ source }) => /from ['"]@\/(?:lib\/dtos|features\/.+\/dtos)['"]/.test(source),
);
const usesDeepPackageDtos = countMatches(
  fileTexts,
  ({ source }) => /from ['"]@alusa\/(?:finance|domain)\/dtos\//.test(source),
);
const usesPrisma = countMatches(fileTexts, ({ source }) => /@prisma\/client|prisma\./.test(source));
const usesLocalSchemas = countMatches(
  fileTexts,
  ({ source }) => /from ['"]@\/(?:lib\/validations|features\/.+\/schemas)['"]/.test(source),
);

const routesWithValidatedInput = new Set(
  fileTexts
    .filter(({ source }) => /\.(?:safeParse|parse)\(/.test(source))
    .map(({ filePath }) => filePath),
);
const prismaWithoutDto = usesPrisma.filter(
  ({ filePath }) => !routesWithValidatedInput.has(filePath),
);

const boundaryInventoryDocument = JSON.parse(await fs.readFile(boundaryInventoryPath, 'utf8'));
const boundaryInventory = Array.isArray(boundaryInventoryDocument)
  ? boundaryInventoryDocument
  : boundaryInventoryDocument.routes;
if (!Array.isArray(boundaryInventory)) {
  throw new Error('Inventário de boundaries inválido: esperado um array ou um documento com routes[].');
}
const inventoryKey = (entry) => entry.file ?? entry.route;
const inventoryByRoute = new Map(boundaryInventory.map((entry) => [inventoryKey(entry), entry]));
const prismaWithoutDtoPaths = new Set(prismaWithoutDto.map(({ relativePath }) => relativePath));
const inventoryPaths = new Set(boundaryInventory.map(inventoryKey));
const unclassified = [...prismaWithoutDtoPaths].filter((route) => !inventoryPaths.has(route));

if (unclassified.length > 0) {
  console.error('');
  console.error('[dto-audit] Inventário de boundaries fora de sincronia:');
  if (unclassified.length > 0) {
    console.error('Rotas Prisma sem DTO não classificadas:');
    unclassified.forEach((route) => console.error(`- ${route}`));
  }
  process.exitCode = 1;
}

const classificationSummary = boundaryInventory.reduce((summary, entry) => {
  const key = `${entry.category}/${entry.protection}`;
  summary.set(key, (summary.get(key) ?? 0) + 1);
  return summary;
}, new Map());

console.log('# DTO audit');
console.log('');
console.log(`- Total de rotas API: ${routeFiles.length}`);
console.log(`- Rotas com *DTOSchema*: ${usesDtoSchema.length}`);
console.log(`- Rotas com DTO local de feature/lib: ${usesFeatureOrLibDtos.length}`);
console.log(`- Rotas com import profundo de DTO de pacote: ${usesDeepPackageDtos.length}`);
console.log(`- Rotas com schema local (não DTO formal): ${usesLocalSchemas.length}`);
console.log(`- Rotas com uso direto de Prisma: ${usesPrisma.length}`);
console.log(`- Rotas com Prisma sem DTO/schema de entrada: ${prismaWithoutDto.length}`);
console.log(`- Rotas classificadas no inventário: ${inventoryByRoute.size}`);
console.log('');

console.log('## Classificação do inventário de rotas');
for (const [classification, count] of [...classificationSummary.entries()].sort()) {
  console.log(`- ${classification}: ${count}`);
}
console.log('');

if (usesDeepPackageDtos.length > 0) {
  console.log('## Imports profundos de DTO');
  usesDeepPackageDtos.forEach(({ relativePath }) => console.log(`- ${relativePath}`));
  console.log('');
}

if (prismaWithoutDto.length > 0) {
  console.log('## Rotas com Prisma sem DTO formal');
  prismaWithoutDto.forEach(({ relativePath }) => console.log(`- ${relativePath}`));
}
