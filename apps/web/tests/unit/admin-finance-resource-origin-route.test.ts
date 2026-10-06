import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTenantScope: vi.fn(),
  runWithTenant: vi.fn(),
  classifyPreviewedExternalSubscription: vi.fn(),
  classifyPreviewedExternalPayment: vi.fn(),
  previewExternalSubscriptionCandidates: vi.fn(),
  previewExternalPaymentCandidates: vi.fn(),
  classifyPreviewedExternalInstallment: vi.fn(),
  previewExternalInstallmentCandidates: vi.fn(),
  classifyAsaasResourceOrigin: vi.fn(),
  ClassificationError: class extends Error {},
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.resolveTenantScope }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runWithTenant }));
vi.mock('@alusa/finance', () => ({
  AsaasResourceOriginClassificationError: mocks.ClassificationError,
  classifyPreviewedExternalSubscription: mocks.classifyPreviewedExternalSubscription,
  classifyPreviewedExternalPayment: mocks.classifyPreviewedExternalPayment,
  classifyPreviewedExternalInstallment: mocks.classifyPreviewedExternalInstallment,
  classifyAsaasResourceOrigin: mocks.classifyAsaasResourceOrigin,
  previewExternalSubscriptionCandidates: mocks.previewExternalSubscriptionCandidates,
  previewExternalPaymentCandidates: mocks.previewExternalPaymentCandidates,
  previewExternalInstallmentCandidates: mocks.previewExternalInstallmentCandidates,
}));
import { GET, POST } from '../../app/api/admin/finance/reconciliation/resources/route';

describe('admin Asaas resource origin API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveTenantScope.mockResolvedValue({ ok: true, contaId: 'conta-a', user: { id: 'admin-a' }, isAdmin: true });
    mocks.runWithTenant.mockImplementation(async (_contaId, callback) => callback({} as never));
    mocks.classifyPreviewedExternalSubscription.mockResolvedValue({ record: { id: 'origin-a' }, changed: true });
    mocks.classifyAsaasResourceOrigin.mockResolvedValue({ record: { id: 'origin-alusa-a' }, changed: true, reclassified: true });
    mocks.classifyPreviewedExternalPayment.mockResolvedValue({ record: { id: 'origin-payment-a' }, changed: true });
    mocks.previewExternalSubscriptionCandidates.mockResolvedValue({ items: [], total: 0, pageSize: 20, nextCursor: null });
    mocks.previewExternalPaymentCandidates.mockResolvedValue({ items: [{ paymentId: 'pay-a' }], total: 1, pageSize: 20, nextCursor: null });
  });

  it('denies non-admin callers before reading or classifying origin data', async () => {
    mocks.resolveTenantScope.mockResolvedValue({ ok: false, response: Response.json({ error: 'forbidden' }, { status: 403 }) });
    const response = await GET(new Request('http://localhost/api/admin/finance/reconciliation/resources'));
    expect(response.status).toBe(403);
    expect(mocks.runWithTenant).not.toHaveBeenCalled();
  });

  it('uses authenticated contaId and ignores a contaId supplied in the request body', async () => {
    const response = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'SUBSCRIPTION', asaasId: 'sub-a', origin: 'EXTERNAL', reason: 'Manual confirmation by school', contaId: 'conta-b' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.resolveTenantScope).toHaveBeenCalledWith(expect.any(Request), { requireAdmin: true });
    expect(mocks.runWithTenant).toHaveBeenCalledWith('conta-a', expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.classifyPreviewedExternalSubscription).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', actorId: 'admin-a', subscriptionId: 'sub-a' }));
  });

  it('retries a serialization race through the same idempotent classifier', async () => {
    const conflict = Object.assign(new Error('serialization conflict'), { code: 'P2034' });
    mocks.runWithTenant.mockRejectedValueOnce(conflict).mockImplementationOnce(async (_contaId, callback) => callback({} as never));
    const response = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'SUBSCRIPTION', asaasId: 'sub-a', origin: 'EXTERNAL', reason: 'Manual confirmation by school' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.runWithTenant).toHaveBeenCalledTimes(2);
    expect(mocks.classifyPreviewedExternalSubscription).toHaveBeenCalledTimes(1);
  });

  it('serves a tenant-scoped standalone payment preview and classifies only the manually confirmed payment', async () => {
    const getResponse = await GET(new Request('http://localhost/api/admin/finance/reconciliation/resources?resourceType=PAYMENT&pageSize=5'));
    expect(getResponse.status).toBe(200);
    expect(mocks.previewExternalPaymentCandidates).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', pageSize: 5 }));

    const postResponse = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'PAYMENT', asaasId: 'pay-a', origin: 'EXTERNAL', reason: 'Confirmei origem avulsa' }),
    }));
    expect(postResponse.status).toBe(200);
    expect(mocks.classifyPreviewedExternalPayment).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', actorId: 'admin-a', paymentId: 'pay-a' }));
  });

  it('serves installment preview and classifies its exact provider installment ID', async () => {
    const getResponse = await GET(new Request('http://localhost/api/admin/finance/reconciliation/resources?resourceType=INSTALLMENT&pageSize=7'));
    expect(getResponse.status).toBe(200);
    expect(mocks.previewExternalInstallmentCandidates).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', pageSize: 7 }));

    const postResponse = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'INSTALLMENT', asaasId: 'inst-a', origin: 'EXTERNAL', reason: 'Conferido com a escola' }),
    }));
    expect(postResponse.status).toBe(200);
    expect(mocks.classifyPreviewedExternalInstallment).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', actorId: 'admin-a', installmentId: 'inst-a' }));
  });

  it('permite reclassificação auditável para ALUSA somente no tenant autenticado', async () => {
    const response = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'SUBSCRIPTION', asaasId: 'sub-a', origin: 'ALUSA', reason: 'Vínculo local confirmado' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.classifyAsaasResourceOrigin).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-a', origin: 'ALUSA', actorId: 'admin-a',
    }));
  });

  it('preserves safe domain conflicts while rejecting external reclassification', async () => {
    const message = 'O recurso já possui vínculo local nesta conta.';
    mocks.runWithTenant.mockRejectedValueOnce(new mocks.ClassificationError(message));
    const response = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'SUBSCRIPTION', asaasId: 'sub-a', origin: 'EXTERNAL', reason: 'Conferido pela escola' }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: 'CLASSIFICACAO_REJEITADA', message } });
  });

  it('does not expose unexpected database errors in the response', async () => {
    const privateDatabaseMessage = 'column secret_customer_table does not exist';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.runWithTenant.mockRejectedValueOnce(new Error(privateDatabaseMessage));
    const response = await POST(new Request('http://localhost/api/admin/finance/reconciliation/resources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'SUBSCRIPTION', asaasId: 'sub-a', origin: 'ALUSA', reason: 'Vínculo local confirmado' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { code: 'ERRO_INTERNO', message: 'Não foi possível classificar o recurso. Tente novamente.' } });
    expect(JSON.stringify(body)).not.toContain(privateDatabaseMessage);
    expect(errorLog).toHaveBeenCalledWith('[admin][asaas-resource-origin] classification_failed', { errorType: 'Error' });
    errorLog.mockRestore();
  });
});
