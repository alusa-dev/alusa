import { promises as fs } from 'node:fs';
import path from 'node:path';

const workspaceRoot = new globalThis.URL('..', import.meta.url).pathname;
const apiRoot = path.join(workspaceRoot, 'apps', 'web', 'app', 'api');

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

const routeFiles = (await walk(apiRoot)).filter((file) => file.endsWith('route.ts'));
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

const prismaWithoutDto = usesPrisma.filter(
  ({ filePath }) => !usesDtoSchema.some((item) => item.filePath === filePath),
);

console.log('# DTO audit');
console.log('');
console.log(`- Total de rotas API: ${routeFiles.length}`);
console.log(`- Rotas com *DTOSchema*: ${usesDtoSchema.length}`);
console.log(`- Rotas com DTO local de feature/lib: ${usesFeatureOrLibDtos.length}`);
console.log(`- Rotas com import profundo de DTO de pacote: ${usesDeepPackageDtos.length}`);
console.log(`- Rotas com schema local (não DTO formal): ${usesLocalSchemas.length}`);
console.log(`- Rotas com uso direto de Prisma: ${usesPrisma.length}`);
console.log(`- Rotas com Prisma sem *DTOSchema*: ${prismaWithoutDto.length}`);
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
