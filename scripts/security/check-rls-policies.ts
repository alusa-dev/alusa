import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
const migrationsDir = join(root, 'prisma/migrations');
const migrationSql = readdirSync(migrationsDir)
  .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
  .map((entry) => {
    const file = join(migrationsDir, entry, 'migration.sql');
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const modelRegex = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g;
const tenantModels: string[] = [];
for (const match of schema.matchAll(modelRegex)) {
  const [, modelName, body] = match;
  if (modelName && /contaId\s+String/.test(body)) {
    tenantModels.push(modelName);
  }
}

const missing = tenantModels.filter((model) => {
  const quoted = `'${model}'`;
  const enabled = new RegExp(`ALTER TABLE\\s+(public\\.)?"?${model}"?\\s+ENABLE ROW LEVEL SECURITY`, 'i');
  return !migrationSql.includes(quoted) && !enabled.test(migrationSql);
});

if (missing.length > 0) {
  console.error('[security] Tabelas tenant-scoped sem RLS detectavel em migrations:');
  for (const model of missing) console.error(`- ${model}`);
  process.exit(1);
}

console.log(`[security] OK: ${tenantModels.length} modelos tenant-scoped com RLS detectavel.`);
