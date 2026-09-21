/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  drainContractWhatsAppNotifications,
  drainWhatsAppOutbox,
  drainWhatsAppWebhooks,
  resolveTenantScope,
} = vi.hoisted(() => ({
  drainContractWhatsAppNotifications: vi.fn(),
  drainWhatsAppOutbox: vi.fn(),
  drainWhatsAppWebhooks: vi.fn(),
  resolveTenantScope: vi.fn(),
}));

vi.mock('@/src/server/whatsapp/outbox.service', () => ({
  drainContractWhatsAppNotifications,
  drainWhatsAppOutbox,
  drainWhatsAppWebhooks,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET } from '../route';

const emptyContract = { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 };
const emptyOutbox = { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
const emptyWebhooks = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };

describe('GET /api/jobs/whatsapp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    drainContractWhatsAppNotifications.mockResolvedValue(emptyContract);
    drainWhatsAppOutbox.mockResolvedValue(emptyOutbox);
    drainWhatsAppWebhooks.mockResolvedValue(emptyWebhooks);
  });

  it('trata a execução sem trabalho como saudável e limita os lotes', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/whatsapp?contractLimit=999&outboxLimit=0&webhookLimit=abc'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, outcome: 'completed' });
    expect(drainContractWhatsAppNotifications).toHaveBeenCalledWith({ contaId: undefined, limit: 200 });
    expect(drainWhatsAppOutbox).toHaveBeenCalledWith({ limit: 1 });
    expect(drainWhatsAppWebhooks).toHaveBeenCalledWith({ limit: 100 });
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
