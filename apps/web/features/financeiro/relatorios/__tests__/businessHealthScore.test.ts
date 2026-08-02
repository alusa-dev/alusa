import { describe, expect, it } from 'vitest';

import type { FinancialMetricSummary } from '../dtos';
import { businessScoreColor, calculateBusinessHealthScore } from '../utils/businessHealthScore';

const summary: FinancialMetricSummary = {
  totalCharges: 1000,
  received: 900,
  receivable: 50,
  overdue: 50,
  processing: 0,
  fees: 10,
  refunds: 0,
  net: 890,
  toSettle: 0,
  available: 890,
  averageTicket: 180,
  delinquencyRate: 5,
  chargeCount: 6,
  receivedCount: 5,
  overdueCount: 1,
};

describe('calculateBusinessHealthScore', () => {
  it('combina pagamentos, ocupação, permanência e eficiência', () => {
    const result = calculateBusinessHealthScore({
      summary,
      classOccupancy: [{ id: 'a', name: 'A', capacity: 20, occupiedSeats: 16, occupancyRate: 80 }],
      enrollmentHealth: {
        activeEnrollments: 20,
        enrollmentsInPeriod: 2,
        cancellationsInPeriod: 1,
        openingActiveEnrollments: 19,
        retentionRate: 94.7,
      },
    });

    expect(result.level).toBe('healthy');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.coverage).toBe(100);
  });

  it('impede que eficiência alta esconda inadimplência grave', () => {
    const result = calculateBusinessHealthScore({
      summary: { ...summary, received: 700, overdue: 300, net: 699, delinquencyRate: 30 },
      classOccupancy: [{ id: 'a', name: 'A', capacity: 20, occupiedSeats: 20, occupancyRate: 100 }],
      enrollmentHealth: {
        activeEnrollments: 20,
        enrollmentsInPeriod: 0,
        cancellationsInPeriod: 0,
        openingActiveEnrollments: 20,
        retentionRate: 100,
      },
    });

    expect(result.level).toBe('critical');
    expect(result.score).toBeLessThanOrEqual(39);
  });

  it('redistribui pesos quando não há amostra de ocupação ou permanência', () => {
    const result = calculateBusinessHealthScore({
      summary,
      classOccupancy: [],
      enrollmentHealth: {
        activeEnrollments: 0,
        enrollmentsInPeriod: 0,
        cancellationsInPeriod: 0,
        openingActiveEnrollments: 0,
        retentionRate: null,
      },
    });

    expect(result.score).not.toBeNull();
    expect(result.coverage).toBe(55);
  });

  it('posiciona o degradê em faixas absolutas de risco', () => {
    expect(businessScoreColor(20)).toContain('hsl(');
    expect(businessScoreColor(20)).not.toBe(businessScoreColor(69));
    expect(businessScoreColor(69)).not.toBe(businessScoreColor(90));
  });
});
