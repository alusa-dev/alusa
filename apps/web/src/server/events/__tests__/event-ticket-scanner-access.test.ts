import { afterEach, describe, expect, it, vi } from 'vitest';

const { recordEventAuditMock } = vi.hoisted(() => ({ recordEventAuditMock: vi.fn() }));

vi.mock('@alusa/lib/events/events.service', () => ({
  recordEventAudit: recordEventAuditMock,
  EventsError: class EventsError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

import {
  createEventTicketScannerAccess,
  deleteEventTicketScannerAccess,
  findPublicEventTicketScannerAccess,
} from '../event-ticket-scanner-access';

describe('event ticket scanner access persistence', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('stores no bearer token and audits the operator and gate when creating access', async () => {
    vi.stubEnv('EVENT_TICKET_SCANNER_SECRET', 'scanner-secret-that-is-at-least-32-bytes-long');
    const tx = {
      schoolEvent: { findFirst: vi.fn().mockResolvedValue({ id: 'event-a', status: 'ACTIVE', hasTickets: true }) },
      eventTicketScannerAccess: { create: vi.fn().mockResolvedValue({
        id: 'access-a', operatorName: 'Pessoa Externa', gateName: 'Portaria Leste', createdAt: new Date('2026-10-22T12:00:00Z'),
      }) },
    };

    const result = await createEventTicketScannerAccess(tx as never, {
      contaId: 'conta-a', eventId: 'event-a', actorUserId: 'user-a', operatorName: 'Pessoa Externa', gateName: 'Portaria Leste',
    });

    expect(tx.eventTicketScannerAccess.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contaId: 'conta-a', eventId: 'event-a', operatorName: 'Pessoa Externa', gateName: 'Portaria Leste' }),
    }));
    expect(tx.eventTicketScannerAccess.create.mock.calls[0]?.[0]).not.toHaveProperty('data.token');
    expect(result.token).toEqual(expect.any(String));
    expect(recordEventAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'events.ticket_scanner_access.created',
      after: { operatorName: 'Pessoa Externa', gateName: 'Portaria Leste' },
    }));
  });

  it('hard deletes only a tenant and event scoped access after recording retained audit details', async () => {
    const tx = {
      eventTicketScannerAccess: {
        findFirst: vi.fn().mockResolvedValue({ id: 'access-a', operatorName: 'Pessoa Externa', gateName: 'Portaria Leste', createdByUserId: 'user-created' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(deleteEventTicketScannerAccess(tx as never, {
      contaId: 'conta-a', eventId: 'event-a', accessId: 'access-a', actorUserId: 'user-admin',
    })).resolves.toEqual({ success: true });

    expect(tx.eventTicketScannerAccess.findFirst).toHaveBeenCalledWith({
      where: { id: 'access-a', contaId: 'conta-a', eventId: 'event-a' },
      select: { id: true, operatorName: true, gateName: true, createdByUserId: true },
    });
    expect(recordEventAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'events.ticket_scanner_access.deleted',
      before: { operatorName: 'Pessoa Externa', gateName: 'Portaria Leste', createdByUserId: 'user-created' },
    }));
    expect(tx.eventTicketScannerAccess.deleteMany).toHaveBeenCalledWith({
      where: { id: 'access-a', contaId: 'conta-a', eventId: 'event-a' },
    });
  });

  it('refuses a capability if its access relation points to another tenant event', async () => {
    const tx = {
      eventTicketScannerAccess: { findFirst: vi.fn().mockResolvedValue({
        id: 'access-a', contaId: 'conta-a', eventId: 'event-a', operatorName: 'Pessoa Externa', gateName: 'Portaria Leste',
        event: { id: 'event-a', contaId: 'conta-b', status: 'ACTIVE', name: 'Evento B' },
      }) },
    };

    await expect(findPublicEventTicketScannerAccess(tx as never, { version: 1, accessId: 'access-a', contaId: 'conta-a' }))
      .rejects.toMatchObject({ code: 'ACESSO_NAO_ENCONTRADO', status: 404 });
  });
});
