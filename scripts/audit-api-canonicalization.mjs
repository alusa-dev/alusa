import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routesFile = path.join(root, 'docs/architecture/api-canonical-routes.json');
const consumersFile = path.join(root, 'docs/architecture/api-canonical-consumers.json');
const document = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
const failures = [];
const seenAliases = new Set();
const consumerRoots = [
  { surface: 'web', directory: 'apps/web' },
  { surface: 'admin', directory: 'apps/admin' },
  { surface: 'mobile', directory: 'apps/mobile' },
  { surface: 'packages', directory: 'packages' },
  { surface: 'scripts', directory: 'scripts' },
];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const excludedDirectories = new Set([
  'node_modules',
  'dist',
  '.next',
  '.next-playwright',
  '.vercel',
  'coverage',
  'tmp',
  '.turbo',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(directory) {
  const absoluteDirectory = path.join(root, directory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...walk(path.relative(root, absolutePath)));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) files.push(absolutePath);
  }
  return files;
}

function pathExistsInWebApi(apiPath) {
  const directory = path.join(root, 'apps/web/app', apiPath.replace(/^\//, ''));
  return fs.existsSync(directory);
}

function countConsumers(endpoint, files) {
  const pattern = new RegExp(`${escapeRegExp(endpoint)}(?![A-Za-z0-9_-])`, 'g');
  const bySurface = new Map();
  const matchingFiles = [];
  for (const { surface, file, source } of files) {
    const count = source.match(pattern)?.length ?? 0;
    if (count === 0) continue;
    matchingFiles.push({ file: path.relative(root, file), occurrences: count });
    bySurface.set(surface, (bySurface.get(surface) ?? 0) + count);
  }
  return {
    total: matchingFiles.reduce((total, item) => total + item.occurrences, 0),
    bySurface: Object.fromEntries([...bySurface.entries()].sort(([a], [b]) => a.localeCompare(b))),
    files: matchingFiles.sort((a, b) => a.file.localeCompare(b.file)),
  };
}

const sourceFiles = consumerRoots.flatMap(({ surface, directory }) =>
  walk(directory).map((file) => ({ surface, file, source: fs.readFileSync(file, 'utf8') })),
);

for (const family of document.families) {
  if (!family.context || !family.canonical || !family.owner) failures.push('família sem context/canonical/owner');
  if (family.aliases.includes(family.canonical)) {
    failures.push(`${family.context}: canonical também está listado como alias`);
  }
  for (const alias of family.aliases) {
    if (seenAliases.has(alias)) failures.push(`alias duplicado: ${alias}`);
    seenAliases.add(alias);
    const lifecycle = family.aliasLifecycle?.[alias];
    if (!lifecycle) failures.push(`${family.context}: alias sem lifecycle (${alias})`);
    if (lifecycle === 'retired' && countConsumers(alias, sourceFiles).total > 0) {
      failures.push(`${family.context}: alias aposentado ainda possui consumidor (${alias})`);
    }
    if (lifecycle === 'active-migration' && !pathExistsInWebApi(alias)) {
      failures.push(`${family.context}: alias em migração sem implementação no filesystem (${alias})`);
    }
  }

  const canonicalDirectory = path.join(root, 'apps/web/app', family.canonical.replace(/^\//, ''));
  if (!fs.existsSync(canonicalDirectory)) {
    failures.push(`${family.context}: canonical ausente no filesystem (${family.canonical})`);
  }
}

const consumerInventory = {
  generatedAt: 'deterministic',
  policy: document.policy,
  families: document.families.map((family) => ({
    context: family.context,
    canonical: {
      path: family.canonical,
      owner: family.owner,
      consumers: countConsumers(family.canonical, sourceFiles),
    },
    aliases: family.aliases.map((alias) => ({
      path: alias,
      lifecycle: family.aliasLifecycle?.[alias] ?? 'unclassified',
      implemented: pathExistsInWebApi(alias),
      consumers: countConsumers(alias, sourceFiles),
    })),
  })),
};

const serializedConsumers = `${JSON.stringify(consumerInventory, null, 2)}\n`;
if (process.argv.includes('--write')) {
  fs.writeFileSync(consumersFile, serializedConsumers, 'utf8');
  console.log(`[api-canonicalization] escrito ${path.relative(root, consumersFile)}`);
} else if (!fs.existsSync(consumersFile)) {
  failures.push(`inventário de consumidores ausente (${path.relative(root, consumersFile)})`);
} else if (fs.readFileSync(consumersFile, 'utf8') !== serializedConsumers) {
  failures.push(
    'inventário de consumidores mudou; novos usos de aliases são bloqueados. ' +
      'Migre para o endpoint canônico ou atualize o inventário somente após revisão explícita.',
  );
}

if (failures.length > 0) {
  console.error('[api-canonicalization] FALHOU');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`[api-canonicalization] OK: ${document.families.length} famílias, ${seenAliases.size} aliases monitorados.`);
  for (const family of consumerInventory.families) {
    const activeAliases = family.aliases.filter((alias) => alias.lifecycle === 'active-migration');
    if (activeAliases.length > 0) {
      const count = activeAliases.reduce((total, alias) => total + alias.consumers.total, 0);
      console.log(`[api-canonicalization] ${family.context}: ${count} usos em aliases ativos.`);
    }
  }
}
