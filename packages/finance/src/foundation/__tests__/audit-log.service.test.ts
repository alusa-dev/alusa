import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';

import { auditLogService } from '../audit-log.service';

async function cleanup(contaId: string) {
  await prisma.auditLog.deleteMany({ where: { contaId } });
  await prisma.financeProfile.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('auditLogService', () => {
  it('record deve criar log com actor SYSTEM por padrão', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Audit',
        cpfCnpj: `000000000010${String(Date.now()).slice(-2)}`,
      },
    });

    try {
      const created = await auditLogService.record({
        contaId: conta.id,
        action: 'TEST_ACTION',
        metadata: { hello: 'world' },
      });

      expect(created.contaId).toBe(conta.id);
      expect(created.action).toBe('TEST_ACTION');
      expect(created.actorType).toBe('SYSTEM');
      expect(created.actorId).toBeNull();
      expect(created.metadata).toMatchObject({ hello: 'world' });
    } finally {
      await cleanup(conta.id);
    }
  });

  it('record deve persistir entity e actor quando informado', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste Audit 2',
        cpfCnpj: `000000000011${String(Date.now()).slice(-2)}`,
      },
    });

    try {
      const created = await auditLogService.record({
        contaId: conta.id,
        action: 'TEST_ENTITY_ACTION',
        entity: { type: 'AsaasCredential', id: 'cred_123' },
        actor: { type: 'ADMIN', id: 'admin_1' },
      });

      expect(created.entityType).toBe('AsaasCredential');
      expect(created.entityId).toBe('cred_123');
      expect(created.actorType).toBe('ADMIN');
      expect(created.actorId).toBe('admin_1');
    } finally {
      await cleanup(conta.id);
    }
  });
});
