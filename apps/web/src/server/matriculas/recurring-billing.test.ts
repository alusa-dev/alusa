import { PeriodicidadePlano } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  formatIsoDate,
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
  resolveEnrollmentFeeDueDate,
} from './recurring-billing';

describe('mapPeriodicidadeToCycle', () => {
  it.each([
    [PeriodicidadePlano.SEMANAL, 'WEEKLY'],
    [PeriodicidadePlano.QUINZENAL, 'BIWEEKLY'],
    [PeriodicidadePlano.MENSAL, 'MONTHLY'],
    [PeriodicidadePlano.TRIMESTRAL, 'QUARTERLY'],
    [PeriodicidadePlano.ANUAL, 'YEARLY'],
  ] as const)('mapeia %s para o ciclo Asaas %s', (periodicidade, cycle) => {
    expect(mapPeriodicidadeToCycle(periodicidade)).toBe(cycle);
  });
});

describe('datas seguras para o Asaas', () => {
  const viradaManausBrasilia = new Date('2026-08-02T03:09:00.000Z');

  it('agenda a taxa no próximo dia do fuso do Asaas durante a virada Manaus/Brasília', () => {
    const dueDate = resolveEnrollmentFeeDueDate(
      new Date('2026-08-01T00:00:00.000Z'),
      viradaManausBrasilia,
    );

    expect(formatIsoDate(dueDate)).toBe('2026-08-03');
  });

  it('preserva uma data de início futura para a taxa', () => {
    const dueDate = resolveEnrollmentFeeDueDate(
      new Date('2026-08-10T00:00:00.000Z'),
      viradaManausBrasilia,
    );

    expect(formatIsoDate(dueDate)).toBe('2026-08-10');
  });

  it('calcula a primeira mensalidade usando o dia corrente do fuso do Asaas', () => {
    const dueDate = resolveChargeableFirstDueDate(
      new Date('2026-08-01T00:00:00.000Z'),
      2,
      viradaManausBrasilia,
    );

    expect(formatIsoDate(dueDate)).toBe('2026-08-02');
  });
});
