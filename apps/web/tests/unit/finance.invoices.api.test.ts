/**
 * Testes unitários para /api/finance/invoices
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextRequest as NextRequestCtor } from 'next/server';

import { GET, POST } from '@/app/api/finance/invoices/route';
import { POST as CancelPOST } from '@/app/api/finance/invoices/[invoiceId]/cancel/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');
  return {
    ...actual,
    getKycSummary: vi.fn(),
    createInvoice: vi.fn(),
    listInvoices: vi.fn(),
    cancelInvoice: vi.fn(),
  };
});

const { getServerSession } = await import('next-auth');
const { createInvoice, listInvoices, cancelInvoice, getKycSummary } = await import('@alusa/finance');

function mockSession(user: { id?: string; contaId?: string; role?: string } | null) {
  vi.mocked(getServerSession).mockResolvedValueOnce(user ? ({ user } as never) : (null as never));
}

function makeGetReq(url: string) {
  return { url } as unknown as NextRequest;
}

function makePostReq(url: string, body: unknown) {
  return new NextRequestCtor(url, {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('API Finance Invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKycSummary).mockResolvedValue({
      onboarding: {} as never,
      asaasConnection: { status: 'CONNECTED' },
      myAccountStatus: null,
      documents: null,
    } as never);
  });

  it('GET: 401 quando não autenticado', async () => {
    mockSession(null);

    const res = await GET(makeGetReq('http://test/api/finance/invoices'));
    expect(res.status).toBe(401);
  });

  it('GET: 403 quando sem permissão', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'PROFESSOR' });

    const res = await GET(makeGetReq('http://test/api/finance/invoices'));
    expect(res.status).toBe(403);
  });

  it('GET: 400 quando query inválida', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    const res = await GET(makeGetReq('http://test/api/finance/invoices?status=INVALID'));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    expect(listInvoices).not.toHaveBeenCalled();
  });

  it('GET: aplica filtro por status e paginação', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(listInvoices).mockResolvedValueOnce({ total: 12, items: [] } as never);

    const res = await GET(makeGetReq('http://test/api/finance/invoices?page=2&pageSize=5&status=REQUESTED'));

    expect(res.status).toBe(200);
    expect(listInvoices).toHaveBeenCalledWith({
      contaId: 'c1',
      limit: 5,
      offset: 5,
      status: 'REQUESTED',
    });
  });

  it('POST: 400 quando body inválido', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    const res = await POST(makePostReq('http://localhost/api/finance/invoices', {}));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    expect(createInvoice).not.toHaveBeenCalled();
  });

  it('POST: 403 quando feature flag desabilitada', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(createInvoice).mockResolvedValueOnce({
      success: false,
      error: 'FEATURE_DISABLED',
    } as never);

    const res = await POST(
      makePostReq('http://localhost/api/finance/invoices', {
        chargeId: 'ch_1',
        serviceDescription: 'Desc',
        observations: 'Obs',
        value: '150.00',
        deductions: '0.00',
        effectiveDate: '2026-01-04',
        municipalServiceName: 'Serviço',
        taxes: { retainIss: false, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0, iss: 0 },
      }),
    );

    expect(res.status).toBe(403);
  });

  it('POST: 409 quando KYC não aprovado', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(createInvoice).mockResolvedValueOnce({
      success: false,
      error: 'KYC_NAO_APROVADO',
    } as never);

    const res = await POST(
      makePostReq('http://localhost/api/finance/invoices', {
        chargeId: 'ch_1',
        serviceDescription: 'Desc',
        observations: 'Obs',
        value: '150.00',
        deductions: '0.00',
        effectiveDate: '2026-01-04',
        municipalServiceName: 'Serviço',
        taxes: { retainIss: false, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0, iss: 0 },
      }),
    );

    expect(res.status).toBe(409);
  });

  it('POST: 200 no sucesso', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(createInvoice).mockResolvedValueOnce({
      success: true,
      data: {
        invoiceId: 'ch_1',
        chargeId: 'ch_1',
        externalReference: 'invoice:ch_1',
        asaasInvoiceId: 'inv_1',
        status: 'REQUESTED',
        statusUpdatedAt: '2026-01-04T00:00:00.000Z',
        pdfUrl: null,
        xmlUrl: null,
        number: null,
        createdAt: '2026-01-04T00:00:00.000Z',
      },
    } as never);

    const res = await POST(
      makePostReq('http://localhost/api/finance/invoices', {
        chargeId: 'ch_1',
        serviceDescription: 'Desc',
        observations: 'Obs',
        value: '150.00',
        deductions: '0.00',
        effectiveDate: '2026-01-04',
        municipalServiceName: 'Serviço',
        taxes: { retainIss: false, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0, iss: 0 },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      data: {
        id: 'ch_1',
        chargeId: 'ch_1',
        externalReference: 'invoice:ch_1',
        asaasInvoiceId: 'inv_1',
        status: 'REQUESTED',
      },
    });
  });

  it('CANCEL: 200 no sucesso', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(cancelInvoice).mockResolvedValueOnce({
      success: true,
      data: {
        invoiceId: 'i1',
        asaasInvoiceId: 'inv_1',
        status: 'CANCELED',
        statusUpdatedAt: '2026-01-05T00:00:00.000Z',
      },
    } as never);

    const res = await CancelPOST(makePostReq('http://localhost/api/finance/invoices/i1/cancel', {}), {
      params: { invoiceId: 'i1' },
    });

    expect(res.status).toBe(200);
  });

  it('CANCEL: 409 quando KYC não aprovado', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(cancelInvoice).mockResolvedValueOnce({
      success: false,
      error: 'KYC_NAO_APROVADO',
    } as never);

    const res = await CancelPOST(makePostReq('http://localhost/api/finance/invoices/i1/cancel', {}), {
      params: { invoiceId: 'i1' },
    });

    expect(res.status).toBe(409);
  });
});
