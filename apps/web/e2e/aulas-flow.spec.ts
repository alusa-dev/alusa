import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays, format, setHours, setMinutes } from 'date-fns';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function selectOption(
  page: import('@playwright/test').Page,
  triggerTestId: string,
  label: string,
) {
  await page.getByTestId(triggerTestId).click();
  const option = page
    .locator('[role="option"], [data-radix-collection-item]')
    .filter({ hasText: label })
    .first();
  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();
}

function toDateTimeLocal(date: Date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

async function seedAulasScenario(page: import('@playwright/test').Page) {
  await resetDb(prisma);

  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `admin-aulas-${Date.now()}@e2e.test`,
  });

  const modalidade = await prisma.modalidade.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Modalidade Aulas E2E',
      status: 'ATIVO',
    },
  });

  const sala = await prisma.sala.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Sala Aulas E2E',
      capacidade: 20,
      status: 'ATIVO',
    },
  });

  const professor = await prisma.professor.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Professor Aulas E2E',
      cpf: String(Date.now()).slice(-11).padStart(11, '0'),
      email: `prof-aulas-${Date.now()}@e2e.test`,
      telefoneCel: '11999999999',
      dataNasc: new Date('1990-01-01T00:00:00.000Z'),
      status: 'ATIVO',
    },
  });

  const plano = await prisma.plano.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Plano Aulas E2E',
      valor: 150,
      periodicidade: 'MENSAL',
      status: 'ATIVO',
    },
  });

  const turma = await prisma.turma.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Turma Aulas E2E',
      modalidadeId: modalidade.id,
      salaId: sala.id,
      capacidade: 12,
      status: 'ATIVO',
      diasSemana: ['SEGUNDA', 'QUARTA'],
      horaInicio: '10:00',
      horaFim: '11:00',
      professores: {
        create: {
          professorId: professor.id,
        },
      },
    },
  });

  const aluno = await prisma.aluno.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Aluno Aulas E2E',
      cpf: String(Date.now() + 1).slice(-11).padStart(11, '0'),
      dataNasc: new Date('2012-05-01T00:00:00.000Z'),
      status: 'ATIVO',
    },
  });

  const dataInicio = addDays(new Date(), -30);
  const dataFimContrato = addDays(new Date(), 180);

  const matricula = await prisma.matricula.create({
    data: {
      id: randomUUID(),
      alunoId: aluno.id,
      planoId: plano.id,
      turmaId: turma.id,
      responsavelFinanceiroId: null,
      dataInicio,
      dataFimContrato,
      status: 'ATIVA',
      statusFinanceiro: 'ADIMPLENTE',
      statusContrato: 'ATIVO',
      vencimentoDia: 5,
      taxaMatricula: 0,
      taxaIsenta: true,
      taxaStatus: 'ISENTO',
    },
  });

  const originStart = setMinutes(setHours(addDays(new Date(), 1), 15), 0);
  const originEnd = setMinutes(setHours(addDays(new Date(), 1), 16), 0);
  const destinationStart = setMinutes(setHours(addDays(new Date(), 2), 15), 0);
  const destinationEnd = setMinutes(setHours(addDays(new Date(), 2), 16), 0);

  const origemEvento = await prisma.calendarEvent.create({
    data: {
      contaId,
      tipo: 'AULA',
      status: 'AGENDADO',
      source: 'MANUAL',
      manuallyAdjusted: true,
      titulo: 'Origem Reposição E2E',
      startAt: originStart,
      endAt: originEnd,
      turmaId: turma.id,
      salaId: sala.id,
      professores: {
        create: {
          professorId: professor.id,
        },
      },
    },
  });

  const destinoEvento = await prisma.calendarEvent.create({
    data: {
      contaId,
      tipo: 'AULA',
      status: 'AGENDADO',
      source: 'MANUAL',
      manuallyAdjusted: true,
      titulo: 'Destino Reposição E2E',
      startAt: destinationStart,
      endAt: destinationEnd,
      turmaId: turma.id,
      salaId: sala.id,
      professores: {
        create: {
          professorId: professor.id,
        },
      },
    },
  });

  return {
    contaId,
    turma,
    aluno,
    matricula,
    origemEvento,
    destinoEvento,
    agendaEventStart: originStart,
    agendaEventEnd: originEnd,
  };
}

test.describe('Aulas', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('cria evento na agenda, registra frequência e sincroniza a janela', async ({ page }) => {
    const data = await seedAulasScenario(page);
    const eventTitle = `Evento Agenda ${Date.now()}`;
    const start = setMinutes(setHours(new Date(), 12), 0);
    const end = setMinutes(setHours(new Date(), 13), 0);
    const initialAgendaLoad = page.waitForResponse(
      (response) =>
        response.url().includes('/api/aulas/agenda?') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
    );

    await page.goto('/aulas/agenda');
    await initialAgendaLoad;
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
    await expect(page.getByTestId('agenda-new-event')).toBeEnabled({ timeout: 15000 });

    await page.getByTestId('agenda-new-event').click();
    await page.getByTestId('agenda-event-title').fill(eventTitle);
    await selectOption(page, 'agenda-event-turma', data.turma.nome);
    await page.getByTestId('agenda-event-start').fill(toDateTimeLocal(start));
    await page.getByTestId('agenda-event-end').fill(toDateTimeLocal(end));
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/aulas/agenda') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
    );
    await page.getByTestId('agenda-event-submit').click();
    await createResponse;
    await expect(page.getByTestId('agenda-event-submit')).toHaveCount(0);

    const createdEventCard = page.locator(`[data-testid="calendar-event-card"][data-event-title="${eventTitle}"]`).first();
    await expect(createdEventCard).toBeVisible({ timeout: 15000 });
    await createdEventCard.click();
    await page.getByTestId('agenda-event-go-attendance').click();
    await page.getByTestId(`attendance-status-${data.aluno.id}-PRESENTE`).click();
    await page.getByTestId('attendance-save').click();
    await expect(page.getByTestId('attendance-save')).toHaveCount(0);

    await expect(createdEventCard).toBeVisible({ timeout: 15000 });
    await createdEventCard.click();
    await expect(page.getByText('REALIZADO')).toBeVisible({ timeout: 10000 });

    await page.goto('/aulas/frequencia');
    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page.getByText(data.turma.nome)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: new RegExp(data.turma.nome) }).first().click();
    await expect(page.getByText(eventTitle)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Visualizar' }).first().click();
    await expect(page.getByText(data.aluno.nome)).toBeVisible({ timeout: 15000 });
  });

  test('cria reposição com evento destino existente e permite concluir o fluxo', async ({ page }) => {
    const data = await seedAulasScenario(page);
    const initialMakeupLoad = page.waitForResponse(
      (response) =>
        response.url().includes('/api/aulas/reposicoes') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
    );

    await page.goto('/aulas/reposicoes');
    await initialMakeupLoad;
    await expect(page.getByRole('heading', { name: 'Reposições', exact: true })).toBeVisible();
    await expect(page.getByTestId('makeup-create-open')).toBeEnabled({ timeout: 15000 });

    await page.getByTestId('makeup-create-open').click();
    await selectOption(page, 'makeup-scope', 'Individual');
    await selectOption(page, 'makeup-aluno', data.aluno.nome);
    await selectOption(page, 'makeup-destination-mode', 'Usar evento já existente');
    await selectOption(page, 'makeup-evento-origem', data.origemEvento.titulo);
    await selectOption(page, 'makeup-turma-origem', data.turma.nome);
    await selectOption(page, 'makeup-turma-destino', data.turma.nome);
    await selectOption(page, 'makeup-evento-destino', data.destinoEvento.titulo);
    const createMakeupResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/aulas/reposicoes') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
    );
    await page.getByTestId('makeup-submit').click();
    await createMakeupResponse;
    await expect(page.getByTestId('makeup-submit')).toHaveCount(0);

    const createdMakeupRow = page.locator(`[data-testid="makeup-row"][data-origin-title="${data.origemEvento.titulo}"]`).first();
    await expect(createdMakeupRow).toBeVisible({ timeout: 15000 });
    await createdMakeupRow.click();
    await page.getByTestId('makeup-mark-realizada').click();
    await expect(page.getByText('REALIZADA')).toBeVisible({ timeout: 10000 });
  });
});
