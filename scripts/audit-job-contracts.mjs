import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const root = process.cwd();
const failures = [];
const ownershipPath = path.join(root, 'docs/architecture/job-ownership.json');
const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));

function walk(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.name === 'route.ts') files.push(absolute);
  }
  return files;
}

const routeFiles = walk(path.join(root, 'apps/web/app/api/jobs'));
const routeByPath = new Map(
  routeFiles.map((file) => [
    `/api/jobs/${path.relative(path.join(root, 'apps/web/app/api/jobs'), path.dirname(file))}`
      .replace(/\\/g, '/')
      .replace(/\/\.$/, ''),
    file,
  ]),
);
const cronConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const crons = cronConfig.crons ?? [];
const entries = ownership.jobs ?? [];

if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
  failures.push('job-ownership.json contém ids duplicados.');
}

for (const entry of entries) {
  if (!entry.owner || !entry.criticality || !entry.retryStrategy || !entry.exclusiveGroup) {
    failures.push(`${entry.id} não possui ownership, criticidade, retry ou grupo de exclusão completos.`);
  }
  const file = routeByPath.get(entry.route);
  if (!file) {
    failures.push(`${entry.id} aponta para rota inexistente: ${entry.route}.`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes("dynamic = 'force-dynamic'")) failures.push(`${entry.route} não declara force-dynamic.`);
  if (!/maxDuration\s*=/.test(source)) failures.push(`${entry.route} não declara maxDuration.`);
  if (!source.includes('resolveTenantScope')) failures.push(`${entry.route} não resolve escopo de tenant.`);
}

const cronKeys = crons.map((cron) => {
  const url = new URL(cron.path, 'https://alusa.invalid');
  return `${url.pathname}|${cron.schedule}`;
});
const ownershipKeys = entries.map((entry) => `${entry.route}|${entry.schedule}`);
for (const key of cronKeys) {
  if (!ownershipKeys.includes(key)) failures.push(`cron sem ownership: ${key}`);
}
for (const key of ownershipKeys) {
  if (!cronKeys.includes(key)) failures.push(`ownership sem cron ativo: ${key}`);
}

const appConfigPath = path.join(root, 'apps/web/vercel.json');
const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
if (JSON.stringify(crons) !== JSON.stringify(appConfig.crons ?? [])) {
  failures.push('vercel.json e apps/web/vercel.json estão divergentes.');
}

console.log(`[job-contracts] routes=${routeFiles.length} scheduled=${crons.length} catalogued=${entries.length}`);
if (failures.length > 0) {
  console.error('[job-contracts] FALHOU');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[job-contracts] OK: cron, ownership, tenant scope, runtime e exclusão mútua alinhados.');
}
