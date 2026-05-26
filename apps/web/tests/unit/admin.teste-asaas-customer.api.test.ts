/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/session', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  loadAndValidateSubaccountKey: vi.fn(),
  asaasGetCustomer: vi.fn(),
  AsaasHttpError: class AsaasHttpError extends Error {
    status: number;
    responseBody?: unknown;
    response?: unknown;
    constructor(message: string, status: number, payload?: { errors?: unknown; responseBody?: unknown; response?: unknown }) {
      super(message);
      this.name = 'AsaasHttpError';
      this.status = status;
      this.responseBody = payload;
      this.response = payload;
    }
  },
}));

import { getSessionUser } from '@/lib/auth/session';
import { AsaasHttpError, asaasGetCustomer, loadAndValidateSubaccountKey } from '@alusa/finance';
import { POST } from '@/app/api/admin/teste-asaas/customer/route';

const buildPostRequest = (body: unknown): NextRequest =>
  new Request('http://localhost/api/admin/teste-asaas/customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe('POST /api/admin/teste-asaas/customer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    const res = await POST(buildPostRequest({ customerId: 'cus_123' }));
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando não é ADMIN', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'FINANCEIRO',
      contaId: 'conta-1',
    });
    const res = await POST(buildPostRequest({ customerId: 'cus_123' }));
    expect(res.status).toBe(403);
  });

  it('retorna 400 quando payload inválido', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'ADMIN',
      contaId: 'conta-1',
    });
    const res = await POST(buildPostRequest({ customerId: 'invalid' }));
    expect(res.status).toBe(400);
  });

  it('retorna 412 quando não há chave configurada (MISSING_KEY)', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'ADMIN',
      contaId: 'conta-1',
    });
    vi.mocked(loadAndValidateSubaccountKey).mockResolvedValueOnce({
      ok: false,
      code: 'MISSING_KEY',
      message: 'Chave da subconta não configurada.',
    });

    const res = await POST(buildPostRequest({ customerId: 'cus_12345678' }));
    expect(res.status).toBe(412);
    const json = await res.json();
    expect(json.code).toBe('MISSING_KEY');
  });

  it('retorna 401 quando chave é inválida (INVALID_KEY)', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'ADMIN',
      contaId: 'conta-1',
    });
    vi.mocked(loadAndValidateSubaccountKey).mockResolvedValueOnce({
      ok: false,
      code: 'INVALID_KEY',
      message: 'Chave da subconta inválida ou sem permissão.',
    });

    const res = await POST(buildPostRequest({ customerId: 'cus_12345678' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('INVALID_KEY');
  });

  it('retorna 503 quando erro temporário do Asaas (TEMPORARY_ERROR)', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'ADMIN',
      contaId: 'conta-1',
    });
    vi.mocked(loadAndValidateSubaccountKey).mockResolvedValueOnce({
      ok: false,
      code: 'TEMPORARY_ERROR',
      message: 'Não foi possível validar a chave agora.',
    });

    const res = await POST(buildPostRequest({ customerId: 'cus_12345678' }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('TEMPORARY_ERROR');
  });

  it('retorna 200 quando customer existe', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'ADMIN',
      contaId: 'conta-1',
    });
    vi.mocked(loadAndValidateSubaccountKey).mockResolvedValueOnce({
      ok: true,
      apiKey: 'test-api-key-placeholder',
      source: 'ASAAS_ACCOUNT',
    });
    vi.mocked(asaasGetCustomer).mockResolvedValueOnce({ id: 'cus_12345678', name: 'Teste' } as never);

    const res = await POST(buildPostRequest({ customerId: 'cus_12345678' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('retorna 404 quando customer não existe', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({
      id: 'u1',
      role: 'ADMIN',
      contaId: 'conta-1',
    });
    vi.mocked(loadAndValidateSubaccountKey).mockResolvedValueOnce({
      ok: true,
      apiKey: 'test-api-key-placeholder',
      source: 'ASAAS_ACCOUNT',
    });

    vi.mocked(asaasGetCustomer).mockRejectedValueOnce(
      new AsaasHttpError('Not found', 404, { errors: [{ description: 'Not found' }] }),
    );

    const res = await POST(buildPostRequest({ customerId: 'cus_12345678' }));
    expect(res.status).toBe(404);
  });
});
