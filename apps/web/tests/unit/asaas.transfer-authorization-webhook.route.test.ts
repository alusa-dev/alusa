import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/webhooks/asaas/transfers/authorize/route';

vi.mock('@alusa/finance', () => ({
  handleTransferAuthorizationWebhook: vi.fn(),
  resolveAsaasWebhookAccessToken: vi.fn(),
  resolveContaIdFromWebhookAuthToken: vi.fn(),
}));

describe('POST /api/webhooks/asaas/transfers/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 sem token', async () => {
    const finance = await import('@alusa/finance');
    vi.mocked(finance.resolveAsaasWebhookAccessToken).mockReturnValueOnce(null);

    const request = new NextRequest('http://localhost:3000/api/webhooks/asaas/transfers/authorize', {
      method: 'POST',
      body: JSON.stringify({ type: 'TRANSFER', transfer: { id: 'tr_1' } }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('retorna APPROVED quando handler autoriza', async () => {
    const finance = await import('@alusa/finance');
    vi.mocked(finance.resolveAsaasWebhookAccessToken).mockReturnValueOnce('token');
    vi.mocked(finance.resolveContaIdFromWebhookAuthToken).mockResolvedValueOnce('c1');
    vi.mocked(finance.handleTransferAuthorizationWebhook).mockResolvedValueOnce({ status: 'APPROVED' } as never);

    const request = new NextRequest('http://localhost:3000/api/webhooks/asaas/transfers/authorize', {
      method: 'POST',
      body: JSON.stringify({ type: 'TRANSFER', transfer: { id: 'tr_1', externalReference: 'transfer:abc' } }),
      headers: { 'content-type': 'application/json', 'asaas-access-token': 'token' },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('APPROVED');
  });
});