import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { DELETE, GET } from '@/app/api/finance/transfers/recipients/route';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', () => ({
  listTransferRecipients: vi.fn(),
  deleteTransferRecipient: vi.fn(),
}));

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as never) : null);
}

describe('GET /api/finance/transfers/recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando nao autenticado', async () => {
    await mockSession(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('retorna 412 quando gate bloqueia', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });
    const gate = await import('@/lib/finance/financial-account-gate');
    vi.mocked(gate.guardFinancialAccountOr412).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'BLOQUEADA' }, { status: 412 }),
    } as never);

    const response = await GET();
    expect(response.status).toBe(412);
  });

  it('retorna items do historico', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.listTransferRecipients).mockResolvedValueOnce({
      items: [
        {
          id: 'pix:abc',
          type: 'PIX',
          label: 'Fornecedor ABC',
          detail: 'PIX • abc@teste.com',
          lastUsedAt: '2026-03-23T20:00:00.000Z',
          destination: {
            type: 'PIX',
            pixAddressKey: 'abc@teste.com',
            pixAddressKeyType: 'EMAIL',
          },
        },
      ],
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].label).toBe('Fornecedor ABC');
  });

  it('remove uma chave Pix salva', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.deleteTransferRecipient).mockResolvedValueOnce({ removedCount: 2 } as never);

    const response = await DELETE(
      new Request('http://localhost/api/finance/transfers/recipients', {
        method: 'DELETE',
        body: JSON.stringify({ recipientId: 'PIX:EMAIL:pix@teste.com' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.removedCount).toBe(2);
    expect(finance.deleteTransferRecipient).toHaveBeenCalledWith({
      contaId: 'c1',
      recipientId: 'PIX:EMAIL:pix@teste.com',
    });
  });

  it('retorna 404 quando a chave Pix nao existe', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.deleteTransferRecipient).mockResolvedValueOnce({ removedCount: 0 } as never);

    const response = await DELETE(
      new Request('http://localhost/api/finance/transfers/recipients', {
        method: 'DELETE',
        body: JSON.stringify({ recipientId: 'PIX:EMAIL:ausente@teste.com' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(404);
  });
});