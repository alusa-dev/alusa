import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

test('event reports list opens an event-specific, explanatory report', async ({ page }) => {
  await resetDb(prisma);
  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `event-report-${Date.now()}@e2e.test`,
  });
  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId,
      name: 'Mostra de Dança E2E',
      type: 'PRESENTATION',
      status: 'ACTIVE',
      startsAt: new Date('2026-10-20T19:00:00.000Z'),
      locationName: 'Teatro E2E',
      estimatedCapacity: 500,
    },
  });

  await page.goto('/events/reports');
  await expect(page.getByRole('table', { name: 'Eventos disponíveis para relatório' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Evento', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eventos disponíveis' })).toBeVisible();
  await expect(page.getByPlaceholder('Buscar por nome ou local')).toBeVisible();
  await expect(page.getByText('Todos os status')).toBeVisible();
  await expect(page.getByText('Todos os tipos')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Indicadores principais' })).toHaveCount(0);
  await page.getByPlaceholder('Buscar por nome ou local').fill('Mostra');
  const eventLink = page.getByRole('link', { name: /Mostra de Dança E2E/ });
  await expect(eventLink).toHaveAttribute('href', `/events/reports/${event.id}`);
  await eventLink.click();

  await expect(page).toHaveURL(new RegExp(`/events/reports/${event.id}$`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Como estão as inscrições dos alunos?', exact: true })).toBeVisible();
  const occupancyPercentage = page.getByRole('button', { name: 'Ocupação: 0%', exact: true });
  await expect(occupancyPercentage).toBeVisible();
  await occupancyPercentage.hover();
  await expect(page.getByRole('tooltip').getByText('Ocupação calculada dividindo as inscrições ativas pela capacidade estimada.')).toBeVisible();
  const capacityValue = page.getByText('500 participantes', { exact: true });
  await expect(capacityValue).toBeVisible();
  await expect(capacityValue.locator('xpath=..')).toHaveJSProperty('tagName', 'STRONG');
  await expect(page.getByText('A capacidade estimada é de', { exact: false })).toContainText('a ocupação é calculada com base nessas inscrições.');
  await capacityValue.hover();
  await expect(page.getByRole('tooltip').getByText('Capacidade estimada do evento, usada como base para calcular a ocupação.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Receitas e resultado', exact: true })).toBeVisible();
  await expect(page.getByText(/^Em andamento ·/)).toBeVisible();
  await expect(page.getByText(/Os valores previstos consideram inscrições ativas/)).toBeVisible();
  await expect(page.getByText('No total', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Bilheteria e ingressos', exact: true })).toBeVisible();
  await expect(page.getByText('Restam 0 ingressos disponíveis.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recebimentos por forma de pagamento', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Check-ins registrados', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Indicadores principais' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Relatórios de eventos' })).toBeVisible();

  for (const [status, label] of [['DRAFT', 'Rascunho'], ['PLANNING', 'Em planejamento']] as const) {
    await prisma.schoolEvent.update({ where: { id: event.id }, data: { status } });
    await page.reload();
    await expect(page.getByText(new RegExp(`^${label} ·`))).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Como estão as inscrições dos alunos?', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ingressos e lotes planejados', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ingressos registrados no planejamento', exact: true })).toBeVisible();
    await expect(page.getByText(/ingressos disponíveis|Restam .* disponíveis/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recebimentos por forma de pagamento', exact: true })).toHaveCount(0);
  }

  for (const [status, label] of [['FINISHED', 'Finalizado'], ['ARCHIVED', 'Arquivado']] as const) {
    await prisma.schoolEvent.update({ where: { id: event.id }, data: { status } });
    await page.reload();
    await expect(page.getByText(new RegExp(`^${label} ·`))).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ingressos registrados', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Como ficaram as inscrições dos alunos?', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Como as receitas foram pagas?', exact: true })).toBeVisible();
    await expect(page.getByText(/ingressos disponíveis|Restam .* disponíveis/i)).toHaveCount(0);
  }

  await prisma.schoolEvent.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
  await page.reload();
  await expect(page.getByText(/^Cancelado ·/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ingressos do evento cancelado', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Como ficaram as inscrições dos alunos?', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Como as receitas foram pagas?', exact: true })).toBeVisible();
  await expect(page.getByText(/ingressos disponíveis|Restam .* disponíveis/i)).toHaveCount(0);

  await page.getByRole('link', { name: 'Relatórios de eventos' }).click();
  await expect(page).toHaveURL(/\/events\/reports$/,{ timeout: 15_000 });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
