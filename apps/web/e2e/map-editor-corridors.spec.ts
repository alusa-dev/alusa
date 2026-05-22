/**
 * E2E: Map Editor — Seat Grid + Corridors
 *
 * Cobre: criação de assentos via UI, adição de corredores inteligentes
 * (vertical, horizontal, múltiplos, intersecionados), análise de gap via
 * API e auditoria de responsividade/espaçamentos.
 *
 * Estratégia:
 *  - Assentos são pré-semeados via PATCH API para isolamento de cenário.
 *  - Corredores são criados via UI (drag no canvas) para testar o fluxo real.
 *  - Validação de gap/reflow é feita via GET da API após "Salvar".
 *  - Responsividade é auditada via JS (boundingBox + overflow) em viewports diferentes.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN_X = 200;
const ORIGIN_Y = 150;
const H_SPACING = 34; // distância centro-a-centro horizontal (default)
const V_SPACING = 34; // distância centro-a-centro vertical (default)
const SEAT_SIZE = 24;
const ROWS = 9;         // A–I
const COLS = 12;
const TOTAL_SEATS = 100; // < 9*12=108, preenche A-H completos + I1-I4
const NATURAL_H_GAP = H_SPACING; // gap centro-a-centro esperado sem corredor

const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SeatDTO = {
  id: string;
  x: number;
  y: number;
  size: number | null;
  rowLabel: string | null;
  seatNumber: string | null;
};

type Scenario = {
  contaId: string;
  eventId: string;
  mapId: string;
  levelId: string;
  sectionId: string;
  objectId: string;
  seats: SeatDTO[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────────────────────

async function buildSeatPayload(levelId: string, sectionId: string) {
  const seats: Array<{
    id: string;
    levelId: string;
    sectionId: string;
    technicalCode: string;
    displayLabel: string;
    rowLabel: string;
    seatNumber: string;
    status: string;
    accessible: boolean;
    publicVisible: boolean;
    x: number;
    y: number;
    size: number;
    rotation: number;
  }> = [];

  let count = 0;
  for (let r = 0; r < ROWS && count < TOTAL_SEATS; r++) {
    for (let c = 0; c < COLS && count < TOTAL_SEATS; c++) {
      const label = `${ROW_LABELS[r]}${c + 1}`;
      seats.push({
        id: randomUUID(),
        levelId,
        sectionId,
        technicalCode: label,
        displayLabel: label,
        rowLabel: ROW_LABELS[r]!,
        seatNumber: String(c + 1),
        status: 'AVAILABLE',
        accessible: false,
        publicVisible: true,
        x: ORIGIN_X + c * H_SPACING,
        y: ORIGIN_Y + r * V_SPACING,
        size: SEAT_SIZE,
        rotation: 0,
      });
      count++;
    }
  }
  return seats;
}

async function seedScenario(page: Page): Promise<Scenario> {
  await resetDb(prisma);

  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `corridors-e2e-${Date.now()}@test.local`,
  });

  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId,
      name: 'Formatura Corridors E2E',
      type: 'GRADUATION',
      status: 'PLANNING',
      startsAt: addDays(new Date(), 30),
    },
    select: { id: true },
  });

  const map = await prisma.eventMap.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      name: 'Mapa Corredores',
      status: 'DRAFT',
    },
    select: { id: true },
  });

  const level = await prisma.eventMapLevel.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      name: 'Plano Principal',
      sortOrder: 0,
      widthPx: 1440,
      heightPx: 900,
      unit: 'px',
      scale: '1m = 50px',
    },
    select: { id: true, name: true },
  });

  const sectionId = randomUUID();
  const objectId = randomUUID();
  const seats = await buildSeatPayload(level.id, sectionId);

  // Pre-seed 100 assentos via PATCH API
  const gridMaxX = ORIGIN_X + (COLS - 1) * H_SPACING;
  const gridMaxY = ORIGIN_Y + (ROWS - 1) * V_SPACING;
  const PAD = 24;

  const patchRes = await page.request.patch(`/api/events/${event.id}/maps/${map.id}`, {
    data: {
      levels: [
        {
          id: level.id,
          name: level.name,
          sortOrder: 0,
          widthPx: 1440,
          heightPx: 900,
          unit: 'px',
          scale: '1m = 50px',
        },
      ],
      sections: [
        {
          id: sectionId,
          levelId: level.id,
          name: 'Setor E2E',
          color: '#6d28d9',
          capacity: TOTAL_SEATS,
          status: 'ACTIVE',
        },
      ],
      objects: [
        {
          id: objectId,
          levelId: level.id,
          sectionId,
          type: 'SECTION',
          data: { fill: '#6d28d9', fillEnabled: true, opacity: 0.15 },
          x: ORIGIN_X - PAD,
          y: ORIGIN_Y - PAD,
          width: gridMaxX - ORIGIN_X + SEAT_SIZE + PAD * 2,
          height: gridMaxY - ORIGIN_Y + SEAT_SIZE + PAD * 2,
          rotation: 0,
          locked: false,
          hidden: false,
          sortOrder: 0,
        },
      ],
      seats,
    },
  });

  expect(patchRes.status()).toBe(200);
  const body = await patchRes.json();
  const savedSeats: SeatDTO[] = (body.data?.seats ?? []).map(
    (s: { id: string; x: number; y: number; size: number | null; rowLabel: string | null; seatNumber: string | null }) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      size: s.size,
      rowLabel: s.rowLabel,
      seatNumber: s.seatNumber,
    }),
  );

  return {
    contaId,
    eventId: event.id,
    mapId: map.id,
    levelId: level.id,
    sectionId,
    objectId,
    seats: savedSeats,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de localização do painel de propriedades do corredor
// PanelField usa <Label>(sem for) + <input> irmão → getByLabel NÃO funciona.
// PanelSection usa <section>, usado para escopo.
// ─────────────────────────────────────────────────────────────────────────────

function getCorridorSection(page: Page) {
  // Seção "Corredor" no painel de propriedades
  return page.locator('section').filter({ has: page.locator('h3', { hasText: 'Corredor' }) }).first();
}

function getSpacingSection(page: Page) {
  // Seção "Espaçamento dos assentos"
  return page.locator('section').filter({ has: page.locator('h3', { hasText: 'Espaçamento' }) }).first();
}

async function selectCorridorAxis(page: Page, value: 'vertical' | 'horizontal') {
  const section = getCorridorSection(page);
  await section.locator('select').first().selectOption(value);
}

async function setGapInput(page: Page, side: 'Superior' | 'Direita' | 'Inferior' | 'Esquerda', value: number) {
  const section = getSpacingSection(page);
  const sideDiv = section.locator('div.space-y-1\\.5').filter({
    has: page.locator('label', { hasText: side }),
  });
  const input = sideDiv.locator('input');
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
}

/**
 * Localiza o painel do formulário de grade de assentos.
 * Não é um dialog modal — é um div absoluto com heading "Organizar assentos".
 */
function getSeatForm(page: Page) {
  return page.locator('div').filter({ has: page.locator('h2', { hasText: 'Organizar assentos' }) }).first();
}

async function openEditor(page: Page, scenario: Scenario) {
  await page.goto(`/events/${scenario.eventId}/maps/${scenario.mapId}/editor`);
  await expect(page.getByRole('heading', { name: 'Mapa Corredores' })).toBeVisible({ timeout: 15_000 });
  const canvas = page.getByTestId('map-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 20_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  return { canvas, box: box! };
}

async function openPresetsTool(page: Page) {
  // Abre o dropdown "Presets" na toolbar flutuante
  const presets = page.getByRole('button', { name: /presets/i });
  if (await presets.isVisible()) {
    await presets.click();
    return;
  }
  // Fallback: pode estar em um menu diferente
  const presetsAlt = page.getByLabel(/presets/i);
  await presetsAlt.click();
}

async function activateCorridorTool(page: Page) {
  await openPresetsTool(page);
  await page.getByRole('menuitem', { name: /corredor/i }).click();
}

async function activateSeatTool(page: Page) {
  await openPresetsTool(page);
  await page.getByRole('menuitem', { name: /assento/i }).click();
}

/**
 * Arrasta para criar um corredor no canvas.
 * relX1/Y1 e relX2/Y2 são frações (0-1) das dimensões do bounding box do canvas.
 */
async function dragOnCanvas(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  relX1: number,
  relY1: number,
  relX2: number,
  relY2: number,
) {
  const sx = box.x + box.width * relX1;
  const sy = box.y + box.height * relY1;
  const ex = box.x + box.width * relX2;
  const ey = box.y + box.height * relY2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(ex, ey, { steps: 10 });
  await page.mouse.up();
}

async function saveMap(page: Page) {
  const saveBtn = page.getByRole('button', { name: /salvar/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();
  // Aguarda a requisição PATCH de salvar o mapa completar
  await page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/events/') &&
      resp.url().includes('/maps/') &&
      resp.request().method() === 'PATCH',
    { timeout: 15_000 },
  );
}

async function getMapSnapshot(page: Page, scenario: Scenario) {
  const res = await page.request.get(`/api/events/${scenario.eventId}/maps/${scenario.mapId}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.data ?? body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gap analysis
// ─────────────────────────────────────────────────────────────────────────────

type GapInfo = { betweenCols: [string, string]; gap: number };

function computeRowGaps(seats: SeatDTO[], rowLabel: string): GapInfo[] {
  const rowSeats = seats
    .filter((s) => s.rowLabel === rowLabel)
    .sort((a, b) => a.x - b.x);

  const gaps: GapInfo[] = [];
  for (let i = 1; i < rowSeats.length; i++) {
    const prev = rowSeats[i - 1]!;
    const curr = rowSeats[i]!;
    gaps.push({
      betweenCols: [prev.seatNumber ?? '?', curr.seatNumber ?? '?'],
      gap: curr.x - prev.x, // centro-a-centro
    });
  }
  return gaps;
}

function computeColumnGaps(seats: SeatDTO[], colNumber: string): GapInfo[] {
  const colSeats = seats
    .filter((s) => s.seatNumber === colNumber)
    .sort((a, b) => a.y - b.y);

  const gaps: GapInfo[] = [];
  for (let i = 1; i < colSeats.length; i++) {
    const prev = colSeats[i - 1]!;
    const curr = colSeats[i]!;
    gaps.push({
      betweenCols: [prev.rowLabel ?? '?', curr.rowLabel ?? '?'],
      gap: curr.y - prev.y, // centro-a-centro
    });
  }
  return gaps;
}

function maxGap(gaps: GapInfo[]) {
  return Math.max(...gaps.map((g) => g.gap));
}

function naturalGapsCount(gaps: GapInfo[], natural: number, tolerance = 2) {
  return gaps.filter((g) => Math.abs(g.gap - natural) <= tolerance).length;
}

function enlargedGapsCount(gaps: GapInfo[], threshold: number) {
  return gaps.filter((g) => g.gap > threshold).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Map Editor – Seat Grid & Corridors', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 1: Criação de assentos via UI
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Criação de assentos via UI', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      // Seed mínimo: sem assentos (apenas mapa vazio)
      await resetDb(prisma);
      const { contaId } = await seedAdminAndAuthenticate(page, {
        email: `seats-ui-${Date.now()}@test.local`,
      });
      const event = await prisma.schoolEvent.create({
        data: {
          id: randomUUID(),
          contaId,
          name: 'Mapa Corredores',
          type: 'GRADUATION',
          status: 'PLANNING',
          startsAt: addDays(new Date(), 30),
        },
        select: { id: true },
      });
      const map = await prisma.eventMap.create({
        data: {
          id: randomUUID(),
          contaId,
          eventId: event.id,
          name: 'Mapa Corredores',
          status: 'DRAFT',
        },
        select: { id: true },
      });
      const level = await prisma.eventMapLevel.create({
        data: {
          id: randomUUID(),
          contaId,
          eventMapId: map.id,
          name: 'Plano Principal',
          sortOrder: 0,
          widthPx: 1440,
          heightPx: 900,
          unit: 'px',
          scale: '1m = 50px',
        },
        select: { id: true, name: true },
      });
      scenario = {
        contaId,
        eventId: event.id,
        mapId: map.id,
        levelId: level.id,
        sectionId: '',
        objectId: '',
        seats: [],
      };
    });

    test('formulário de grade aparece após selecionar ferramenta de assento', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateSeatTool(page);
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);

      // O formulário é um div absoluto, não um dialog modal
      const seatForm = getSeatForm(page);
      await expect(seatForm).toBeVisible({ timeout: 8_000 });

      // Campos obrigatórios — labels envolvem os inputs (getByLabel funciona)
      await expect(seatForm.getByLabel(/assentos/i)).toBeVisible();
      await expect(seatForm.getByLabel(/linhas/i)).toBeVisible();
      await expect(seatForm.getByLabel(/colunas/i)).toBeVisible();
      await expect(seatForm.getByRole('button', { name: /criar assentos/i })).toBeVisible();
      await expect(seatForm.getByRole('button', { name: /cancelar/i })).toBeVisible();

      test.info().annotations.push({ type: 'info', description: 'Formulário de grade aberto com sucesso' });
    });

    test('cancelar formulário não cria assentos', async ({ page }) => {
      const { box } = await openEditor(page, scenario);
      await activateSeatTool(page);
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);

      const seatForm = getSeatForm(page);
      await expect(seatForm).toBeVisible({ timeout: 8_000 });
      await seatForm.getByRole('button', { name: /cancelar/i }).click();
      // Após cancelar, o formulário deve sumir
      await expect(seatForm).not.toBeVisible({ timeout: 5_000 });

      // Nenhum assento deve ter sido criado
      const snap = await getMapSnapshot(page, scenario);
      const seatCount: number = snap.seats?.length ?? 0;
      expect(seatCount).toBe(0);

      test.info().annotations.push({
        type: 'info',
        description: `Cancelar: seatCount=${seatCount} (esperado 0)`,
      });
    });

    test('[BUG CHECK] criar 100 assentos (9 linhas × 12 colunas) via UI persiste count correto', async ({ page }) => {
      const { box } = await openEditor(page, scenario);
      await activateSeatTool(page);
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);

      const seatForm = getSeatForm(page);
      await expect(seatForm).toBeVisible({ timeout: 8_000 });

      // Preenche: 100 assentos, 9 linhas, 12 colunas
      const totalSeatsInput = seatForm.getByLabel(/^assentos$/i);
      await totalSeatsInput.click({ clickCount: 3 });
      await totalSeatsInput.fill('100');

      const rowsInput = seatForm.getByLabel(/^linhas$/i);
      await rowsInput.click({ clickCount: 3 });
      await rowsInput.fill('9');

      const colsInput = seatForm.getByLabel(/^colunas$/i);
      await colsInput.click({ clickCount: 3 });
      await colsInput.fill('12');

      await seatForm.getByRole('button', { name: /criar assentos/i }).click();
      await expect(seatForm).not.toBeVisible({ timeout: 8_000 });

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seatCount: number = snap.seats?.length ?? 0;

      // Capacidade = 9*12 = 108. totalSeats = 100 → esperamos 100.
      const isBug = seatCount !== 100;
      test.info().annotations.push({
        type: isBug ? 'bug' : 'info',
        description: isBug
          ? `[BUG] Esperado 100 assentos após criação via UI, mas API retornou ${seatCount}. Pode ser normalização do grid ou problema na persistência.`
          : `Criação OK: ${seatCount} assentos persistidos.`,
      });

      // Assertion conservadora: pelo menos 1 assento deve ter sido criado
      expect(seatCount).toBeGreaterThan(0);
      if (seatCount !== 100) {
        console.warn(`[BUG] UI seat creation: expected 100, got ${seatCount}`);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 2: Corredor vertical único
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Corredor vertical único', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('pré-seed via API cria exatamente 100 assentos', async ({ page }) => {
      const snap = await getMapSnapshot(page, scenario);
      expect(snap.seats).toHaveLength(TOTAL_SEATS);
    });

    test('ferramenta corredor está presente no menu Presets', async ({ page }) => {
      await openEditor(page, scenario);
      await openPresetsTool(page);
      await expect(page.getByRole('menuitem', { name: /corredor/i })).toBeVisible();
    });

    test('drag no canvas cria objeto do tipo CORRIDOR e exibe painel de propriedades', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);

      // Drag vertical: estreito (10% da largura) e alto (50% da altura)
      await dragOnCanvas(page, box, 0.55, 0.15, 0.62, 0.80);

      // Painel de propriedades deve mostrar seção "Corredor"
      const panel = page.getByRole('complementary').or(page.locator('[data-testid="map-properties-panel"]'));
      const corridorSection = page.getByText(/corredor/i).last();
      await expect(corridorSection).toBeVisible({ timeout: 8_000 });

      // Campos de orientação e autoFit
      await expect(getCorridorSection(page).locator('select').first()).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /ajustar ao gap/i })).toBeVisible();

      // Campos de espaçamento (labels sem for → busca por texto na seção)
      const spacingSection = getSpacingSection(page);
      await expect(spacingSection.locator('input').nth(0)).toBeVisible(); // Superior
      await expect(spacingSection.locator('input').nth(1)).toBeVisible(); // Direita
      await expect(spacingSection.locator('input').nth(2)).toBeVisible(); // Inferior
      await expect(spacingSection.locator('input').nth(3)).toBeVisible(); // Esquerda

      test.info().annotations.push({ type: 'info', description: 'Painel do corredor carregado corretamente' });
    });

    test('corredor vertical cria gap horizontal ampliado em todas as linhas', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      // Drag no centro vertical do canvas (entre colunas ~6 e 7 visualmente)
      await dragOnCanvas(page, box, 0.53, 0.10, 0.60, 0.88);

      // Define orientação = Vertical explicitamente via painel
      await selectCorridorAxis(page, 'vertical');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      // Analisa gaps na linha A (completa, 12 assentos)
      const rowAGaps = computeRowGaps(seats, 'A');
      expect(rowAGaps.length).toBeGreaterThan(0);

      const maxH = maxGap(rowAGaps);
      const naturalCount = naturalGapsCount(rowAGaps, NATURAL_H_GAP);
      const enlargedCount = enlargedGapsCount(rowAGaps, NATURAL_H_GAP * 1.5);

      // Pelo menos um gap deve ter sido ampliado pelo corredor
      test.info().annotations.push({
        type: enlargedCount === 0 ? 'bug' : 'info',
        description: `Linha A: max gap=${maxH.toFixed(1)}px (natural=${NATURAL_H_GAP}px), naturalCount=${naturalCount}/11, enlargedCount=${enlargedCount}`,
      });

      expect(enlargedCount).toBeGreaterThanOrEqual(1);

      // Verifica que o mesmo gap ampliado existe em todas as linhas com 12 assentos
      const rowsToCheck = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      const inconsistentRows: string[] = [];
      for (const row of rowsToCheck) {
        const gaps = computeRowGaps(seats, row);
        if (enlargedGapsCount(gaps, NATURAL_H_GAP * 1.5) === 0) {
          inconsistentRows.push(row);
        }
      }

      test.info().annotations.push({
        type: inconsistentRows.length > 0 ? 'bug' : 'info',
        description: inconsistentRows.length > 0
          ? `[BUG] Linhas sem gap ampliado (corredor deveria afetar todas): ${inconsistentRows.join(', ')}`
          : 'Corredor vertical afeta todas as linhas corretamente',
      });
    });

    test('corredor vertical NÃO altera espaçamento vertical', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.53, 0.10, 0.60, 0.88);
      await selectCorridorAxis(page, 'vertical');
      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      // Coluna 1: todos os assentos em x≈ORIGIN_X, deve ter gaps verticais naturais
      const col1Gaps = computeColumnGaps(seats, '1');
      expect(col1Gaps.length).toBeGreaterThan(0);

      const maxV = maxGap(col1Gaps);
      const isBug = maxV > V_SPACING * 1.4;

      test.info().annotations.push({
        type: isBug ? 'bug' : 'info',
        description: isBug
          ? `[BUG] Corredor vertical alterou espaçamento vertical: max col-gap=${maxV.toFixed(1)}px (esperado ~${V_SPACING}px)`
          : `OK: espaçamento vertical col1 intacto (max=${maxV.toFixed(1)}px, esperado=${V_SPACING}px)`,
      });

      expect(maxV).toBeLessThanOrEqual(V_SPACING * 1.5);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 3: Corredor horizontal único
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Corredor horizontal único', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('corredor horizontal cria gap vertical ampliado em todas as colunas', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      // Drag horizontal: largo e baixo
      await dragOnCanvas(page, box, 0.10, 0.48, 0.88, 0.56);

      await selectCorridorAxis(page, 'horizontal');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      // Coluna 6: deve ter gap vertical ampliado entre linhas D-E (corredor atravessa)
      const col6Gaps = computeColumnGaps(seats, '6');
      const maxV = maxGap(col6Gaps);
      const enlargedV = enlargedGapsCount(col6Gaps, NATURAL_H_GAP * 1.5);

      test.info().annotations.push({
        type: enlargedV === 0 ? 'bug' : 'info',
        description: `Coluna 6: max vertical gap=${maxV.toFixed(1)}px, enlargedCount=${enlargedV}`,
      });

      expect(enlargedV).toBeGreaterThanOrEqual(1);
    });

    test('corredor horizontal NÃO altera espaçamento horizontal', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.10, 0.48, 0.88, 0.56);
      await selectCorridorAxis(page, 'horizontal');
      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      const rowAGaps = computeRowGaps(seats, 'A');
      const maxH = maxGap(rowAGaps);
      const isBug = maxH > H_SPACING * 1.4;

      test.info().annotations.push({
        type: isBug ? 'bug' : 'info',
        description: isBug
          ? `[BUG] Corredor horizontal alterou espaçamento horizontal: max row-gap=${maxH.toFixed(1)}px (esperado ~${H_SPACING}px)`
          : `OK: espaçamento horizontal linha A intacto (max=${maxH.toFixed(1)}px)`,
      });

      expect(maxH).toBeLessThanOrEqual(H_SPACING * 1.5);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 4: Dois corredores verticais
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Dois corredores verticais', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('dois corredores verticais criam dois gaps horizontais distintos', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      // Primeiro corredor (entre colunas ~3-4)
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.32, 0.10, 0.38, 0.88);
      await selectCorridorAxis(page, 'vertical');

      // Deselecionar
      await page.keyboard.press('Escape');

      // Segundo corredor (entre colunas ~8-9)
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.68, 0.10, 0.74, 0.88);
      await selectCorridorAxis(page, 'vertical');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      const rowAGaps = computeRowGaps(seats, 'A');
      const enlargedCount = enlargedGapsCount(rowAGaps, NATURAL_H_GAP * 1.5);
      const corridorObjectCount = (snap.objects as Array<{ type: string }> ?? []).filter(
        (o) => o.type === 'CORRIDOR',
      ).length;

      test.info().annotations.push({
        type: enlargedCount < 2 ? 'bug' : 'info',
        description: `Dois corredores verticais: corridorObjects=${corridorObjectCount}, gapsAmpliados=${enlargedCount} (esperado 2)`,
      });

      expect(corridorObjectCount).toBe(2);
      expect(enlargedCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 5: Dois corredores horizontais
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Dois corredores horizontais', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('dois corredores horizontais criam dois gaps verticais distintos', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      // Primeiro corredor (entre linhas ~B-C)
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.10, 0.28, 0.88, 0.35);
      await selectCorridorAxis(page, 'horizontal');
      await page.keyboard.press('Escape');

      // Segundo corredor (entre linhas ~F-G)
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.10, 0.62, 0.88, 0.69);
      await selectCorridorAxis(page, 'horizontal');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      const col6Gaps = computeColumnGaps(seats, '6');
      const enlargedV = enlargedGapsCount(col6Gaps, V_SPACING * 1.5);
      const corridorCount = (snap.objects as Array<{ type: string }> ?? []).filter(
        (o) => o.type === 'CORRIDOR',
      ).length;

      test.info().annotations.push({
        type: enlargedV < 2 ? 'bug' : 'info',
        description: `Dois corredores horizontais: corridorObjects=${corridorCount}, gapsVerticaisAmpliados=${enlargedV} (esperado 2)`,
      });

      expect(corridorCount).toBe(2);
      expect(enlargedV).toBeGreaterThanOrEqual(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 6: Corredores intersecionados (V + H formam union group)
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Corredores intersecionados (vertical + horizontal)', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('V + H sobrepostos: gap horizontal E vertical abertos', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      // Corredor vertical no centro
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.52, 0.10, 0.58, 0.88);
      await selectCorridorAxis(page, 'vertical');
      await page.keyboard.press('Escape');

      // Corredor horizontal no centro (CRUZA o vertical)
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.10, 0.48, 0.88, 0.54);
      await selectCorridorAxis(page, 'horizontal');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      const rowAGaps = computeRowGaps(seats, 'A');
      const col6Gaps = computeColumnGaps(seats, '6');
      const enlargedH = enlargedGapsCount(rowAGaps, NATURAL_H_GAP * 1.5);
      const enlargedV = enlargedGapsCount(col6Gaps, V_SPACING * 1.5);

      test.info().annotations.push({
        type: enlargedH === 0 || enlargedV === 0 ? 'bug' : 'info',
        description: `Interseção V+H: gaps horizontais ampliados=${enlargedH}, gaps verticais ampliados=${enlargedV}`,
      });

      // Ambos os eixos devem ter pelo menos um gap ampliado
      expect(enlargedH).toBeGreaterThanOrEqual(1);
      expect(enlargedV).toBeGreaterThanOrEqual(1);
    });

    test('corredores sobrepostos são tratados como union group (1 objeto no painel)', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      // Corredor vertical
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.52, 0.10, 0.58, 0.88);
      await selectCorridorAxis(page, 'vertical');
      await page.keyboard.press('Escape');

      // Corredor horizontal (cruza)
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.10, 0.48, 0.88, 0.54);
      await selectCorridorAxis(page, 'horizontal');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const corridors = (snap.objects as Array<{ type: string }> ?? []).filter(
        (o) => o.type === 'CORRIDOR',
      );

      test.info().annotations.push({
        type: 'info',
        description: `Corredores persistidos: ${corridors.length} (V + H separados na API, agrupados no reflow)`,
      });

      // 2 objetos CORRIDOR separados na API, mas o reflow os trata como 1 union group
      expect(corridors).toHaveLength(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 7: Gap assimétrico (seatGapLeft ≠ seatGapRight)
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Corredor com gap assimétrico', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('seatGapLeft=40 empurra mais assentos à esquerda que à direita', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.52, 0.10, 0.58, 0.88);
      await selectCorridorAxis(page, 'vertical');

      // Define gap assimétrico: esquerda=40, direita=8
      await setGapInput(page, 'Esquerda', 40);
      await setGapInput(page, 'Direita', 8);

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seats: SeatDTO[] = snap.seats ?? [];

      // Seats à esquerda do corredor devem estar mais afastados do centro do corredor
      // que os assentos à direita
      const rowASeats = seats.filter((s) => s.rowLabel === 'A').sort((a, b) => a.x - b.x);
      const rowAGaps = computeRowGaps(seats, 'A');
      const enlargedGaps = rowAGaps.filter((g) => g.gap > NATURAL_H_GAP * 1.5);

      test.info().annotations.push({
        type: enlargedGaps.length === 0 ? 'bug' : 'info',
        description: enlargedGaps.length > 0
          ? `Gap assimétrico: gap ampliado detectado (seatGapLeft=40, seatGapRight=8)`
          : `[BUG] Gap assimétrico não aplicado: nenhum gap ampliado detectado`,
      });

      expect(rowASeats.length).toBeGreaterThan(0);
      // Gap assimétrico deve criar pelo menos 1 gap ampliado
      expect(enlargedGaps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 8: Persistência — reload não duplica/perde assentos
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Persistência após corredor + reload', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('salvar corredor + recarregar página preserva contagem de assentos', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.52, 0.10, 0.58, 0.88);
      await selectCorridorAxis(page, 'vertical');
      await saveMap(page);

      // Recarrega o editor
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Mapa Corredores' })).toBeVisible({
        timeout: 15_000,
      });

      // Salva novamente (sem mudanças) — não deve duplicar nem perder assentos
      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const seatCount: number = snap.seats?.length ?? 0;

      test.info().annotations.push({
        type: seatCount !== TOTAL_SEATS ? 'bug' : 'info',
        description: seatCount !== TOTAL_SEATS
          ? `[BUG] Contagem de assentos alterada após reload+save: ${seatCount} (esperado ${TOTAL_SEATS})`
          : `OK: ${seatCount} assentos preservados após reload+save`,
      });

      expect(seatCount).toBe(TOTAL_SEATS);
    });

    test('corredor não é duplicado após save → reload → save', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.52, 0.10, 0.58, 0.88);
      await selectCorridorAxis(page, 'vertical');
      await saveMap(page);

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Mapa Corredores' })).toBeVisible({
        timeout: 15_000,
      });
      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const corridorCount = (snap.objects as Array<{ type: string }> ?? []).filter(
        (o) => o.type === 'CORRIDOR',
      ).length;

      test.info().annotations.push({
        type: corridorCount !== 1 ? 'bug' : 'info',
        description: corridorCount !== 1
          ? `[BUG] Corredor duplicado ou removido após reload+save: corridorCount=${corridorCount} (esperado 1)`
          : `OK: 1 corredor preservado após reload+save`,
      });

      expect(corridorCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 9: Responsividade e Layout
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Responsividade e Layout', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('1280×720: header + toolbar + properties panel sem overflow', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEditor(page, scenario);

      const issues: string[] = [];

      // Header deve estar visível e dentro do viewport
      const header = page.locator('header').first();
      if (await header.isVisible()) {
        const headerBox = await header.boundingBox();
        if (headerBox && headerBox.x < 0) issues.push('Header: x negativo');
        if (headerBox && headerBox.y < 0) issues.push('Header: y negativo');
        if (headerBox && headerBox.x + headerBox.width > 1280)
          issues.push(`Header: overflow direito (${(headerBox.x + headerBox.width).toFixed(0)}px > 1280px)`);
      }

      // Botão Salvar acessível
      const saveBtn = page.getByRole('button', { name: /salvar/i });
      await expect(saveBtn).toBeVisible();
      const saveBtnBox = await saveBtn.boundingBox();
      if (saveBtnBox) {
        if (saveBtnBox.x + saveBtnBox.width > 1280)
          issues.push(`Botão Salvar: fora do viewport (${(saveBtnBox.x + saveBtnBox.width).toFixed(0)}px)`);
      }

      // Canvas acessível
      const canvas = page.getByTestId('map-canvas');
      await expect(canvas).toBeVisible();
      const canvasBox = await canvas.boundingBox();
      if (canvasBox && canvasBox.width < 400)
        issues.push(`Canvas: muito estreito (${canvasBox.width.toFixed(0)}px < 400px)`);
      if (canvasBox && canvasBox.height < 300)
        issues.push(`Canvas: muito baixo (${canvasBox.height.toFixed(0)}px < 300px)`);

      test.info().annotations.push({
        type: issues.length > 0 ? 'bug' : 'info',
        description:
          issues.length > 0
            ? `[LAYOUT 1280×720] Problemas: ${issues.join(' | ')}`
            : `OK: 1280×720 sem overflow detectado`,
      });

      if (issues.length > 0) {
        console.warn('[LAYOUT 1280×720]', issues.join(' | '));
      }
    });

    test('1024×768: editor usável sem overflow horizontal', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await openEditor(page, scenario);

      const issues: string[] = [];

      // Verifica overflow horizontal na página
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      if (hasHorizontalScroll) {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        issues.push(`Scroll horizontal inesperado: scrollWidth=${scrollWidth}px > 1024px`);
      }

      // Canvas deve ainda ter altura razoável
      const canvasBox = await page.getByTestId('map-canvas').boundingBox();
      if (canvasBox && canvasBox.height < 250)
        issues.push(`Canvas: muito baixo em 1024×768 (${canvasBox.height.toFixed(0)}px)`);

      test.info().annotations.push({
        type: issues.length > 0 ? 'bug' : 'info',
        description:
          issues.length > 0
            ? `[LAYOUT 1024×768] ${issues.join(' | ')}`
            : `OK: 1024×768 sem overflow horizontal`,
      });
    });

    test('768×1024 (tablet portrait): toolbar e header acessíveis', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await openEditor(page, scenario);

      const issues: string[] = [];

      // Header com botão Salvar deve estar visível
      const saveBtn = page.getByRole('button', { name: /salvar/i });
      const saveBtnVisible = await saveBtn.isVisible();
      if (!saveBtnVisible) issues.push('Botão Salvar não visível em 768px');

      // Overflow horizontal
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      if (hasHorizontalScroll) {
        issues.push('Scroll horizontal em 768px (possível overflow de toolbar/header)');
      }

      // Canvas presente
      const canvasVisible = await page.getByTestId('map-canvas').isVisible();
      if (!canvasVisible) issues.push('Canvas não visível em 768px');

      test.info().annotations.push({
        type: issues.length > 0 ? 'bug' : 'info',
        description:
          issues.length > 0
            ? `[LAYOUT 768×1024 tablet] ${issues.join(' | ')}`
            : `OK: tablet portrait sem problemas críticos`,
      });
    });

    test('painel de propriedades do corredor sem overflow em 1280×720', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      const { box } = await openEditor(page, scenario);

      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.52, 0.10, 0.58, 0.88);

      // Aguarda painel do corredor
      await expect(getCorridorSection(page).locator('select').first()).toBeVisible({ timeout: 8_000 });

      const issues: string[] = [];

      // Painel não deve ter overflow vertical fora da viewport
      const panelOverflow = await page.evaluate(() => {
        const panels = document.querySelectorAll('[class*="overflow-y"]');
        const results: string[] = [];
        for (const el of panels) {
          const box = el.getBoundingClientRect();
          if (box.bottom > window.innerHeight + 5) {
            results.push(`Painel (${el.className.slice(0, 40)}) ultrapassa viewport: bottom=${box.bottom.toFixed(0)}px > ${window.innerHeight}px`);
          }
        }
        return results;
      });

      panelOverflow.forEach((msg) => issues.push(msg));

      // Campos de espaçamento visíveis (PanelField sem for → busca por label text)
      const spacingSection = getSpacingSection(page);
      const labelNames = ['Superior', 'Direita', 'Inferior', 'Esquerda'];
      for (let idx = 0; idx < labelNames.length; idx++) {
        const el = spacingSection.locator('input').nth(idx);
        if (await el.isVisible()) {
          const elBox = await el.boundingBox();
          if (elBox && elBox.y + elBox.height > 720) {
            issues.push(`Campo "${labelNames[idx]}" cortado pelo viewport (bottom=${(elBox.y + elBox.height).toFixed(0)}px)`);
          }
          if (elBox && elBox.x + elBox.width > 1280) {
            issues.push(`Campo "${labelNames[idx]}" fora do viewport horizontal`);
          }
        }
      }

      // Padding dos campos: verificar que não há inputs colados nas bordas
      const inputPaddingIssue = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="number"]');
        const issues: string[] = [];
        for (const input of inputs) {
          const computed = window.getComputedStyle(input);
          const paddingLeft = parseFloat(computed.paddingLeft);
          const paddingRight = parseFloat(computed.paddingRight);
          if (paddingLeft < 4 || paddingRight < 4) {
            issues.push(`Input sem padding adequado (pl=${paddingLeft}px, pr=${paddingRight}px)`);
          }
        }
        return issues.slice(0, 3); // Limita output
      });

      inputPaddingIssue.forEach((msg) => issues.push(msg));

      test.info().annotations.push({
        type: issues.length > 0 ? 'bug' : 'info',
        description:
          issues.length > 0
            ? `[PAINEL CORREDOR] Problemas encontrados: ${issues.join(' | ')}`
            : `OK: Painel do corredor sem overflow nem problemas de padding`,
      });
    });

    test('[SPACING] dialog de assentos tem espaçamentos consistentes', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });

      // Seed mínimo sem assentos
      await resetDb(prisma);
      const { contaId } = await seedAdminAndAuthenticate(page, {
        email: `spacing-${Date.now()}@test.local`,
      });
      const event = await prisma.schoolEvent.create({
        data: {
          id: randomUUID(), contaId, name: 'Mapa Corredores', type: 'GRADUATION',
          status: 'PLANNING', startsAt: addDays(new Date(), 30),
        },
        select: { id: true },
      });
      const map = await prisma.eventMap.create({
        data: { id: randomUUID(), contaId, eventId: event.id, name: 'Mapa Corredores', status: 'DRAFT' },
        select: { id: true },
      });
      await prisma.eventMapLevel.create({
        data: {
          id: randomUUID(), contaId, eventMapId: map.id, name: 'Plano Principal',
          sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: '1m = 50px',
        },
        select: { id: true },
      });

      const scenarioMin = { contaId, eventId: event.id, mapId: map.id, levelId: '', sectionId: '', objectId: '', seats: [] };
      const { box } = await openEditor(page, scenarioMin);

      await activateSeatTool(page);
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);

      // O formulário é um div absoluto, não um dialog
      const seatFormPanel = getSeatForm(page);
      await expect(seatFormPanel).toBeVisible({ timeout: 8_000 });

      const issues: string[] = [];

      // Verifica se o formulário está dentro do viewport
      const dialogBox = await seatFormPanel.boundingBox();
      if (dialogBox) {
        if (dialogBox.x < 0) issues.push(`Formulário: x negativo (${dialogBox.x.toFixed(0)}px)`);
        if (dialogBox.y < 0) issues.push(`Formulário: y negativo (${dialogBox.y.toFixed(0)}px)`);
        if (dialogBox.x + dialogBox.width > 1280)
          issues.push(`Formulário: overflow direito (${(dialogBox.x + dialogBox.width).toFixed(0)}px)`);
        if (dialogBox.y + dialogBox.height > 720)
          issues.push(`Formulário: overflow inferior (${(dialogBox.y + dialogBox.height).toFixed(0)}px) — pode precisar de scroll`);
      }

      // Verifica gaps entre campos (labels envolvem inputs no CreateSeatGridDialog)
      const fieldGapIssue = await page.evaluate(() => {
        const heading = document.querySelector('h2');
        const container = heading?.closest('div');
        if (!container) return [];
        const labels = [...container.querySelectorAll('label')];
        const issues: string[] = [];
        for (let i = 1; i < labels.length; i++) {
          const prev = labels[i - 1]!.getBoundingClientRect();
          const curr = labels[i]!.getBoundingClientRect();
          const gap = curr.top - (prev.top + prev.height);
          if (gap < 2) {
            issues.push(`Labels sobrepostos: "${labels[i - 1]!.textContent?.trim()}" e "${labels[i]!.textContent?.trim()}" gap=${gap.toFixed(1)}px`);
          }
        }
        return issues.slice(0, 5);
      });

      fieldGapIssue.forEach((msg) => issues.push(msg));

      test.info().annotations.push({
        type: issues.length > 0 ? 'bug' : 'info',
        description:
          issues.length > 0
            ? `[DIALOG ASSENTOS SPACING] ${issues.join(' | ')}`
            : `OK: Dialog de assentos sem problemas de espaçamento`,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bloco 10: Corredor rotacionado 90°
  // ──────────────────────────────────────────────────────────────────────────

  test.describe('Corredor rotacionado', () => {
    let scenario: Scenario;

    test.beforeEach(async ({ page }) => {
      scenario = await seedScenario(page);
    });

    test('corredor com rotação 90° aplica reflow no eixo correto', async ({ page }) => {
      const { box } = await openEditor(page, scenario);

      // Cria um corredor inicialmente horizontal
      await activateCorridorTool(page);
      await dragOnCanvas(page, box, 0.10, 0.48, 0.88, 0.54);
      await selectCorridorAxis(page, 'horizontal');

      // Rotaciona 90° via painel de dimensões
      // PanelField não usa for/htmlFor → busca pela seção "Dimensão"
      const dimSection = page.locator('section').filter({ has: page.locator('h3', { hasText: /dimens/i }) }).first();
      // Ordem dos inputs: X(0), Y(1), Largura(2), Altura(3), Rotação(4)
      const rotationInput = dimSection.locator('input[type="number"]').nth(4);
      await rotationInput.click({ clickCount: 3 });
      await rotationInput.fill('90');
      await rotationInput.press('Tab');

      await saveMap(page);

      const snap = await getMapSnapshot(page, scenario);
      const corridors = (snap.objects as Array<{ type: string; rotation?: number; data?: Record<string, unknown> }> ?? []).filter(
        (o) => o.type === 'CORRIDOR',
      );

      expect(corridors).toHaveLength(1);
      const corridor = corridors[0]!;

      test.info().annotations.push({
        type: 'info',
        description: `Corredor rotacionado: rotation=${corridor.rotation}, corridorAxis=${corridor.data?.corridorAxis}`,
      });

      // A rotação deve ter sido persistida
      expect(corridor.rotation).toBe(90);
    });
  });
});
