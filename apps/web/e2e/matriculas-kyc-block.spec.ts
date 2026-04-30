import { test, expect } from '@playwright/test';
import { PrismaClient, Prisma } from '@prisma/client';
import { encode } from 'next-auth/jwt';

import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function seedAndAuthenticate(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  const conta = await prisma.conta.create({
    data: {
      nome: 'Escola Teste',
      cpfCnpj: '12345678901',
    },
    select: { id: true },
  });

  const usuario = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Admin Teste',
      email: 'admin@example.com',
      senhaHash: 'hash_nao_usado_no_e2e',
      role: 'ADMIN',
    },
    select: { id: true, email: true, nome: true, role: true, contaId: true },
  });

  await prisma.conta.update({
    where: { id: conta.id },
    data: { ownerUserId: usuario.id },
  });

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente no ambiente de teste');

  const token = await encode({
    secret,
    token: {
      id: usuario.id,
      email: usuario.email,
      name: usuario.nome,
      role: usuario.role,
      contaId: usuario.contaId,
    },
  });

  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Matrículas: hard-block KYC (409)', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('retorna 409 em gerar-pix e reenviar-cobranca quando KYC não aprovado (sem side effects)', async ({ page }) => {
    await seedAndAuthenticate(page);

    const conta = await prisma.conta.findFirst({ where: { cpfCnpj: '12345678901' }, select: { id: true } });
    expect(conta?.id).toBeTruthy();
    const contaId = conta!.id;

    const financeProfile = await prisma.financeProfile.create({
      data: { contaId },
      select: { id: true },
    });

    await prisma.asaasAccount.create({
      data: {
        financeProfileId: financeProfile.id,
        status: 'IN_PROGRESS',
      },
    });

    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Teste',
        dataNasc: new Date('2000-01-01'),
        cpf: '11122233344',
        email: 'aluno@example.com',
        telefone: '11999999999',
        asaasCustomerId: 'cust_test',
      },
      select: { id: true },
    });

    const matricula = await prisma.matricula.create({
      data: {
        alunoId: aluno.id,
        dataInicio: new Date('2026-01-01'),
        dataFimContrato: new Date('2026-12-31'),
        taxaMatricula: new Prisma.Decimal('100.00'),
        taxaIsenta: false,
      },
      select: { id: true },
    });

    await prisma.cobranca.create({
      data: {
        matriculaId: matricula.id,
        tipo: 'TAXA_MATRICULA',
        status: 'PENDENTE',
        competenciaInicio: new Date('2026-01-01'),
        competenciaFim: new Date('2026-01-31'),
        valor: new Prisma.Decimal('100.00'),
        vencimento: new Date('2026-01-10'),
        formaPagamento: 'PIX',
      },
    });

    const resGerarPix = await page.request.post(`/api/matriculas/${matricula.id}/gerar-pix`);
    expect(resGerarPix.status()).toBe(409);
    const bodyGerarPix = (await resGerarPix.json()) as { error?: string };
    expect(bodyGerarPix.error).toBe('KYC_NAO_APROVADO');

    const resReenviar = await page.request.post(`/api/matriculas/${matricula.id}/reenviar-cobranca`);
    expect(resReenviar.status()).toBe(409);
    const bodyReenviar = (await resReenviar.json()) as { error?: string };
    expect(bodyReenviar.error).toBe('KYC_NAO_APROVADO');

    const cobrancaDb = await prisma.cobranca.findFirst({
      where: { matriculaId: matricula.id, tipo: 'TAXA_MATRICULA' },
      select: { asaasPaymentId: true },
    });
    expect(cobrancaDb?.asaasPaymentId ?? null).toBeNull();

    const alunoDb = await prisma.aluno.findUnique({ where: { id: aluno.id }, select: { asaasCustomerId: true } });
    expect(alunoDb?.asaasCustomerId).toBe('cust_test');
  });
});
