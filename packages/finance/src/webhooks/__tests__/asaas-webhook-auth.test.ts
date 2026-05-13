import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: {
      findFirst: mockFindFirst,
    },
  },
}));

import {
  ASAAS_WEBHOOK_TOKEN_HEADERS,
  authenticateAsaasWebhookToken,
  buildWebhookAuthTokenRotationData,
  getAsaasWebhookTokenHashPrefix,
  hashAsaasWebhookAccessToken,
  isValidAsaasWebhookTokenFormat,
  resolveAsaasWebhookAccessToken,
  resolveContaIdFromWebhookAuthToken,
} from '../asaas-webhook-auth';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('asaas-webhook-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ASAAS_WEBHOOK_PREVIOUS_TOKEN_WINDOW_MS;
  });

  it.each(ASAAS_WEBHOOK_TOKEN_HEADERS)('resolve token do header %s', (header) => {
    const headers = new Headers({ [header]: 'valid-token-with-enough-length' });

    expect(resolveAsaasWebhookAccessToken(headers)).toBe('valid-token-with-enough-length');
  });

  it('rejeita formato inválido antes de consultar banco', async () => {
    expect(isValidAsaasWebhookTokenFormat('short')).toBe(false);

    const result = await authenticateAsaasWebhookToken('short');

    expect(result).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('autentica token atual com comparação segura', async () => {
    const token = 'current-token-with-enough-length';
    const tokenHash = sha256(token);
    mockFindFirst.mockResolvedValue({
      webhookAuthTokenHash: tokenHash,
      previousWebhookAuthTokenHash: null,
      previousWebhookAuthTokenExpiresAt: null,
      financeProfile: { contaId: 'conta-1' },
    });

    const result = await authenticateAsaasWebhookToken(token);

    expect(result).toMatchObject({
      contaId: 'conta-1',
      tokenHash,
      tokenHashPrefix: tokenHash.slice(0, 12),
      matched: 'current',
    });
  });

  it('autentica token anterior dentro da janela de rotação', async () => {
    const token = 'previous-token-with-enough-length';
    const tokenHash = sha256(token);
    mockFindFirst.mockResolvedValue({
      webhookAuthTokenHash: sha256('other-current-token-with-enough-length'),
      previousWebhookAuthTokenHash: tokenHash,
      previousWebhookAuthTokenExpiresAt: new Date(Date.now() + 60_000),
      financeProfile: { contaId: 'conta-1' },
    });

    const result = await authenticateAsaasWebhookToken(token);

    expect(result).toMatchObject({
      contaId: 'conta-1',
      matched: 'previous',
    });
  });

  it('rejeita token anterior expirado', async () => {
    const token = 'previous-token-with-enough-length';
    mockFindFirst.mockResolvedValue(null);

    const result = await authenticateAsaasWebhookToken(token);

    expect(result).toBeNull();
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ webhookAuthTokenHash: sha256(token) }),
          expect.objectContaining({
            previousWebhookAuthTokenHash: sha256(token),
            previousWebhookAuthTokenExpiresAt: expect.objectContaining({ gt: expect.any(Date) }),
          }),
        ]),
      }),
    }));
  });

  it('retorna contaId e hash prefix sem expor token bruto', async () => {
    const token = 'current-token-with-enough-length';
    mockFindFirst.mockResolvedValue({
      webhookAuthTokenHash: sha256(token),
      previousWebhookAuthTokenHash: null,
      previousWebhookAuthTokenExpiresAt: null,
      financeProfile: { contaId: 'conta-1' },
    });

    await expect(resolveContaIdFromWebhookAuthToken(token)).resolves.toBe('conta-1');
    expect(getAsaasWebhookTokenHashPrefix(token)).toBe(hashAsaasWebhookAccessToken(token).slice(0, 12));
    expect(JSON.stringify(mockFindFirst.mock.calls)).not.toContain(token);
  });

  it('monta dados de rotação preservando hash anterior por janela curta', () => {
    process.env.ASAAS_WEBHOOK_PREVIOUS_TOKEN_WINDOW_MS = '60000';
    const now = new Date('2026-05-13T10:00:00.000Z');

    const data = buildWebhookAuthTokenRotationData({
      currentHash: 'old-hash',
      nextHash: 'new-hash',
      now,
    });

    expect(data).toEqual({
      webhookAuthTokenHash: 'new-hash',
      previousWebhookAuthTokenHash: 'old-hash',
      previousWebhookAuthTokenExpiresAt: new Date('2026-05-13T10:01:00.000Z'),
    });
  });
});
