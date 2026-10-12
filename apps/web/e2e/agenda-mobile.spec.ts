import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays, setHours, setMinutes, setSeconds } from 'date-fns';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

test.describe('Agenda mobile', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('apresenta os eventos em lista acessível e acompanha a mudança de viewport', async ({ page }) => {
    await resetDb(prisma);
    const { contaId } = await seedAdminAndAuthenticate(page, {
      email: `admin-agenda-mobile-${Date.now()}@e2e.test`,
    });
    const sala = await prisma.sala.create({
      data: { contaId, nome: 'Sala agenda mobile E2E', capacidade: 20, status: 'ATIVO' },
    });
    const startAt = setSeconds(setMinutes(setHours(addDays(new Date(), 1), 14), 0), 0);
    const title = 'Aula acessível mobile E2E';
    const events = [
      { title, durationMinutes: 60 },
      { title: 'Aula curta acessível mobile E2E', durationMinutes: 15 },
      { title: 'Aula simultânea oculta E2E', durationMinutes: 60 },
    ];
    for (const event of events) {
      await prisma.calendarEvent.create({
        data: {
          contaId,
          tipo: 'AULA',
          status: 'AGENDADO',
          source: 'MANUAL',
          manuallyAdjusted: true,
          titulo: event.title,
          startAt,
          endAt: new Date(startAt.getTime() + event.durationMinutes * 60 * 1000),
          salaId: sala.id,
        },
      });
    }
    const longEventStartAt = setSeconds(setMinutes(setHours(addDays(new Date(), 1), 9), 0), 0);
    await prisma.calendarEvent.create({
      data: {
        contaId,
        tipo: 'AULA',
        status: 'AGENDADO',
        source: 'MANUAL',
        manuallyAdjusted: true,
        titulo: 'Aula longa com detalhes E2E',
        startAt: longEventStartAt,
        endAt: new Date(longEventStartAt.getTime() + 120 * 60 * 1000),
        salaId: sala.id,
      },
    });
    const completedEventStartAt = setSeconds(setMinutes(setHours(new Date(), 8), 0), 0);
    await prisma.calendarEvent.create({
      data: {
        contaId,
        tipo: 'AULA',
        status: 'REALIZADO',
        source: 'MANUAL',
        manuallyAdjusted: true,
        titulo: 'Aula concluída com status E2E',
        startAt: completedEventStartAt,
        endAt: new Date(completedEventStartAt.getTime() + 60 * 60 * 1000),
        salaId: sala.id,
      },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const agendaLoad = page.waitForResponse(
      (response) => response.url().includes('/api/aulas/agenda?') && response.status() === 200,
    );
    await page.goto('/lessons/schedule');
    await agendaLoad;

    const mobileList = page.getByTestId('agenda-mobile-list');
    await expect(mobileList).toBeVisible();
    await expect(mobileList).toHaveAttribute('data-agenda-view', 'week');
    const eventButton = page.getByRole('button', { name: new RegExp(title) });
    await expect(eventButton).toBeVisible();
    await expect(eventButton).toHaveAttribute('aria-label', /2 conflito\(s\)/);
    await expect(page.getByTestId('agenda-period-label')).not.toHaveCSS('text-overflow', 'ellipsis');
    const targetSize = await eventButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(targetSize.width).toBeGreaterThanOrEqual(24);
    expect(targetSize.height).toBeGreaterThanOrEqual(24);

    await page.getByRole('tab', { name: 'Dia' }).click();
    await expect(mobileList).toHaveAttribute('data-agenda-view', 'day');
    await page.getByRole('tab', { name: 'Semana' }).click();
    await expect(mobileList).toHaveAttribute('data-agenda-view', 'week');
    await page.getByRole('tab', { name: 'Mês' }).click();
    await expect(mobileList).toHaveAttribute('data-agenda-view', 'month-detailed');
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId('agenda-mobile-list')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('tab', { name: 'Dia' }).click();
    await expect(page.locator('.fc-timegrid')).toBeVisible();
    await page.getByRole('button', { name: 'Hoje' }).click();
    const completedEvent = page.locator('[data-testid="calendar-event-card"][data-event-title="Aula concluída com status E2E"]');
    await expect(completedEvent.getByTestId('calendar-event-status')).toHaveText('Realizado');
    const statusIsAboveTitle = await completedEvent.evaluate((card) => {
      const status = card.querySelector('[data-testid="calendar-event-status"]');
      const title = card.querySelector('[data-testid="calendar-event-title"]');
      return Boolean(status && title && status.getBoundingClientRect().bottom <= title.getBoundingClientRect().top);
    });
    expect(statusIsAboveTitle).toBe(true);
    const titleIsAboveTime = await completedEvent.evaluate((card) => {
      const title = card.querySelector('[data-testid="calendar-event-title"]');
      const time = card.querySelector('[data-testid="calendar-event-time"]');
      return Boolean(title && time && title.getBoundingClientRect().bottom <= time.getBoundingClientRect().top + 1);
    });
    expect(titleIsAboveTime).toBe(true);
    const timeIsAtBottomLeft = await completedEvent.evaluate((card) => {
      const time = card.querySelector('[data-testid="calendar-event-time"]');
      if (!time) return false;
      const cardRect = card.getBoundingClientRect();
      const timeRect = time.getBoundingClientRect();
      const bottomInset = cardRect.bottom - timeRect.bottom;
      return timeRect.left >= cardRect.left && bottomInset >= 6 && bottomInset <= 16;
    });
    expect(timeIsAtBottomLeft).toBe(true);
    const statusHasNoBox = await completedEvent.getByTestId('calendar-event-status').evaluate((status) => (
      getComputedStyle(status).backgroundColor === 'rgba(0, 0, 0, 0)'
    ));
    expect(statusHasNoBox).toBe(true);
    const completedCardHeight = await completedEvent.evaluate((card) => card.getBoundingClientRect().height);
    expect(completedCardHeight).toBeGreaterThanOrEqual(80);
    const timeGridSlotHeight = await page.locator('.fc-timegrid-slot[data-time]').first().evaluate((slot) => slot.getBoundingClientRect().height);
    expect(timeGridSlotHeight).toBeGreaterThanOrEqual(32);
    await expect(completedEvent.getByTestId('calendar-event-expand-icon')).toHaveCount(0);
    await page.getByRole('button', { name: 'Próximo período' }).click();
    const expandedEvent = page.locator('[data-testid="calendar-event-card"][data-event-title="Aula longa com detalhes E2E"]');
    await expect(expandedEvent.getByTestId('calendar-event-status')).toHaveText('Agendado');
    await expect(expandedEvent.getByTestId('calendar-event-title')).toHaveText('Aula longa com detalhes E2E');
    const scheduledStatusIsAboveTitle = await expandedEvent.evaluate((card) => {
      const status = card.querySelector('[data-testid="calendar-event-status"]');
      const title = card.querySelector('[data-testid="calendar-event-title"]');
      return Boolean(status && title && status.getBoundingClientRect().bottom <= title.getBoundingClientRect().top);
    });
    expect(scheduledStatusIsAboveTitle).toBe(true);
    await expect(expandedEvent.getByTestId('calendar-event-details-footer')).toContainText('Sala agenda mobile E2E');
    await expect(expandedEvent.getByTestId('calendar-event-expand-icon')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Semana' }).click();
    await expect(page.locator('[data-testid="calendar-event-card"][data-event-title="' + title + '"]')).toBeVisible();
    await expect(page.locator('[data-testid="calendar-event-card"][data-event-title="' + title + '"]')).toContainText('Aula acessível');
    await expect(page.locator('[data-testid="calendar-event-card"][data-event-title="' + title + '"] [data-testid="calendar-event-title"]')).toHaveCSS('display', 'block');
    const more = page.locator('.fc-timegrid-more-link').first();
    await expect(more).toBeVisible();
    await more.click();
    const shortEventCard = page.locator('[data-testid="calendar-event-card"][data-event-title="Aula curta acessível mobile E2E"]');
    await expect(shortEventCard).toBeVisible();
    await expect(shortEventCard).toHaveAttribute('aria-label', /2 conflito\(s\)/);
    const hiddenEventCard = page.locator('[data-testid="calendar-event-card"][data-event-title="Aula simultânea oculta E2E"]');
    await expect(hiddenEventCard).toBeVisible();
    await expect(hiddenEventCard).toHaveAttribute('aria-label', /2 conflito\(s\)/);
  });
});
