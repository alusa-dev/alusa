/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { drainFinanceWebhookSideEffectOutbox, resolveTenantScope } = vi.hoisted(() => ({
  drainFinanceWebhookSideEffectOutbox: vi.fn(),
  resolveTenantScope: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({ drainFinanceWebhookSideEffectOutbox }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET, POST } from '../route';

describe('GET|POST /api/jobs/process-ticket-email-outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    drainFinanceWebhookSideEffectOutbox.mockResolvedValue({ attempted: 1, processed: 1, failed: 0 });
  });

  it('processa a fila autenticada pelo cron e registra o resultado', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/process-ticket-email-outbox?limit=3', {
      headers: { 'x-cron-token': 'cron-secret' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      outcome: 'completed',
      job: { attempted: 1, processed: 1, failed: 0 },
    });
    expect(drainFinanceWebhookSideEffectOutbox).toHaveBeenCalledWith({
      contaId: undefined,
      limit: 3,
      effectTypes: ['EVENT_PUBLIC_ORDER_TICKET_EMAIL'],
    });
  });

  it('indica falha parcial sem mascará-la como sucesso', async () => {
    drainFinanceWebhookSideEffectOutbox.mockResolvedValue({ attempted: 2, processed: 1, failed: 1 });

    const response = await POST(new Request('http://localhost/api/jobs/process-ticket-email-outbox', {
      method: 'POST',
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      outcome: 'partial',
      job: { attempted: 2, processed: 1, failed: 1 },
    });
  });

  it('retorna erro operacional estável quando o drain falha', async () => {
    drainFinanceWebhookSideEffectOutbox.mockRejectedValue(new Error('provider unavailable'));

    const response = await GET(new Request('http://localhost/api/jobs/process-ticket-email-outbox'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'JOB_FAILED',
        message: 'Não foi possível concluir a operação agora.',
      },
    });
  });
});
