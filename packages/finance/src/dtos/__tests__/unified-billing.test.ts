import { describe, it, expect } from 'vitest';

import {
  normalizeCobrancaStatus,
  normalizeChargeStatus,
  isOperationalStatus,
  isWithinOperationalScope,
  getEndOfCurrentMonth,
  filterOperationalItems,
  getUnifiedStatusBadge,
  OPERATIONAL_STATUSES,
  TERMINAL_STATUSES,
} from '../unified-billing';

import type { UnifiedChargeStatus } from '../charge-list-item.dto';

// ---------------------------------------------------------------------------
// normalizeCobrancaStatus
// ---------------------------------------------------------------------------
describe('normalizeCobrancaStatus', () => {
  it.each<[string, UnifiedChargeStatus]>([
    ['A_VENCER', 'PENDING'],
    ['PENDENTE', 'PENDING'],
    ['PROCESSANDO', 'PROCESSING'],
    ['PAGO', 'PAID'],
    ['ATRASADO', 'OVERDUE'],
    ['CANCELAMENTO_PENDENTE', 'CANCELED'],
    ['CANCELADO', 'CANCELED'],
    ['ESTORNADO', 'REFUNDED'],
    ['ESTORNADO_PARCIAL', 'REFUNDED'],
  ])('mapeia %s → %s', (input, expected) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeCobrancaStatus(input as any)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// normalizeChargeStatus
// ---------------------------------------------------------------------------
describe('normalizeChargeStatus', () => {
  it.each<[string, UnifiedChargeStatus]>([
    ['CREATED', 'PENDING'],
    ['OPEN', 'PENDING'],
    ['PAID', 'PAID'],
    ['OVERDUE', 'OVERDUE'],
    ['CANCELED', 'CANCELED'],
    ['REFUNDED', 'REFUNDED'],
  ])('mapeia %s → %s', (input, expected) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeChargeStatus(input as any)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isOperationalStatus
// ---------------------------------------------------------------------------
describe('isOperationalStatus', () => {
  it('retorna true para PENDING e OVERDUE', () => {
    expect(isOperationalStatus('PENDING')).toBe(true);
    expect(isOperationalStatus('OVERDUE')).toBe(true);
  });

  it('retorna false para status terminais', () => {
    expect(isOperationalStatus('PAID')).toBe(false);
    expect(isOperationalStatus('CANCELED')).toBe(false);
    expect(isOperationalStatus('REFUNDED')).toBe(false);
    expect(isOperationalStatus('PROCESSING')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEndOfCurrentMonth
// ---------------------------------------------------------------------------
describe('getEndOfCurrentMonth', () => {
  it('retorna último instante do mês para janeiro', () => {
    const jan15 = new Date(2025, 0, 15);
    const end = getEndOfCurrentMonth(jan15);
    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(31);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('retorna último instante do mês para fevereiro (não bissexto)', () => {
    const feb10 = new Date(2025, 1, 10);
    const end = getEndOfCurrentMonth(feb10);
    expect(end.getDate()).toBe(28);
  });

  it('retorna último instante do mês para fevereiro (bissexto)', () => {
    const feb10 = new Date(2024, 1, 10);
    const end = getEndOfCurrentMonth(feb10);
    expect(end.getDate()).toBe(29);
  });
});

// ---------------------------------------------------------------------------
// isWithinOperationalScope
// ---------------------------------------------------------------------------
describe('isWithinOperationalScope', () => {
  const now = new Date(2025, 5, 15); // 15 de junho 2025

  it('inclui vencimento no mesmo mês', () => {
    expect(isWithinOperationalScope('2025-06-20', now)).toBe(true);
  });

  it('inclui vencimento no passado (vencida)', () => {
    expect(isWithinOperationalScope('2025-05-01', now)).toBe(true);
  });

  it('inclui último dia do mês', () => {
    expect(isWithinOperationalScope('2025-06-30', now)).toBe(true);
  });

  it('exclui vencimento no mês seguinte', () => {
    expect(isWithinOperationalScope('2025-07-01', now)).toBe(false);
  });

  it('exclui vencimento em mês futuro', () => {
    expect(isWithinOperationalScope('2025-12-01', now)).toBe(false);
  });

  it('inclui item sem vencimento', () => {
    expect(isWithinOperationalScope(null, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterOperationalItems
// ---------------------------------------------------------------------------
describe('filterOperationalItems', () => {
  const now = new Date(2025, 5, 15); // junho

  const items = [
    { id: '1', status: 'PENDING' as const, dueDate: '2025-06-20' },
    { id: '2', status: 'OVERDUE' as const, dueDate: '2025-05-10' },
    { id: '3', status: 'PAID' as const, dueDate: '2025-06-10' },
    { id: '4', status: 'PENDING' as const, dueDate: '2025-07-15' },
    { id: '5', status: 'CANCELED' as const, dueDate: '2025-06-01' },
    { id: '6', status: 'OVERDUE' as const, dueDate: '2025-06-30' },
    { id: '7', status: 'PENDING' as const, dueDate: null },
  ];

  it('inclui apenas itens pendentes/vencidos até fim do mês', () => {
    const result = filterOperationalItems(items, now);
    const ids = result.map((i) => i.id);

    expect(ids).toContain('1'); // PENDING, junho
    expect(ids).toContain('2'); // OVERDUE, maio (vencida)
    expect(ids).toContain('6'); // OVERDUE, fim de junho
    expect(ids).toContain('7'); // PENDING, sem vencimento
  });

  it('exclui pagos, cancelados e futuros', () => {
    const result = filterOperationalItems(items, now);
    const ids = result.map((i) => i.id);

    expect(ids).not.toContain('3'); // PAID
    expect(ids).not.toContain('4'); // PENDING mas julho (futuro)
    expect(ids).not.toContain('5'); // CANCELED
  });

  it('retorna exatamente 4 itens', () => {
    const result = filterOperationalItems(items, now);
    expect(result).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// getUnifiedStatusBadge
// ---------------------------------------------------------------------------
describe('getUnifiedStatusBadge', () => {
  it('retorna badge correto para cada status', () => {
    expect(getUnifiedStatusBadge('PENDING')).toEqual({
      status: 'PENDING',
      label: 'Pendente',
      variant: 'warning',
    });

    expect(getUnifiedStatusBadge('PAID')).toEqual({
      status: 'PAID',
      label: 'Pago',
      variant: 'success',
    });

    expect(getUnifiedStatusBadge('OVERDUE')).toEqual({
      status: 'OVERDUE',
      label: 'Vencido',
      variant: 'danger',
    });
  });
});

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
describe('constantes de status', () => {
  it('OPERATIONAL_STATUSES contém PENDING e OVERDUE', () => {
    expect(OPERATIONAL_STATUSES).toContain('PENDING');
    expect(OPERATIONAL_STATUSES).toContain('OVERDUE');
    expect(OPERATIONAL_STATUSES).toHaveLength(2);
  });

  it('TERMINAL_STATUSES contém PAID, CANCELED, REFUNDED', () => {
    expect(TERMINAL_STATUSES).toContain('PAID');
    expect(TERMINAL_STATUSES).toContain('CANCELED');
    expect(TERMINAL_STATUSES).toContain('REFUNDED');
    expect(TERMINAL_STATUSES).toHaveLength(3);
  });

  it('não há sobreposição entre operacional e terminal', () => {
    const overlap = OPERATIONAL_STATUSES.filter((s) =>
      (TERMINAL_STATUSES as readonly string[]).includes(s),
    );
    expect(overlap).toHaveLength(0);
  });
});
