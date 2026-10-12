/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  drainContractWhatsAppNotifications,
  drainWhatsAppOutbox,
  drainWhatsAppWebhooks,
  drainEventTicketWhatsAppNotifications,
  resolveTenantScope,
} = vi.hoisted(() => ({
  drainContractWhatsAppNotifications: vi.fn(),
  drainWhatsAppOutbox: vi.fn(),
  drainWhatsAppWebhooks: vi.fn(),
  drainEventTicketWhatsAppNotifications: vi.fn(),
  resolveTenantScope: vi.fn(),
}));

vi.mock('@/src/server/whatsapp/outbox.service', () => ({
  drainContractWhatsAppNotifications,
  drainWhatsAppOutbox,
  drainWhatsAppWebhooks,
}));
vi.mock('@/src/server/events/event-ticket-whatsapp-outbox.service', () => ({ drainEventTicketWhatsAppNotifications }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET } from '../route';

const emptyContract = { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 };
const emptyOutbox = { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
const emptyWebhooks = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };
const emptyTicket = { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0, paused: false };

describe('GET /api/jobs/whatsapp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    drainContractWhatsAppNotifications.mockResolvedValue(emptyContract);
    drainWhatsAppOutbox.mockResolvedValue(emptyOutbox);
    drainWhatsAppWebhooks.mockResolvedValue(emptyWebhooks);
    drainEventTicketWhatsAppNotifications.mockResolvedValue(emptyTicket);
  });

  it('trata a execução sem trabalho como saudável e limita os lotes', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/whatsapp?contractLimit=999&outboxLimit=0&webhookLimit=abc'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, outcome: 'completed' });
    expect(drainContractWhatsAppNotifications).toHaveBeenCalledWith({ contaId: undefined, limit: 200 });
    expect(drainWhatsAppOutbox).toHaveBeenCalledWith({ limit: 1 });
    expect(drainWhatsAppWebhooks).toHaveBeenCalledWith({ limit: 100 });
    expect(drainEventTicketWhatsAppNotifications).toHaveBeenCalledWith({ contaId: undefined, limit: 50 });
  });

  it('permite cron drenar filas globais e tenant-scoped', async () => {
    await GET(new Request('http://localhost/api/jobs/whatsapp'));
    expect(drainWhatsAppWebhooks).toHaveBeenCalled();
    expect(drainWhatsAppOutbox).toHaveBeenCalled();
    expect(drainContractWhatsAppNotifications).toHaveBeenCalledWith(expect.objectContaining({ contaId: undefined }));
    expect(drainEventTicketWhatsAppNotifications).toHaveBeenCalledWith({ limit: 50 });
  });

  it('limita execução manual às filas tenant-scoped e não chama drains globais', async () => {
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: 'conta-admin', isCron: false, isAdmin: true });
    await GET(new Request('http://localhost/api/jobs/whatsapp'));
    expect(drainWhatsAppWebhooks).not.toHaveBeenCalled();
    expect(drainWhatsAppOutbox).not.toHaveBeenCalled();
    expect(drainContractWhatsAppNotifications).toHaveBeenCalledWith({ contaId: 'conta-admin', limit: 50 });
    expect(drainEventTicketWhatsAppNotifications).toHaveBeenCalledWith({ contaId: 'conta-admin', limit: 50 });
  });

  it('sinaliza retry ou DLQ como falha parcial operacional', async () => {
    drainWhatsAppOutbox.mockResolvedValue({ ...emptyOutbox, retried: 1 });

    const response = await GET(new Request('http://localhost/api/jobs/whatsapp'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'partial' });
  });

  it('retorna erro operacional estável quando o worker falha', async () => {
    drainWhatsAppWebhooks.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new Request('http://localhost/api/jobs/whatsapp'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'JOB_FAILED', message: 'Não foi possível concluir a operação agora.' },
    });
  });
});
