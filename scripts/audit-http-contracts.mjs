import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const routeRoots = [path.join(root, 'apps/web/app'), path.join(root, 'apps/admin/app')];
async function routeFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await routeFiles(entryPath)));
    else if (entry.isFile() && entry.name === 'route.ts') files.push(entryPath);
  }
  return files;
}

function declaredMethods(source) {
  return [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
    .map((match) => ({ method: match[1], start: match.index ?? 0 }))
    .map((entry, index, entries) => ({
      ...entry,
      source: source.slice(entry.start, entries[index + 1]?.start ?? source.length),
    }));
}

function routeName(file) {
  const appRoot = file.includes(`${path.sep}apps${path.sep}web${path.sep}app${path.sep}`)
    ? path.join(root, 'apps/web/app')
    : path.join(root, 'apps/admin/app');
  return `/${path.relative(appRoot, file).replaceAll(path.sep, '/').replace(/\/route\.ts$/, '')}`;
}

const routes = (await Promise.all(routeRoots.map(routeFiles))).flat().sort();
const findings = [];
const reviews = [];

for (const file of routes) {
  const source = await fs.readFile(file, 'utf8');
  const route = routeName(file);
  const declared = declaredMethods(source);

  for (const handler of declared) {
    const statuses = [...handler.source.matchAll(/status\s*:\s*(\d{3})/g)].map((match) => Number(match[1]));
    if (handler.source.includes('apiJsonCreated(')) statuses.push(201);
    if (handler.source.includes('apiJsonAccepted(')) statuses.push(202);
    if (handler.source.includes('apiJsonNoContent(')) statuses.push(204);
    if (['GET', 'HEAD', 'DELETE'].includes(handler.method) && statuses.includes(201)) {
      findings.push(`${route} ${handler.method}: não pode declarar 201 Created`);
    }

    if (handler.method === 'GET' && /(?:req|request)\.json\s*\(/.test(handler.source)) {
      reviews.push(`${route} GET: lê body JSON; confirmar que não há efeito colateral oculto`);
    }

    const isLikelyResourceCreate = handler.method === 'POST'
      && !route.includes('/actions/')
      && !route.includes('/jobs/')
      && !route.includes('/webhooks/')
      && !route.includes('/auth/')
      && !route.includes('/admin/')
      && !route.includes('/mobile/');
    if (isLikelyResourceCreate && !statuses.some((status) => [201, 202, 204].includes(status))) {
      reviews.push(`${route} POST: sem status explícito 201/202/204; 200 pode ser correto para comandos síncronos`);
    }
  }
}

console.log(`HTTP contract audit: routes=${routes.length}, violations=${findings.length}, reviews=${reviews.length}`);
if (reviews.length > 0 && process.argv.includes('--verbose')) {
  console.log('Revisões não bloqueantes:');
  for (const review of reviews.slice(0, 40)) console.log(`- ${review}`);
  if (reviews.length > 40) console.log(`- ... e mais ${reviews.length - 40}`);
}

if (findings.length > 0) {
  console.error('Violações bloqueantes:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
}
