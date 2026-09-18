import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDirectory = path.join(root, 'prisma/migrations');
const baselinePath = path.join(root, 'docs/quality/migration-safety-baseline.json');
const failures = [];

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*--[^\n]*/g, '$1');
}

function migrationFiles() {
  if (!fs.existsSync(migrationsDirectory)) return [];
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsDirectory, entry.name, 'migration.sql'))
    .filter((file) => fs.existsSync(file))
    .sort();
}

function findPhysicalDatabaseReferences(sql) {
  const executableSql = stripSqlComments(sql);
  const pattern = /\b(?:GRANT\b[\s\S]*?\bON\s+DATABASE\s+([a-z_][a-z0-9_$]*)|ALTER\s+DATABASE\s+([a-z_][a-z0-9_$]*))/gi;
  return [...executableSql.matchAll(pattern)].map((match) => ({
    database: match[1] ?? match[2],
    statement: match[0].replace(/\s+/g, ' ').trim(),
  }));
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return new Map();
  const entries = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  return new Map(entries.map((entry) => [entry.file, entry]));
}

const baseline = loadBaseline();
const findings = [];
for (const file of migrationFiles()) {
  const relativeFile = path.relative(root, file);
  const sql = fs.readFileSync(file, 'utf8');
  const references = findPhysicalDatabaseReferences(sql).filter(({ database }) =>
    ['neondb', 'alusa_test', 'postgres'].includes(database.toLowerCase()),
  );
  if (references.length === 0) continue;

  const sha256 = createHash('sha256').update(sql).digest('hex');
  const known = baseline.get(relativeFile);
  if (!known || known.sha256 !== sha256) {
    findings.push({ file: relativeFile, references, sha256 });
  }
}

if (findings.length > 0) {
  console.error('[migration-safety] FALHOU: migration executável acoplada a nome físico de banco.');
  for (const finding of findings) {
    console.error(`- ${finding.file}`);
    for (const reference of finding.references) console.error(`  ${reference.statement}`);
    console.error(`  sha256=${finding.sha256}`);
  }
  console.error('Use current_database(), uma migration agnóstica ou infraestrutura externa; não adicione exceções sem revisão explícita.');
  process.exitCode = 1;
}

console.log(`[migration-safety] migrations=${migrationFiles().length}`);
console.log(`[migration-safety] physical-database-findings=${findings.length}`);
