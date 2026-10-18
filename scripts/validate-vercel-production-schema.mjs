import { spawnSync } from 'node:child_process';
import pg from 'pg';

const EXPECTED_NEON_PROJECT_ID = 'polished-glitter-40606095';
const EXPECTED_NEON_BRANCH_ID = 'br-tiny-silence-acg489yn';

function fail(message) {
  console.error(`[production-schema] ${message}`);
  process.exit(1);
}

if (process.env.VERCEL_ENV !== 'production') {
  console.log('[production-schema] skipped outside Vercel production');
  process.exit(0);
}

const directUrl = process.env.DIRECT_URL;
if (!directUrl) fail('DIRECT_URL is required for the production migration check.');

let parsedUrl;
try {
  parsedUrl = new URL(directUrl);
} catch {
  fail('DIRECT_URL must be a valid PostgreSQL URL.');
}

const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
if (databaseName !== 'alusa_prod' || !parsedUrl.hostname.endsWith('.neon.tech')) {
  fail('DIRECT_URL must target the Neon alusa_prod database.');
}

const client = new pg.Client({ connectionString: directUrl });
let target;
try {
  await client.connect();
  const result = await client.query(
    `SELECT current_database() AS database_name,
            current_setting('neon.branch_id', true) AS branch_id,
            current_setting('neon.project_id', true) AS project_id`,
  );
  target = result.rows[0];
} catch {
  fail('Could not verify the Neon production database identity.');
} finally {
  await client.end().catch(() => undefined);
}

if (
  target?.database_name !== 'alusa_prod' ||
  target.branch_id !== EXPECTED_NEON_BRANCH_ID ||
  target.project_id !== EXPECTED_NEON_PROJECT_ID
) {
  fail('DIRECT_URL does not resolve to the configured Alusa production Neon project, branch, and database.');
}

console.log('[production-schema] checking that all versioned migrations are applied');
const result = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'migrate', 'status', '--schema=prisma/schema.prisma'],
  { stdio: 'inherit' },
);

if (result.error) fail(`Could not run Prisma migration status: ${result.error.message}`);
if (result.status !== 0) fail('Production schema is not compatible with this build; resolve migration status before deployment.');
