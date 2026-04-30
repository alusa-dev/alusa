/**
 * Testes unitários para /api/cobrancas/[id]/resend
 *
 * @module __tests__/api/cobrancas/resend
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');
  return {
    ...actual,
    resendTaxaMatricula: vi.fn(),
  };
});

describe('POST /api/cobrancas/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se usuário não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/cobrancas/123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: '123' } });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Não autenticado');
  });

  it('deve retornar 404 se cobrança não encontrada', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockRejectedValue(
      new ManualSyncError(404, 'COBRANCA_NOT_FOUND', 'Cobrança não encontrada.'),
    );

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('COBRANCA_NOT_FOUND');
    expect(data.message).toBe('Cobrança não encontrada.');
  });

  it('deve retornar 400 se cobrança não for taxa de matrícula', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockRejectedValue(
      new ManualSyncError(
        400,
        'INVALID_CHARGE_TYPE',
        'Somente taxa de matrícula pode ser reenviada.',
      ),
    );

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('INVALID_CHARGE_TYPE');
  });

  it('deve retornar 400 se cobrança não tiver payment no Asaas', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockRejectedValue(
      new ManualSyncError(
        400,
        'ASAAS_PAYMENT_MISSING',
        'Cobrança não possui identificador no Asaas.',
      ),
    );

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('ASAAS_PAYMENT_MISSING');
  });

  it('deve retornar 410 se cobrança foi deletada no Asaas', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockRejectedValue(
      new ManualSyncError(410, 'ASAAS_PAYMENT_DELETED', 'Cobrança removida no Asaas.'),
    );

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(410);
    expect(data.error).toBe('ASAAS_PAYMENT_DELETED');
    expect(data.message).toBe('Cobrança removida no Asaas.');
  });

  it('deve reenviar cobrança com sucesso', async () => {
    const { getServerSession } = await import('next-auth');
    const { resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockResolvedValue({
      cobrancaId: 'cobranca-123',
      matriculaId: 'matricula-123',
      previousStatus: 'PENDENTE',
      newStatus: 'PENDENTE',
      invoiceUrl: 'https://asaas.com/invoice/123',
      bankSlipUrl: 'https://asaas.com/boleto/123',
      pixQrCode: 'https://asaas.com/pix/123',
      pixCopyPaste: '000201010211',
    });

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe('Cobrança reenviada com sucesso');
    expect(data.data.invoiceUrl).toBe('https://asaas.com/invoice/123');
    expect(data.data.bankSlipUrl).toBe('https://asaas.com/boleto/123');
    expect(data.data.pixQrCodeUrl).toBe('https://asaas.com/pix/123');
    expect(data.data.pixCopyPaste).toBe('000201010211');
    expect(resendTaxaMatricula).toHaveBeenCalledWith(
      expect.objectContaining({
        cobrancaId: 'cobranca-123',
        contaId: 'conta-123',
        actorId: 'user-123',
      }),
    );
  });

  it('deve retornar 502 se Asaas falhar', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockRejectedValue(
      new ManualSyncError(502, 'ASAAS_ERROR', 'Falha ao gerar links da cobrança no Asaas.'),
    );

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toBe('ASAAS_ERROR');
    expect(data.message).toBe('Falha ao gerar links da cobrança no Asaas.');
  });

  it('deve retornar 500 para erros inesperados', async () => {
    const { getServerSession } = await import('next-auth');
    const { resendTaxaMatricula } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' },
    } as never);

    vi.mocked(resendTaxaMatricula).mockRejectedValue(new Error('Falha desconhecida'));

    const request = new NextRequest('http://localhost:3000/api/cobrancas/cobranca-123/resend', {
      method: 'POST',
    });

    const response = await POST(request, { params: { id: 'cobranca-123' } });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('INTERNAL_ERROR');
  });
});
