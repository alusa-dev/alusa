import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const proxyPath = path.join(root, 'apps/web/proxy.ts');
const policyPath = path.join(root, 'apps/web/lib/security/api-rate-limit.ts');
const registryPath = path.join(root, 'apps/web/lib/security/route-protection-registry.ts');

const [proxy, policy, registry] = await Promise.all([
  fs.readFile(proxyPath, 'utf8'),
  fs.readFile(policyPath, 'utf8'),
  fs.readFile(registryPath, 'utf8'),
]);

const violations = [];
const requiredPolicies = [
  'authenticated-read',
  'mutation',
  'financial-mutation',
  'expensive-operation',
  'tenant-admin',
  'public-write',
];

if (!proxy.includes('enforceApiRateLimit')) violations.push('proxy sem enforceApiRateLimit');
for (const policyName of requiredPolicies) {
  if (!policy.includes(`name: '${policyName}'`)) violations.push(`política ausente: ${policyName}`);
}
for (const namespace of ['/api/webhooks/', '/api/jobs/', '/api/mobile/']) {
  if (!policy.includes(`'${namespace}'`)) violations.push(`exceção ausente no limiter global: ${namespace}`);
  if (!registry.includes(`prefix: '${namespace}'`)) violations.push(`namespace sem proteção registrada: ${namespace}`);
}

console.log(`[rate-limit-policy] policies=${requiredPolicies.length} violations=${violations.length}`);
if (violations.length > 0) {
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
