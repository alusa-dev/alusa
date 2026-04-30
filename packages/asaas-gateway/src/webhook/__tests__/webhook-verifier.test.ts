import { describe, it, expect, vi } from 'vitest';
import { WebhookVerifier, sha256Hex, extractWebhookToken } from '../webhook-verifier';

describe('sha256Hex', () => {
  it('gera hash corretamente', () => {
    const hash = sha256Hex('test-token');
    // SHA256('test-token') = 4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e
    expect(hash).toBe('4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e');
  });
});

describe('WebhookVerifier', () => {
  const mockDeps = {
    findAsaasAccountByTokenHash: vi.fn(),
  };

  const verifier = new WebhookVerifier(mockDeps);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna MISSING_TOKEN quando token é null', async () => {
    const result = await verifier.verify(null);
    expect(result).toEqual({ valid: false, reason: 'MISSING_TOKEN' });
  });

  it('retorna MISSING_TOKEN quando token é undefined', async () => {
    const result = await verifier.verify(undefined);
    expect(result).toEqual({ valid: false, reason: 'MISSING_TOKEN' });
  });

  it('retorna ACCOUNT_NOT_FOUND quando não encontra conta', async () => {
    mockDeps.findAsaasAccountByTokenHash.mockResolvedValue(null);

    const result = await verifier.verify('some-token');
    expect(result).toEqual({ valid: false, reason: 'ACCOUNT_NOT_FOUND' });
  });

  it('retorna valid true com contaId quando token válido', async () => {
    const token = 'valid-token';
    const tokenHash = sha256Hex(token);

    mockDeps.findAsaasAccountByTokenHash.mockResolvedValue({
      webhookAuthTokenHash: tokenHash,
      financeProfile: { contaId: 'conta123' },
    });

    const result = await verifier.verify(token);
    expect(result).toEqual({
      valid: true,
      contaId: 'conta123',
    });
  });

  it('verifyOrThrow lança erro quando inválido', async () => {
    mockDeps.findAsaasAccountByTokenHash.mockResolvedValue(null);

    await expect(verifier.verifyOrThrow('bad-token')).rejects.toThrow('Webhook token inválido');
  });

  it('verifyOrThrow retorna contaId quando válido', async () => {
    const token = 'valid-token';
    const tokenHash = sha256Hex(token);

    mockDeps.findAsaasAccountByTokenHash.mockResolvedValue({
      webhookAuthTokenHash: tokenHash,
      financeProfile: { contaId: 'conta456' },
    });

    const contaId = await verifier.verifyOrThrow(token);
    expect(contaId).toBe('conta456');
  });
});

describe('extractWebhookToken', () => {
  it('extrai asaas-access-token', () => {
    const headers = {
      get: (name: string) => (name === 'asaas-access-token' ? 'token1' : null),
    };
    expect(extractWebhookToken(headers)).toBe('token1');
  });

  it('extrai x-asaas-access-token', () => {
    const headers = {
      get: (name: string) => (name === 'x-asaas-access-token' ? 'token2' : null),
    };
    expect(extractWebhookToken(headers)).toBe('token2');
  });

  it('extrai access_token', () => {
    const headers = {
      get: (name: string) => (name === 'access_token' ? 'token3' : null),
    };
    expect(extractWebhookToken(headers)).toBe('token3');
  });

  it('retorna null quando nenhum header presente', () => {
    const headers = { get: () => null };
    expect(extractWebhookToken(headers)).toBeNull();
  });

  it('prioriza asaas-access-token sobre outros', () => {
    const headers = {
      get: (name: string) => {
        if (name === 'asaas-access-token') return 'priority';
        if (name === 'access_token') return 'fallback';
        return null;
      },
    };
    expect(extractWebhookToken(headers)).toBe('priority');
  });
});
