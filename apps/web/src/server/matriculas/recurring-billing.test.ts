import { PeriodicidadePlano } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mapPeriodicidadeToCycle } from './recurring-billing';

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
