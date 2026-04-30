import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { create, list } from './colaborador-service';

const prisma = new PrismaClient();

describe('Colaborador Service', () => {
  const contaId = 'conta-default';
  const cpf = '390.533.447-05';
  const email = 'maria.teste@example.com';
  const digits = (v?: string | null) => (typeof v === 'string' ? v.replace(/\D/g, '') : v ?? undefined);

  beforeAll(async () => {
    const owner = await prisma.usuario.upsert({
      where: { email: 'owner+colab.test@example.com' },
      update: {},
      create: { id: 'owner-colab-test', contaId, nome: 'Owner Colab', email: 'owner+colab.test@example.com', senhaHash: 'x', role: 'ADMIN', status: 'ATIVO' }
    });
    await prisma.conta.upsert({
      where: { id: contaId },
      update: { ownerUserId: owner.id, nome: 'Conta Teste' },
      create: { id: contaId, nome: 'Conta Teste', cpfCnpj: '99999999999999', ownerUserId: owner.id },
    });
    // Cleanup defensivo em execuções repetidas
  await prisma.colaborador.deleteMany({ where: { OR: [ { cpf: digits(cpf) }, { email } ] } } as unknown as Parameters<typeof prisma.colaborador.deleteMany>[0]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cria e lista colaboradores', async () => {
    const created = await create({
      contaId,
      nome: 'Maria Teste',
      cpf,
      cargo: 'RECEPCAO',
      status: 'ATIVO',
      email,
    } as unknown as Parameters<typeof create>[0]);

    expect(created.nome).toBe('Maria Teste');

    const items = await list(contaId);
    expect(items.length).toBeGreaterThan(0);
    // Cleanup pós-validação para manter idempotência
  await prisma.colaborador.deleteMany({ where: { OR: [ { cpf: digits(cpf) }, { email } ] } } as unknown as Parameters<typeof prisma.colaborador.deleteMany>[0]);
  });
});
