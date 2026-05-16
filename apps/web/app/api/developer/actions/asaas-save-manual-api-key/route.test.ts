import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/features/support/api/support-api.server', () => ({
  requireSupportApi: vi.fn(),
}));

vi.mock('@/features/support/audit/support-audit.server', () => ({
  auditActorFromSession: vi.fn(() => ({
    actorId: 'support-1',
    actorUsername: 'ops',
    actorRole: 'SUPPORT_FINANCE',
  })),
  recordSupportAudit: vi.fn(),
  requestAuditMetadata: vi.fn(() => ({ ip: '127.0.0.1', userAgent: 'vitest' })),
}));

vi.mock('@alusa/finance', () => ({
  saveManualSubaccountApiKey: vi.fn(),
}));

import { saveManualSubaccountApiKey } from '@alusa/finance';
import { recordSupportAudit } from '@/features/support/audit/support-audit.server';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { POST } from './route';

function request(body: unknown) {
  return new Request('http://localhost/api/developer/actions/asaas-save-manual-api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  contaId: 'conta-1',
  apiKey: '$aact_hmlg_manual_key',
  reason: 'motivo de suporte válido',
  confirmations: {
    generatedWithLocalScript: true,
    belongsToExistingSubaccount: true,
    rotatedExistingKeyWhenPresent: true,
    understandsEncryptedStorage: true,
  },
};

describe('asaas-save-manual-api-key route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSupportApi).mockResolvedValue({
      ok: true,
      session: {
        username: 'ops',
        role: 'SUPPORT_FINANCE',
        supportUserId: 'support-1',
      },
    } as never);
    vi.mocked(saveManualSubaccountApiKey).mockResolvedValue({
      ok: true,
      summary: 'Chave validada e salva com segurança.',
      apiKeyStatus: 'CONNECTED',
      asaasAccountId: 'asaas-sub-1',
      webhook: { repaired: true, reason: 'REPAIRED' },
      reconcile: { reconciled: true, error: null },
      warnings: [],
    } as never);
  });

  it('bloqueia sem sessão de suporte', async () => {
    vi.mocked(requireSupportApi).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ success: false, error: 'Não autenticado' }, { status: 401 }),
    } as never);

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    expect(saveManualSubaccountApiKey).not.toHaveBeenCalled();
  });

  it('bloqueia role sem permissão', async () => {
    vi.mocked(requireSupportApi).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Permissão insuficiente' },
        { status: 403 },
      ),
    } as never);

    const response = await POST(request(validBody));

    expect(response.status).toBe(403);
    expect(requireSupportApi).toHaveBeenCalledWith(expect.any(Request), {
      roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
      scope: 'developer-action-asaas-save-manual-api-key',
    });
  });

  it('valida payload com Zod', async () => {
    const response = await POST(
      request({ ...validBody, confirmations: { generatedWithLocalScript: true } }),
    );

    expect(response.status).toBe(400);
    expect(saveManualSubaccountApiKey).not.toHaveBeenCalled();
  });

  it('não retorna apiKey e registra auditoria de sucesso', async () => {
    const response = await POST(request(validBody));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(json)).not.toContain(validBody.apiKey);
    expect(saveManualSubaccountApiKey).toHaveBeenCalledWith({
      contaId: 'conta-1',
      apiKey: validBody.apiKey,
      reason: validBody.reason,
      allowLocalValidationFallback: true,
      actor: { type: 'ADMIN', id: 'ops' },
    });
    expect(recordSupportAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.asaas.manual_api_key_saved',
        metadata: expect.not.objectContaining({ apiKey: expect.any(String) }),
      }),
    );
  });

  it('registra auditoria de falha sem apiKey', async () => {
    vi.mocked(saveManualSubaccountApiKey).mockResolvedValueOnce({
      ok: false,
      summary: 'API key inválida ou sem permissão.',
      errorCode: 'INVALID_API_KEY',
    } as never);

    const response = await POST(request(validBody));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(json)).not.toContain(validBody.apiKey);
    expect(recordSupportAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.asaas.manual_api_key_failed',
        metadata: expect.not.objectContaining({ apiKey: expect.any(String) }),
      }),
    );
  });
});
