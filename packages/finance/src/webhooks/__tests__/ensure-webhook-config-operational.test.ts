import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureWebhookReadyMock, assertAsaasTenantOperationalMock } = vi.hoisted(() => ({
  ensureWebhookReadyMock: vi.fn(),
  assertAsaasTenantOperationalMock: vi.fn(),
}));

vi.mock('../../foundation/asaas-operational-guard', () => ({
  ensureWebhookReady: ensureWebhookReadyMock,
  assertAsaasTenantOperational: assertAsaasTenantOperationalMock,
}));

import { ensureWebhookConfigOperational } from '../ensure-webhook-config-operational';

describe('ensureWebhookConfigOperational', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confere e repara o webhook remoto antes de validar o tenant', async () => {
    await ensureWebhookConfigOperational('conta-1', {
      NODE_ENV: 'production',
      VITEST: 'false',
    });

    expect(ensureWebhookReadyMock).toHaveBeenCalledWith('conta-1');
    expect(assertAsaasTenantOperationalMock).toHaveBeenCalledWith('conta-1');
    expect(ensureWebhookReadyMock.mock.invocationCallOrder[0]).toBeLessThan(
      assertAsaasTenantOperationalMock.mock.invocationCallOrder[0],
    );
  });

  it('bloqueia a operação quando o reparo remoto falha', async () => {
    ensureWebhookReadyMock.mockRejectedValueOnce(new Error('WEBHOOK_NOT_READY'));

    await expect(
      ensureWebhookConfigOperational('conta-1', { NODE_ENV: 'production', VITEST: 'false' }),
    ).rejects.toThrow('WEBHOOK_NOT_READY');
    expect(assertAsaasTenantOperationalMock).not.toHaveBeenCalled();
  });

  it('não acessa o provedor durante testes unitários', async () => {
    await ensureWebhookConfigOperational('conta-1', { NODE_ENV: 'test', VITEST: 'true' });

    expect(ensureWebhookReadyMock).not.toHaveBeenCalled();
    expect(assertAsaasTenantOperationalMock).toHaveBeenCalledWith('conta-1');
  });
});
