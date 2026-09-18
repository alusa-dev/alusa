import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inventoryPath = path.join(root, 'docs/architecture/api-route-boundary-inventory.json');
const coveragePath = path.join(root, 'docs/architecture/api-critical-route-coverage.json');
const failures = [];

if (!fs.existsSync(inventoryPath)) failures.push(`inventário de rotas ausente: ${path.relative(root, inventoryPath)}`);
if (!fs.existsSync(coveragePath)) failures.push(`mapa de cobertura crítica ausente: ${path.relative(root, coveragePath)}`);

if (failures.length === 0) {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  for (const surface of coverage.surfaces ?? []) {
    const matchingRoutes = inventory.routes.filter((route) =>
      route.path === surface.pathPrefix || route.path.startsWith(`${surface.pathPrefix}/`),
    );
    if (matchingRoutes.length === 0) failures.push(`${surface.pathPrefix}: nenhuma rota correspondente`);
    for (const testFile of surface.tests ?? []) {
      if (!fs.existsSync(path.join(root, testFile))) failures.push(`${surface.pathPrefix}: evidência ausente (${testFile})`);
    }
  }
}

if (failures.length > 0) {
  console.error('[critical-route-coverage] FALHOU');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  console.log(`[critical-route-coverage] surfaces=${coverage.surfaces.length}`);
  console.log('[critical-route-coverage] OK: superfícies críticas possuem evidência de teste existente.');
}
