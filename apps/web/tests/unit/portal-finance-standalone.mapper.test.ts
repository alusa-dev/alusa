import { describe, expect, it } from 'vitest';

import { mapChargeStatusToPortalStatus, isPortalPendingStatus } from '@/features/portal/finance-standalone';

describe('portal finance standalone mapper', () => {
  it('mapeia status finais corretamente', () => {
    expect(mapChargeStatusToPortalStatus('PAID')).toBe('PAGO');
    expect(mapChargeStatusToPortalStatus('CANCELED')).toBe('CANCELADO');
    expect(mapChargeStatusToPortalStatus('REFUNDED')).toBe('ESTORNADO');
    expect(mapChargeStatusToPortalStatus('OVERDUE')).toBe('ATRASADO');
  });

  it('mapeia OPEN/CREATED para ATRASADO quando vencimento no passado', () => {
    const pastDueDate = new Date();
    pastDueDate.setDate(pastDueDate.getDate() - 2);

    expect(mapChargeStatusToPortalStatus('OPEN', pastDueDate)).toBe('ATRASADO');
    expect(mapChargeStatusToPortalStatus('CREATED', pastDueDate)).toBe('ATRASADO');
  });

  it('mapeia OPEN/CREATED para PENDENTE quando vencimento no futuro', () => {
    const futureDueDate = new Date();
    futureDueDate.setDate(futureDueDate.getDate() + 2);

    expect(mapChargeStatusToPortalStatus('OPEN', futureDueDate)).toBe('PENDENTE');
    expect(mapChargeStatusToPortalStatus('CREATED', futureDueDate)).toBe('PENDENTE');
  });

  it('classifica pendência para notificações do portal', () => {
    expect(isPortalPendingStatus('PENDENTE')).toBe(true);
    expect(isPortalPendingStatus('ATRASADO')).toBe(true);
    expect(isPortalPendingStatus('PAGO')).toBe(false);
    expect(isPortalPendingStatus('CANCELADO')).toBe(false);
    expect(isPortalPendingStatus('ESTORNADO')).toBe(false);
  });
});
