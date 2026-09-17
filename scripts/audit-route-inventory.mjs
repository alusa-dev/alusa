import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputPath = path.join(root, 'docs/architecture/api-route-boundary-inventory.json');

const routeRoots = [
  { app: 'web', directory: 'apps/web/app/api' },
  { app: 'admin', directory: 'apps/admin/app/api' },
];

const protectionRules = [
  { prefix: '/api/auth/', protection: 'PUBLIC' },
  { prefix: '/api/mobile/auth/', protection: 'PUBLIC' },
  { prefix: '/api/mobile/', protection: 'MOBILE_ACCESS_TOKEN' },
  { prefix: '/api/admin/', protection: 'TENANT_ADMIN' },
  { prefix: '/api/financeiro/', protection: 'TENANT_FINANCE' },
  { prefix: '/api/finance/', protection: 'TENANT_FINANCE' },
  { prefix: '/api/events/', protection: 'AUTH_USER' },
  { prefix: '/api/cobrancas', protection: 'AUTH_USER', exact: true },
  { prefix: '/api/cobrancas/', protection: 'AUTH_USER' },
  { prefix: '/api/public/', protection: 'PUBLIC' },
  { prefix: '/api/users/register', protection: 'PUBLIC', exact: true },
  { prefix: '/api/users/first-register', protection: 'PUBLIC', exact: true },
  { prefix: '/api/users/accept', protection: 'PUBLIC', exact: true },
  { prefix: '/api/assets/asaas-seal', protection: 'PUBLIC', exact: true },
  { prefix: '/api/health', protection: 'PUBLIC', exact: true },
  { prefix: '/api/health/', protection: 'PUBLIC' },
  { prefix: '/api/privacy/cookie-consent', protection: 'PUBLIC', exact: true },
  { prefix: '/api/privacy/requests', protection: 'PUBLIC', exact: true },
  { prefix: '/api/privacy/export', protection: 'AUTH_USER' },
  { prefix: '/api/webhooks/', protection: 'WEBHOOK_TOKEN' },
  { prefix: '/api/jobs/', protection: 'CRON_SECRET' },
  { prefix: '/api/observability/web-vitals', protection: 'PUBLIC', exact: true },
  { prefix: '/api/internal/health', protection: 'CRON_SECRET', exact: true },
  { prefix: '/api/internal/rls-health', protection: 'CRON_SECRET', exact: true },
];

const domainCategories = new Map([
  ['auth', 'authentication'],
  ['account', 'identity'],
  ['assets', 'integrations'],
  ['admin', 'administration'],
  ['colaboradores', 'identity'],
  ['combos', 'catalog'],
  ['conta', 'tenant'],
  ['dashboard', 'reporting'],
  ['descontos', 'finance'],
  ['dev', 'development'],
  ['event-contracts', 'contracts'],
  ['files', 'files'],
  ['mobile', 'mobile'],
  ['media', 'files'],
  ['finance', 'finance'],
  ['financeiro', 'finance'],
  ['cobrancas', 'finance'],
  ['billing-agreements', 'finance'],
  ['platform-billing', 'platform-billing'],
  ['webhooks', 'integrations'],
  ['jobs', 'operations'],
  ['health', 'operations'],
  ['internal', 'operations'],
  ['observability', 'operations'],
  ['privacy', 'privacy'],
  ['public', 'public'],
  ['alunos', 'academic'],
  ['aulas', 'academic'],
  ['matriculas', 'academic'],
  ['rematriculas', 'academic'],
  ['responsaveis', 'academic'],
  ['contratos', 'contracts'],
  ['events', 'events'],
  ['modalidades', 'academic'],
  ['notifications', 'communications'],
  ['planos', 'catalog'],
  ['portal', 'portal'],
  ['professores', 'academic'],
  ['salas', 'academic'],
  ['search', 'search'],
  ['test', 'development'],
  ['turmas', 'academic'],
  ['upload', 'files'],
  ['vendas', 'sales'],
  ['estoque', 'sales'],
  ['users', 'identity'],
  ['kyc', 'compliance'],
  ['comunicacao', 'communications'],
  ['whatsapp', 'communications'],
  ['configuracoes', 'configuration'],
  ['notificacoes', 'communications'],
]);

function walk(directory) {
  const absoluteDirectory = path.join(root, directory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path.relative(root, absolutePath)));
    else if (entry.name === 'route.ts') files.push(absolutePath);
  }
  return files;
}

function routePath(file, directory) {
  const relative = path.relative(path.join(root, directory), path.dirname(file));
  const segments = relative === '' ? [] : relative.split(path.sep);
  const normalized = segments.map((segment) => {
    if (segment.startsWith('[[...') && segment.endsWith(']]')) return `:${segment.slice(5, -2)}*?`;
    if (segment.startsWith('[...') && segment.endsWith(']')) return `:${segment.slice(4, -1)}*`;
    if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`;
    return segment;
  });
  return `/api/${normalized.join('/')}`.replace(/\/$/, '');
}

function resolveProtection(pathname) {
  const rule = protectionRules.find((candidate) =>
    candidate.exact ? pathname === candidate.prefix : pathname.startsWith(candidate.prefix),
  );
  return rule?.protection ?? 'AUTH_USER';
}

const authEvidenceTokens = [
    'resolveTenantSession',
    'resolveTenantScope',
    'withTenantSession',
    'getEventsContext',
    'requireFinanceUser',
    'requirePortalUser',
    'verifyMobileAccessToken',
    'getSessionUser',
    'getServerSession',
    'getToken',
    'mobileAccessToken',
    'requireAdmin',
    'requireSupportApi',
    'getAulasSessionUser',
    'resolveAulasAccessScope',
    'assertAulasWriteAccess',
    'canAccessAulas',
    'assertMobileBillingActor',
    'resolveSessionAccess',
    'authorizeNotifications',
    'isAuthorized',
    'isAuthorizedWorkerRequest',
    'requireDashboardBlockContaId',
    'runFinancialReportRoute',
    'withBillingAgreementRequest',
    'authenticate',
    'hasCronSecret',
    'requireCronSecret',
    'resolveAsaasWebhookAccessToken',
    'verifyAsaasWebhook',
    'authenticateWebhook',
  'webhookAuth',
];

const protectionEvidenceTokens = {
  AUTH_USER: authEvidenceTokens,
  TENANT_ADMIN: [
    ...authEvidenceTokens,
    'requireAdmin',
    'requireSupportApi',
    'adminAuth',
    'assertAdmin',
  ],
  TENANT_FINANCE: [
    ...authEvidenceTokens,
    'requireFinanceUser',
    'assertFinance',
    'financeRole',
  ],
  MOBILE_ACCESS_TOKEN: [
    ...authEvidenceTokens,
    'verifyMobileAccessToken',
    'getMobilePasswordChangeActor',
    'mobileAccessToken',
    'authorization',
    'Bearer',
  ],
  CRON_SECRET: [
    ...authEvidenceTokens,
    'hasCronSecret',
    'requireCronSecret',
    'CRON_SECRET',
    'cronSecret',
    'x-vercel-cron',
  ],
  WEBHOOK_TOKEN: [
    ...authEvidenceTokens,
    'verifyAsaasWebhook',
    'resolveAsaasWebhookAccessToken',
    'authenticateWebhook',
    'webhookAuth',
    'signature',
    'webhookSecret',
    'WEBHOOK',
    'stripe-signature',
    'whatsapp-signature',
  ],
};

function resolveLocalImport(file, specifier, app) {
  const base = specifier.startsWith('@/')
    ? path.join(root, app === 'admin' ? 'apps/admin' : 'apps/web', specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(file), specifier)
      : null;
  if (!base) return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function collectLocalSources(file, app, visited = new Set()) {
  if (visited.has(file) || !fs.existsSync(file)) return [];
  visited.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const sources = [source];
  const imports = [...source.matchAll(/(?:from|import|export)\s*(?:\([^)]*\)\s*)?['"]([^'"]+)['"]/g)];
  for (const match of imports) {
    const dependency = resolveLocalImport(file, match[1], app);
    if (dependency) sources.push(...collectLocalSources(dependency, app, visited));
  }
  return sources;
}

function authEvidence(file, app, protection) {
  if (protection === 'PUBLIC') return ['PUBLIC_ROUTE'];
  const sources = collectLocalSources(file, app).join('\\n');
  const tokens = protectionEvidenceTokens[protection] ?? authEvidenceTokens;
  return [...new Set(tokens.filter((token) => sources.includes(token)))];
}

function hasNearbyTest(file) {
  const directory = path.dirname(file);
  const candidates = [];
  for (const extension of ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx']) {
    candidates.push(`${file.slice(0, -'.ts'.length)}${extension}`);
  }
  const siblingTests = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((entry) => /\.(test|spec)\.(ts|tsx)$/.test(entry)).map((entry) => path.join(directory, entry))
    : [];
  const testDirectory = path.join(directory, '__tests__');
  const nestedTests = fs.existsSync(testDirectory)
    ? fs.readdirSync(testDirectory).filter((entry) => /\.(test|spec)\.(ts|tsx)$/.test(entry)).map((entry) => path.join(testDirectory, entry))
    : [];
  return [...candidates, ...siblingTests, ...nestedTests].some((candidate) => fs.existsSync(candidate));
}

function hasDirectPrismaImport(source) {
  // `prisma-tenant` is an approved tenant-aware adapter, not a raw ORM client.
  // Type-only imports from @prisma/client do not create a persistence boundary.
  const runtimeSource = source.replace(
    /import\s+type[\s\S]*?from\s*["']@prisma\/client["'];?/g,
    '',
  );
  return [...runtimeSource.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].some((match) => {
    const specifier = match[1];
    return specifier === '@alusa/database'
      || specifier === '@alusa/lib/prisma'
      || specifier === '@/src/prisma'
      || specifier === '@/lib/prisma'
      || specifier === '@/prisma/client';
  });
}

function classify(file, app, directory) {
  const source = fs.readFileSync(file, 'utf8');
  const pathname = routePath(file, directory);
  const firstSegment = pathname.split('/')[2] ?? '';
  const protection = resolveProtection(pathname);
  const category = domainCategories.get(firstSegment) ?? 'other';
  const tenantMode = protection === 'PUBLIC'
    ? 'public'
    : protection === 'WEBHOOK_TOKEN'
      ? 'webhook-payload'
      : protection === 'CRON_SECRET'
        ? 'explicit-or-iterated'
        : 'authenticated-tenant';

  return {
    app,
    file: path.relative(root, file),
    path: pathname,
    category,
    protection,
    tenantMode,
    authEvidence: authEvidence(file, app, protection).length > 0,
    authEvidenceTokens: authEvidence(file, app, protection),
    hasDTOValidation: /(?:DTO|Schema)\.(?:parse|safeParse)|(?:Schema|DTO)\.parse/.test(source),
    hasNearbyTest: hasNearbyTest(file),
    directPrisma: hasDirectPrismaImport(source),
    directAsaas: /(?:from|require\()\s*["'][^"']*@alusa\/(?:asaas|asaas-gateway)[^"']*["']/.test(source),
  };
}

function buildInventory() {
  const routes = routeRoots.flatMap(({ app, directory }) =>
    walk(directory).map((file) => classify(file, app, directory)),
  ).sort((a, b) => a.path.localeCompare(b.path) || a.app.localeCompare(b.app));

  const unclassified = routes.filter((route) => route.category === 'other');
  const invalidProtection = routes.filter((route) => !route.protection);
  const directAsaas = routes.filter((route) => route.directAsaas);

  return {
    generatedAt: 'deterministic',
    routeCount: routes.length,
    summary: {
      byApp: Object.fromEntries(routeRoots.map(({ app }) => [app, routes.filter((route) => route.app === app).length])),
      byCategory: Object.fromEntries([...new Set(routes.map((route) => route.category))].sort().map((category) => [category, routes.filter((route) => route.category === category).length])),
      byProtection: Object.fromEntries([...new Set(routes.map((route) => route.protection))].sort().map((protection) => [protection, routes.filter((route) => route.protection === protection).length])),
      withoutNearbyTest: routes.filter((route) => !route.hasNearbyTest).length,
      withoutAuthEvidence: routes.filter((route) => !route.authEvidence && route.protection !== 'PUBLIC').length,
      directPrisma: routes.filter((route) => route.directPrisma).length,
      directAsaas: directAsaas.length,
    },
    routes,
    checks: {
      unclassified: unclassified.map((route) => route.file),
      invalidProtection: invalidProtection.map((route) => route.file),
      directAsaas: directAsaas.map((route) => route.file),
    },
  };
}

const inventory = buildInventory();
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

if (process.argv.includes('--write')) {
  fs.writeFileSync(outputPath, serialized, 'utf8');
  console.log(`[route-inventory] escrito ${path.relative(root, outputPath)}`);
} else {
  if (!fs.existsSync(outputPath)) {
    console.error(`[route-inventory] FALHOU: arquivo ausente ${path.relative(root, outputPath)}`);
    process.exitCode = 1;
  } else if (fs.readFileSync(outputPath, 'utf8') !== serialized) {
    console.error('[route-inventory] FALHOU: inventário desatualizado; execute pnpm audit:route-inventory -- --write.');
    process.exitCode = 1;
  }
}

console.log(`[route-inventory] routes=${inventory.routeCount}`);
console.log(`[route-inventory] direct-prisma=${inventory.summary.directPrisma}`);
console.log(`[route-inventory] without-nearby-test=${inventory.summary.withoutNearbyTest}`);
console.log(`[route-inventory] without-auth-evidence=${inventory.summary.withoutAuthEvidence}`);

if (inventory.checks.unclassified.length > 0) {
  console.error(`[route-inventory] FALHOU: ${inventory.checks.unclassified.length} rotas sem categoria.`);
  process.exitCode = 1;
}
if (inventory.checks.invalidProtection.length > 0) {
  console.error(`[route-inventory] FALHOU: ${inventory.checks.invalidProtection.length} rotas sem proteção.`);
  process.exitCode = 1;
}
if (inventory.checks.directAsaas.length > 0) {
  console.error('[route-inventory] FALHOU: rotas não podem importar Asaas diretamente.');
  process.exitCode = 1;
}
const routesWithoutAuthEvidence = inventory.routes.filter(
  (route) => route.protection !== 'PUBLIC' && !route.authEvidence,
);
if (routesWithoutAuthEvidence.length > 0) {
  console.error('[route-inventory] FALHOU: rotas protegidas sem evidência local de autenticação/autorização.');
  for (const route of routesWithoutAuthEvidence) {
    console.error(`- ${route.file} (${route.protection})`);
  }
  process.exitCode = 1;
}
