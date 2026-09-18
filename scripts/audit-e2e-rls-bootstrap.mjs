import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowFiles = [
  { file: '.github/workflows/ci.yml', job: 'e2e-critical' },
  { file: '.github/workflows/e2e-full.yml', job: 'e2e' },
];
const failures = [];

function extractJob(source, jobName) {
  const marker = `\n  ${jobName}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) return null;

  const bodyStart = start + marker.length;
  const nextJob = source.slice(bodyStart).search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJob < 0 ? source.slice(bodyStart) : source.slice(bodyStart, bodyStart + nextJob);
}

for (const { file: relativeFile, job } of workflowFiles) {
  const file = path.join(root, relativeFile);
  if (!fs.existsSync(file)) {
    failures.push(`${relativeFile}: workflow ausente`);
    continue;
  }

  const source = fs.readFileSync(file, 'utf8');
  const jobSource = extractJob(source, job);

  if (!jobSource) {
    failures.push(`${relativeFile}: job ${job} ausente`);
    continue;
  }

  const migrationIndex = jobSource.indexOf('prisma migrate deploy');
  const prepareIndex = jobSource.indexOf('pnpm e2e:prepare-rls');

  if (migrationIndex < 0) failures.push(`${relativeFile}/${job}: prisma migrate deploy ausente`);
  if (prepareIndex < 0) failures.push(`${relativeFile}/${job}: pnpm e2e:prepare-rls ausente`);
  if (migrationIndex >= 0 && prepareIndex >= 0 && prepareIndex < migrationIndex) {
    failures.push(`${relativeFile}/${job}: role RLS é preparada antes das migrations`);
  }

  const databaseUrlMatches = [...jobSource.matchAll(/DATABASE_URL:\s*[^\n]*alusa_test/g)];
  if (databaseUrlMatches.length === 0) {
    failures.push(`${relativeFile}/${job}: DATABASE_URL não aponta explicitamente para alusa_test`);
  }
}

if (failures.length > 0) {
  console.error('[e2e-rls-bootstrap] FALHOU');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('[e2e-rls-bootstrap] OK: migrations precedem a preparação da role em todos os workflows.');
}
