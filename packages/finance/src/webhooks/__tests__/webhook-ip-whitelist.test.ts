import { afterEach, describe, expect, it } from 'vitest';

import {
  extractClientIp,
  extractClientIps,
  isAsaasWebhookIpAllowed,
  shouldBlockAsaasWebhookByIp,
  shouldBlockAsaasWebhookByIpForTenant,
} from '../webhook-ip-whitelist';

describe('webhook-ip-whitelist', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalIpCheck = process.env.ASAAS_WEBHOOK_IP_CHECK;
  const originalSandboxBypassContaIds = process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalIpCheck === undefined) {
      delete process.env.ASAAS_WEBHOOK_IP_CHECK;
    } else {
      process.env.ASAAS_WEBHOOK_IP_CHECK = originalIpCheck;
    }
    if (originalSandboxBypassContaIds === undefined) {
      delete process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS;
    } else {
      process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS = originalSandboxBypassContaIds;
    }
  });

  it('extrai todos os IPs candidatos sem duplicar', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.10, 52.67.211.226, 52.67.211.226',
      'x-real-ip': '198.51.100.20',
    });

    expect(extractClientIp(headers)).toBe('198.51.100.20');
    expect(extractClientIps(headers)).toEqual([
      '198.51.100.20',
      '203.0.113.10',
      '52.67.211.226',
    ]);
  });

  it('aceita quando qualquer IP da cadeia pertence ao Asaas', () => {
    process.env.NODE_ENV = 'production';

    expect(isAsaasWebhookIpAllowed(['203.0.113.10', '52.67.211.226'])).toBe(true);
  });

  it('bloqueia por IP apenas no modo estrito', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ASAAS_WEBHOOK_IP_CHECK;

    expect(isAsaasWebhookIpAllowed('203.0.113.10')).toBe(false);
    expect(shouldBlockAsaasWebhookByIp('203.0.113.10')).toBe(false);

    process.env.ASAAS_WEBHOOK_IP_CHECK = 'strict';
    expect(shouldBlockAsaasWebhookByIp('203.0.113.10')).toBe(true);
  });

  it('mantém a exceção Sandbox vazia por padrão e bloqueia IP não permitido', () => {
    process.env.NODE_ENV = 'production';
    process.env.ASAAS_WEBHOOK_IP_CHECK = 'strict';
    delete process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS;

    expect(shouldBlockAsaasWebhookByIpForTenant('203.0.113.10', 'conta-sandbox-a')).toBe(true);
    expect(shouldBlockAsaasWebhookByIpForTenant('52.67.211.226', 'conta-sandbox-a')).toBe(false);
  });

  it('aplica exceção somente à Conta autenticada explicitamente configurada', () => {
    process.env.NODE_ENV = 'production';
    process.env.ASAAS_WEBHOOK_IP_CHECK = 'strict';
    process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS = 'conta-sandbox-a';

    expect(shouldBlockAsaasWebhookByIpForTenant('203.0.113.10', 'conta-sandbox-a')).toBe(false);
    expect(shouldBlockAsaasWebhookByIpForTenant('203.0.113.10', 'conta-sandbox-b')).toBe(true);
  });

  it('não concede bypass sem Conta autenticada, incluindo token ausente ou inválido', () => {
    process.env.NODE_ENV = 'production';
    process.env.ASAAS_WEBHOOK_IP_CHECK = 'strict';
    process.env.ASAAS_WEBHOOK_SANDBOX_IP_BYPASS_CONTA_IDS = 'conta-sandbox-a';

    expect(shouldBlockAsaasWebhookByIpForTenant('203.0.113.10', null)).toBe(true);
  });
});
