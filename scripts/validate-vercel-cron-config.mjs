import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rootConfigPath = path.join(root, 'vercel.json');
const appConfigPath = path.join(root, 'apps/web/vercel.json');

function readCrons(filePath) {
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return (config.crons ?? [])
    .map((cron) => ({ path: cron.path, schedule: cron.schedule }))
    .sort((a, b) => `${a.schedule}:${a.path}`.localeCompare(`${b.schedule}:${b.path}`));
}

const rootCrons = readCrons(rootConfigPath);
const appCrons = readCrons(appConfigPath);

if (JSON.stringify(rootCrons) !== JSON.stringify(appCrons)) {
  console.error('[cron-config] vercel.json e apps/web/vercel.json possuem agendas diferentes.');
  console.error(`[cron-config] root=${rootCrons.length} crons, apps/web=${appCrons.length} crons.`);
  process.exit(1);
}

console.log(`[cron-config] OK: ${rootCrons.length} cron(s) alinhado(s) entre os dois manifests.`);
