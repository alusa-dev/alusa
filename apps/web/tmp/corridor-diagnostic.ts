import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { chromium, type Locator, type Page } from 'playwright';
import { encode } from 'next-auth/jwt';

import { resetDb } from '../e2e/utils/reset-db';

type CorridorConfig = {
  x: number;
  y: number;
  width: number;
  height: number;
  orientation?: 'vertical' | 'horizontal';
  rotation?: number;
  autoFit?: boolean;
  seatGapTop?: number;
  seatGapRight?: number;
  seatGapBottom?: number;
  seatGapLeft?: number;
};

type ScenarioDefinition = {
  slug: string;
  corridors: CorridorConfig[];
};

type MapSeed = { id: string; name: string };

type ScenarioRunResult = {
  slug: string;
  url: string;
  screenshotPath: string;
  httpStatus: number;
  seatCount: number;
  sectionCount: number;
  objectCount: number;
  corridorCount: number;
  horizontalGaps: Array<{ from: string; to: string; gap: number }>;
  verticalGaps: Array<{ from: string; to: string; gap: number }>;
  enlargedHorizontalGaps: Array<{ from: string; to: string; gap: number }>;
  enlargedVerticalGaps: Array<{ from: string; to: string; gap: number }>;
  corridorObjects: Array<{ id: string; x: number; y: number; width: number | null; height: number | null; rotation: number; axis: unknown; autoFit: unknown }>;
  consoleErrors: string[];
  pageErrors: string[];
  findings: string[];
};

const prisma = new PrismaClient();
const baseURL = 'http://localhost:3001';
const outputDir = '/Users/blendstudio/Projects/alusa/tmp/corridor-diagnostic';
const screenshotsDir = path.join(outputDir, 'screenshots');
const scenarios: ScenarioDefinition[] = [
  { slug: 'cenario-base-100x12', corridors: [] },
  {
    slug: 'cenario-vertical-unico',
    corridors: [{ x: 304, y: 120, width: 32, height: 280, orientation: 'vertical', autoFit: true }],
  },
  {
    slug: 'cenario-vertical-assimetrico',
    corridors: [
      {
        x: 304,
        y: 120,
        width: 32,
        height: 280,
        orientation: 'vertical',
        autoFit: true,
        seatGapLeft: 40,
        seatGapRight: 8,
      },
    ],
  },
  {
    slug: 'cenario-dois-verticais',
    corridors: [
      { x: 224, y: 120, width: 32, height: 280, orientation: 'vertical', autoFit: true },
      { x: 384, y: 120, width: 32, height: 280, orientation: 'vertical', autoFit: true },
    ],
  },
  {
    slug: 'cenario-horizontal-assimetrico',
    corridors: [
      {
        x: 120,
        y: 224,
        width: 420,
        height: 32,
        orientation: 'horizontal',
        autoFit: true,
        seatGapTop: 40,
        seatGapBottom: 8,
      },
    ],
  },
  {
    slug: 'cenario-dois-horizontais',
    corridors: [
      { x: 120, y: 184, width: 420, height: 32, orientation: 'horizontal', autoFit: true },
      { x: 120, y: 344, width: 420, height: 32, orientation: 'horizontal', autoFit: true },
    ],
  },
  {
    slug: 'cenario-interseccao-vh',
    corridors: [
      { x: 304, y: 120, width: 32, height: 280, orientation: 'vertical', autoFit: true },
      { x: 120, y: 224, width: 420, height: 32, orientation: 'horizontal', autoFit: true },
    ],
  },
  {
    slug: 'cenario-rotacao-90',
    corridors: [
      { x: 320, y: 120, width: 280, height: 32, orientation: 'horizontal', rotation: 90, autoFit: true },
    ],
  },
];

function uniqueCpfCnpj() {
  const last14 = String(Date.now()).slice(-14);
  return last14.padStart(14, '0');
}

async function ensureOutputDirs() {
  await fs.mkdir(screenshotsDir, { recursive: true });
}

async function seedScenarios() {
  await resetDb(prisma);

  const conta = await prisma.conta.create({
    data: { id: randomUUID(), nome: 'Escola E2E Mapas', cpfCnpj: uniqueCpfCnpj() },
    select: { id: true },
  });

  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Admin E2E Mapas',
      email: 'admin-map-editor@test.local',
      senhaHash: 'hash_nao_usado',
      role: 'ADMIN',
      status: 'ATIVO',
    },
    select: { id: true, email: true },
  });

  await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: user.id } });

  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId: conta.id,
      name: 'Evento QA Corredores',
      type: 'GRADUATION',
      status: 'PLANNING',
      startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      ticketMode: 'NUMBERED_SEATS',
    },
    select: { id: true, name: true },
  });

  const mapsBySlug = new Map<string, MapSeed>();
  for (const scenario of scenarios) {
    const map = await prisma.eventMap.create({
      data: {
        id: randomUUID(),
        contaId: conta.id,
        eventId: event.id,
        name: scenario.slug,
        status: 'DRAFT',
      },
      select: { id: true, name: true },
    });

    await prisma.eventMapLevel.create({
      data: {
        id: randomUUID(),
        contaId: conta.id,
        eventMapId: map.id,
        name: 'Prancheta 1',
        sortOrder: 0,
        widthPx: 1440,
        heightPx: 900,
        unit: 'px',
        scale: null,
      },
    });

    mapsBySlug.set(scenario.slug, map);
  }

  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET ?? 'testsecret',
    token: {
      id: user.id,
      email: user.email,
      name: 'Admin E2E Mapas',
      role: 'ADMIN',
      contaId: conta.id,
      emailVerified: true,
    },
  });

  return { eventId: event.id, token, mapsBySlug };
}

function screenPointForMap(canvasBox: { x: number; y: number }, mapX: number, mapY: number) {
  const zoom = 0.7;
  const pan = 80;
  return {
    x: canvasBox.x + pan + mapX * zoom,
    y: canvasBox.y + pan + mapY * zoom,
  };
}

async function openPresets(page: Page) {
  await page.getByLabel('Presets').click();
}

async function openEditor(page: Page, eventId: string, map: MapSeed) {
  const url = `${baseURL}/events/${eventId}/maps/${map.id}/editor`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('heading', { name: map.name }).waitFor({ timeout: 30000 });
  const canvas = page.getByTestId('map-canvas');
  await canvas.waitFor({ timeout: 30000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`Canvas sem bounding box em ${map.name}`);
  return { url, canvas, box };
}

async function createSeatGrid(page: Page, canvasBox: { x: number; y: number }) {
  await openPresets(page);
  await page.getByRole('menuitem', { name: 'Adicionar assento' }).click();
  const start = screenPointForMap(canvasBox, 120, 120);
  await page.mouse.click(start.x, start.y);

  await page.getByText('Organizar assentos').waitFor({ timeout: 15000 });
  await page.getByLabel('Linhas').fill('9');
  await page.getByLabel('Colunas').fill('12');
  await page.getByLabel('Assentos').fill('100');
  await page.getByLabel('Tamanho').fill('20');
  await page.getByLabel('Espaço horizontal').fill('40');
  await page.getByLabel('Espaço vertical').fill('40');
  await page.getByRole('button', { name: 'Criar assentos' }).click();
  await page.waitForTimeout(1200);
}

async function fillNumber(locator: Locator, value: number) {
  await locator.click();
  await locator.fill(String(value));
  await locator.press('Tab');
}

async function setCheckboxState(locator: Locator, expected: boolean) {
  const current = await locator.isChecked();
  if (current !== expected) {
    await locator.click();
  }
}

async function configureCorridor(page: Page, corridor: CorridorConfig) {
  const panel = page.locator('aside');
  await panel.getByText('Corredor').waitFor({ timeout: 10000 });
  await fillNumber(panel.getByLabel('X'), corridor.x);
  await fillNumber(panel.getByLabel('Y'), corridor.y);
  await fillNumber(panel.getByLabel('Largura'), corridor.width);
  await fillNumber(panel.getByLabel('Altura'), corridor.height);

  if (typeof corridor.rotation === 'number') {
    await fillNumber(panel.getByLabel('Rotação'), corridor.rotation);
  }

  if (corridor.orientation) {
    await panel.getByLabel('Orientação').selectOption(corridor.orientation);
  }

  if (typeof corridor.autoFit === 'boolean') {
    await setCheckboxState(panel.getByRole('checkbox'), corridor.autoFit);
  }

  if (typeof corridor.seatGapTop === 'number') {
    await fillNumber(panel.getByLabel('Superior'), corridor.seatGapTop);
  }
  if (typeof corridor.seatGapRight === 'number') {
    await fillNumber(panel.getByLabel('Direita'), corridor.seatGapRight);
  }
  if (typeof corridor.seatGapBottom === 'number') {
    await fillNumber(panel.getByLabel('Inferior'), corridor.seatGapBottom);
  }
  if (typeof corridor.seatGapLeft === 'number') {
    await fillNumber(panel.getByLabel('Esquerda'), corridor.seatGapLeft);
  }

  await page.waitForTimeout(500);
}

async function addCorridor(page: Page, canvasBox: { x: number; y: number }, corridor: CorridorConfig, index: number) {
  await openPresets(page);
  await page.getByRole('menuitem', { name: 'Corredor' }).click();
  const dropPoint = screenPointForMap(canvasBox, 220 + index * 20, 220 + index * 20);
  await page.mouse.click(dropPoint.x, dropPoint.y);
  await configureCorridor(page, corridor);
}

async function saveMap(page: Page) {
  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await saveButton.click();
  await page.waitForTimeout(1500);
}

function bySeatNumber(left: { seatNumber: string | null }, right: { seatNumber: string | null }) {
  return Number(left.seatNumber ?? 0) - Number(right.seatNumber ?? 0);
}

function byRowLabel(left: { rowLabel: string | null }, right: { rowLabel: string | null }) {
  return String(left.rowLabel ?? '').localeCompare(String(right.rowLabel ?? ''));
}

function seatGapX(left: { x: number; size: number | null }, right: { x: number; size: number | null }) {
  return right.x - left.x - (left.size ?? 20);
}

function seatGapY(top: { y: number; size: number | null }, bottom: { y: number; size: number | null }) {
  return bottom.y - top.y - (top.size ?? 20);
}

function buildGapSeries<T extends { displayLabel: string; x: number; y: number; size: number | null }>(items: T[], axis: 'x' | 'y') {
  const gaps: Array<{ from: string; to: string; gap: number }> = [];
  for (let index = 0; index < items.length - 1; index += 1) {
    const current = items[index]!;
    const next = items[index + 1]!;
    gaps.push({
      from: current.displayLabel,
      to: next.displayLabel,
      gap: Number((axis === 'x' ? seatGapX(current, next) : seatGapY(current, next)).toFixed(2)),
    });
  }
  return gaps;
}

function isSameGeometry(
  left: { x: number; y: number; width: number | null; height: number | null },
  right: { x: number; y: number; width: number | null; height: number | null },
) {
  return (
    Math.abs(left.x - right.x) < 1 &&
    Math.abs(left.y - right.y) < 1 &&
    Math.abs((left.width ?? 0) - (right.width ?? 0)) < 1 &&
    Math.abs((left.height ?? 0) - (right.height ?? 0)) < 1
  );
}

function analyzeScenario(slug: string, payload: any, consoleErrors: string[], pageErrors: string[]): ScenarioRunResult['findings'] {
  const seats = payload.seats as Array<any>;
  const objects = payload.objects as Array<any>;
  const rowA = seats.filter((seat) => seat.rowLabel === 'A').sort(bySeatNumber);
  const column1 = seats.filter((seat) => seat.seatNumber === '1').sort(byRowLabel);
  const horizontalGaps = buildGapSeries(rowA, 'x');
  const verticalGaps = buildGapSeries(column1, 'y');
  const enlargedHorizontalGaps = horizontalGaps.filter((entry) => entry.gap > 35);
  const enlargedVerticalGaps = verticalGaps.filter((entry) => entry.gap > 35);
  const findings: string[] = [];

  const baseGap = 20;
  const nonExpandedHorizontal = horizontalGaps.filter((entry) => entry.gap <= 35);
  const nonExpandedVertical = verticalGaps.filter((entry) => entry.gap <= 35);

  if (consoleErrors.length > 0) findings.push(`Console errors: ${consoleErrors.length}`);
  if (pageErrors.length > 0) findings.push(`Page errors: ${pageErrors.length}`);

  if (slug === 'cenario-base-100x12') {
    if (seats.length !== 100) findings.push(`Grade base persistiu ${seats.length} assentos em vez de 100.`);
    if (horizontalGaps.some((entry) => Math.abs(entry.gap - baseGap) > 2)) findings.push('Grade base alterou o espaçamento horizontal sem corredor.');
    if (verticalGaps.some((entry) => Math.abs(entry.gap - baseGap) > 2)) findings.push('Grade base alterou o espaçamento vertical sem corredor.');
  }

  if (slug === 'cenario-vertical-unico') {
    if (enlargedHorizontalGaps.length !== 1) findings.push(`Esperava 1 gap horizontal ampliado, recebi ${enlargedHorizontalGaps.length}.`);
    if (enlargedVerticalGaps.length !== 0) findings.push(`Corredor vertical não deveria abrir gap vertical, mas abriu ${enlargedVerticalGaps.length}.`);
  }

  if (slug === 'cenario-vertical-assimetrico') {
    const mainGap = enlargedHorizontalGaps[0]?.gap ?? 0;
    if (enlargedHorizontalGaps.length !== 1) findings.push(`Esperava 1 gap horizontal ampliado, recebi ${enlargedHorizontalGaps.length}.`);
    if (Math.abs(mainGap - 80) > 6) findings.push(`Gap horizontal assimétrico deveria ficar perto de 80px e ficou em ${mainGap}px.`);
  }

  if (slug === 'cenario-dois-verticais') {
    if (enlargedHorizontalGaps.length !== 2) findings.push(`Esperava 2 gaps horizontais ampliados, recebi ${enlargedHorizontalGaps.length}.`);
  }

  if (slug === 'cenario-horizontal-assimetrico') {
    const mainGap = enlargedVerticalGaps[0]?.gap ?? 0;
    if (enlargedVerticalGaps.length !== 1) findings.push(`Esperava 1 gap vertical ampliado, recebi ${enlargedVerticalGaps.length}.`);
    if (Math.abs(mainGap - 80) > 6) findings.push(`Gap vertical assimétrico deveria ficar perto de 80px e ficou em ${mainGap}px.`);
    if (enlargedHorizontalGaps.length !== 0) findings.push(`Corredor horizontal não deveria abrir gap horizontal na linha A, mas abriu ${enlargedHorizontalGaps.length}.`);
  }

  if (slug === 'cenario-dois-horizontais') {
    if (enlargedVerticalGaps.length !== 2) findings.push(`Esperava 2 gaps verticais ampliados, recebi ${enlargedVerticalGaps.length}.`);
  }

  if (slug === 'cenario-interseccao-vh') {
    if (enlargedHorizontalGaps.length < 1 || enlargedVerticalGaps.length < 1) {
      findings.push(`Interseção deveria abrir gaps nos dois eixos, mas retornou horizontal=${enlargedHorizontalGaps.length} vertical=${enlargedVerticalGaps.length}.`);
    }
    const corridors = objects.filter((object) => object.type === 'CORRIDOR');
    if (corridors.length === 2 && isSameGeometry(corridors[0], corridors[1])) {
      findings.push('Os dois corredores intersectados colapsaram para a mesma geometria final.');
    }
  }

  if (slug === 'cenario-rotacao-90') {
    if (enlargedHorizontalGaps.length === 0 && enlargedVerticalGaps.length > 0) {
      findings.push('Corredor rotacionado para visual vertical continuou refluindo como horizontal.');
    }
  }

  if (nonExpandedHorizontal.some((entry) => Math.abs(entry.gap - baseGap) > 3)) {
    findings.push('Há drift no espaçamento horizontal interno entre assentos fora do gap principal.');
  }
  if (nonExpandedVertical.some((entry) => Math.abs(entry.gap - baseGap) > 3)) {
    findings.push('Há drift no espaçamento vertical interno entre assentos fora do gap principal.');
  }

  return findings;
}

async function fetchMap(page: Page, eventId: string, mapId: string, token: string) {
  const response = await page.request.get(`${baseURL}/api/events/${eventId}/maps/${mapId}`, {
    headers: { cookie: `next-auth.session-token=${token}` },
  });
  const body = await response.json();
  return { status: response.status(), data: body.data ?? body };
}

async function run() {
  await ensureOutputDirs();
  const seed = await seedScenarios();

  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel: 'chrome', devtools: true });
  } catch {
    browser = await chromium.launch({ headless: false, devtools: true });
  }

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addCookies([
    {
      name: 'next-auth.session-token',
      value: seed.token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  const results: ScenarioRunResult[] = [];

  for (const scenario of scenarios) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    const map = seed.mapsBySlug.get(scenario.slug);
    if (!map) throw new Error(`Mapa não encontrado para ${scenario.slug}`);

    const { url, canvas, box } = await openEditor(page, seed.eventId, map);
    await createSeatGrid(page, { x: box.x, y: box.y });

    for (let index = 0; index < scenario.corridors.length; index += 1) {
      await addCorridor(page, { x: box.x, y: box.y }, scenario.corridors[index]!, index);
    }

    await saveMap(page);
    const screenshotPath = path.join(screenshotsDir, `${scenario.slug}.png`);
    await canvas.screenshot({ path: screenshotPath });
    const fetched = await fetchMap(page, seed.eventId, map.id, seed.token);
    const data = fetched.data;

    const seats = data.seats as Array<any>;
    const rowA = seats.filter((seat) => seat.rowLabel === 'A').sort(bySeatNumber);
    const column1 = seats.filter((seat) => seat.seatNumber === '1').sort(byRowLabel);
    const horizontalGaps = buildGapSeries(rowA, 'x');
    const verticalGaps = buildGapSeries(column1, 'y');
    const enlargedHorizontalGaps = horizontalGaps.filter((entry) => entry.gap > 35);
    const enlargedVerticalGaps = verticalGaps.filter((entry) => entry.gap > 35);
    const corridorObjects = (data.objects as Array<any>)
      .filter((object) => object.type === 'CORRIDOR')
      .map((object) => ({
        id: object.id,
        x: object.x,
        y: object.y,
        width: object.width ?? null,
        height: object.height ?? null,
        rotation: object.rotation ?? 0,
        axis: object.data?.corridorAxis,
        autoFit: object.data?.corridorAutoFit,
      }));

    results.push({
      slug: scenario.slug,
      url,
      screenshotPath,
      httpStatus: fetched.status,
      seatCount: data.seats.length,
      sectionCount: data.sections.length,
      objectCount: data.objects.length,
      corridorCount: corridorObjects.length,
      horizontalGaps,
      verticalGaps,
      enlargedHorizontalGaps,
      enlargedVerticalGaps,
      corridorObjects,
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      findings: analyzeScenario(scenario.slug, data, consoleErrors, pageErrors),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseURL,
    eventId: seed.eventId,
    screenshotDir: screenshotsDir,
    scenarios: results,
  };

  const reportPath = path.join(outputDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  await context.close();
}

run()
  .catch(async (error) => {
    console.error('[corridor-diagnostic][error]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
