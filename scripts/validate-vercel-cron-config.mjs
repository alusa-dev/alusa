import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rootConfigPath = path.join(root, 'vercel.json');
const appConfigPath = path.join(root, 'apps/web/vercel.json');
const ownershipPath = path.join(root, 'docs/architecture/job-ownership.json');
const reviewPath = path.join(root, 'docs/architecture/job-schedule-review.md');

function readCrons(filePath) {
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return (config.crons ?? [])
    .map((cron) => ({ path: cron.path, schedule: cron.schedule }))
    .sort((a, b) => `${a.schedule}:${a.path}`.localeCompare(`${b.schedule}:${b.path}`));
}

const rootCrons = readCrons(rootConfigPath);
const appCrons = readCrons(appConfigPath);
const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
const ownershipPairs = ownership.jobs
  .map((job) => ({ path: job.route, schedule: job.schedule }))
  .sort((a, b) => `${a.schedule}:${a.path}`.localeCompare(`${b.schedule}:${b.path}`));
const manifestPairs = rootCrons
  .map((cron) => ({ path: new URL(cron.path, 'https://vercel.invalid').pathname, schedule: cron.schedule }))
  .sort((a, b) => `${a.schedule}:${a.path}`.localeCompare(`${b.schedule}:${b.path}`));
const uniqueRoutes = new Set(rootCrons.map((cron) => new URL(cron.path, 'https://vercel.invalid').pathname)).size;
const review = fs.readFileSync(reviewPath, 'utf8');
const countMarker = review.match(/<!-- cron-counts: schedules=(\d+) unique-routes=(\d+) -->/);

if (JSON.stringify(rootCrons) !== JSON.stringify(appCrons)) {
  console.error('[cron-config] vercel.json e apps/web/vercel.json possuem agendas diferentes.');
  console.error(`[cron-config] root=${rootCrons.length} crons, apps/web=${appCrons.length} crons.`);
  process.exit(1);
}

if (JSON.stringify(manifestPairs) !== JSON.stringify(ownershipPairs)) {
  console.error('[cron-config] Pares (path, schedule) diferem entre manifests e job-ownership.json.');
  process.exit(1);
}

if (!countMarker || Number(countMarker[1]) !== rootCrons.length || Number(countMarker[2]) !== uniqueRoutes) {
  console.error(`[cron-config] Contagens divergentes: schedules=${rootCrons.length}, unique-routes=${uniqueRoutes}, marker=${countMarker?.[1] ?? 'missing'}/${countMarker?.[2] ?? 'missing'}.`);
  process.exit(1);
}

console.log(`[cron-config] OK: ${rootCrons.length} schedule(s), ${uniqueRoutes} rota(s) únicas; manifests e catálogo alinhados.`);
