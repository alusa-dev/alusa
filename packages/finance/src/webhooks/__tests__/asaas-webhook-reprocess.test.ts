import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { reprocessErroredAsaasWebhooks } from '../asaas-webhook-handler';

async function cleanup(contaId: string) {
  await prisma.webhookAsaas.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('reprocessErroredAsaasWebhooks', () => {
  it('deve reprocessar webhooks em ERRO e registrar tentativas/observabilidade', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    const eventId = `evt_${randomUUID()}`;
    const payload = { id: eventId, event: 'UNKNOWN_EVENT_TYPE' };

    try {
      const hook = await prisma.webhookAsaas.create({
        data: {
          contaId: conta.id,
          evento: 'UNKNOWN_EVENT_TYPE',
          eventId,
          payload,
          status: 'ERRO',
          tentativas: 0,
        },
      });

      const result = await reprocessErroredAsaasWebhooks({ contaId: conta.id, limit: 10 });
      expect(result).toMatchObject({ attempted: 1, processed: 1, failed: 0 });

      const updated = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });
      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('PROCESSADO');
      expect(updated?.tentativas).toBe(1);
      expect(updated?.ultimaTentativaEm).toBeInstanceOf(Date);
      expect(updated?.processadoEm).toBeInstanceOf(Date);
      expect(typeof updated?.duracaoMs).toBe('number');
      expect(updated?.duracaoMs).toBeGreaterThanOrEqual(0);
      expect(updated?.ultimoErro).toBeNull();
      expect(Array.isArray(updated?.attemptsLog)).toBe(true);
      expect((updated?.attemptsLog as unknown[]).length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve pular webhooks que já excederam o limite de tentativas', async () => {
    const original = process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS;
    process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS = '1';

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });

    const eventId = `evt_${randomUUID()}`;
    const payload = { id: eventId, event: 'UNKNOWN_EVENT_TYPE' };

    try {
      const hook = await prisma.webhookAsaas.create({
        data: {
          contaId: conta.id,
          evento: 'UNKNOWN_EVENT_TYPE',
          eventId,
          payload,
          status: 'ERRO',
          tentativas: 1,
        },
      });

      const result = await reprocessErroredAsaasWebhooks({ contaId: conta.id, limit: 10 });
      expect(result).toMatchObject({ attempted: 0, processed: 0, failed: 0 });

      const updated = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });
      expect(updated?.status).toBe('ERRO');
      expect(updated?.tentativas).toBe(1);
    } finally {
      process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS = original;
      await cleanup(conta.id);
    }
  });
});
