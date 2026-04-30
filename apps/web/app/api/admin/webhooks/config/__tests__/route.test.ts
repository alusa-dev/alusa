import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getWebhookConfigDriftStatus: vi.fn(),
  repairWebhookConfigDrift: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getWebhookConfigDriftStatus, repairWebhookConfigDrift } from '@alusa/finance';
import { GET, POST } from '@/app/api/admin/webhooks/config/route';

describe('admin webhook config route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);
  });

  it('retorna drift remoto para admin autenticado', async () => {
    vi.mocked(getWebhookConfigDriftStatus).mockResolvedValue({
      contaId: 'c1',
      asaasAccountId: 'acc_1',
      financeProfileId: 'fp_1',
      expected: { url: 'https://app', sendType: 'SEQUENTIALLY', events: ['PAYMENT_CONFIRMED'], authTokenHash: 'hash' },
      remote: { webhookId: 'wh_1', url: 'https://app', enabled: true, interrupted: false, hasAuthToken: true, sendType: 'SEQUENTIALLY', penalizedRequestsCount: 0, events: ['PAYMENT_CONFIRMED'] },
      drift: { remoteMissing: false, urlMismatch: false, disabled: false, interrupted: false, missingAuthToken: false, sendTypeMismatch: false, eventsMismatch: false, localHashMismatch: false, penalized: false, missingEvents: [], extraEvents: [] },
      canRepair: true,
    } as never);

    const response = await GET();
    if (!response) throw new Error('Resposta ausente');

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(getWebhookConfigDriftStatus).toHaveBeenCalledWith('c1');
  });

  it('executa repair controlado para admin autenticado', async () => {
    vi.mocked(repairWebhookConfigDrift).mockResolvedValue({
      repaired: true,
      reason: 'REPAIRED',
      before: null,
      after: null,
    } as never);

    const response = await POST();
    if (!response) throw new Error('Resposta ausente');

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(repairWebhookConfigDrift).toHaveBeenCalledWith({
      contaId: 'c1',
      actor: { type: 'USER', id: 'u1' },
    });
  });

  it('bloqueia usuário sem permissão', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'c1', role: 'PROFESSOR' },
    } as never);

    const response = await GET();
    if (!response) throw new Error('Resposta ausente');
    expect(response.status).toBe(403);
  });
});