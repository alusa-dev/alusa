import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { prisma, createWebhookAuthToken } from './utils/fixtures';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from './utils/auth';

test.describe('fluxo acadêmico-financeiro até o portal', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await seedAdminAndAuthenticate(page, { email: `flow-${randomUUID()}@example.com` });
  });

  test.afterAll(async () => prisma.$disconnect());

  test('matrícula, contrato e cobrança refletem pagamento após webhook autenticado', async ({ page, request }) => {
    const sessionResponse = await page.request.get('/api/auth/session');
    const session = await sessionResponse.json() as { user: { contaId: string } };
    const contaId = session.user.contaId;
    const suffix = randomUUID();
    const webhookToken = `webhook-${suffix}`;

    const responsavelUser = await prisma.usuario.create({
      data: {
        contaId, nome: 'Responsável E2E', email: `resp-${suffix}@example.com`,
        senhaHash: 'not-used', role: 'RESPONSAVEL', status: 'ATIVO',
      }, select: { id: true },
    });
    const responsavel = await prisma.responsavel.create({
      data: {
        contaId, nome: 'Responsável E2E', cpf: String(Date.now()).slice(-11),
        email: `resp-${suffix}@example.com`, telefone: '11999999999', financeiro: true,
        usuarioId: responsavelUser.id,
      }, select: { id: true },
    });
    const aluno = await prisma.aluno.create({
      data: {
        contaId, nome: `Aluno ${suffix}`, dataNasc: new Date('2015-01-01'), status: 'ATIVO',
      }, select: { id: true, nome: true },
    });
    await prisma.alunoResponsavel.create({
      data: { contaId, alunoId: aluno.id, responsavelId: responsavel.id, tipoVinculo: 'RESPONSAVEL' },
    });
    const matricula = await prisma.matricula.create({
      data: {
        contaId, alunoId: aluno.id, responsavelFinanceiroId: responsavel.id,
        dataInicio: new Date(), dataFimContrato: new Date('2027-12-31'),
        taxaMatricula: new Prisma.Decimal('100.00'), status: 'ATIVA',
      }, select: { id: true },
    });
    const contrato = await prisma.contrato.create({
      data: {
        contaId, matriculaId: matricula.id, arquivoPdfUrl: 'https://example.test/contract.pdf',
        hashPdf: createHash('sha256').update(suffix).digest('hex'),
      }, select: { id: true },
    });
    await prisma.matricula.update({ where: { id: matricula.id }, data: { contratoAtualId: contrato.id } });
    const paymentId = `pay-${suffix}`;
    const cobranca = await prisma.cobranca.create({
      data: {
        contaId, matriculaId: matricula.id, tipo: 'TAXA_MATRICULA', descricao: 'Taxa de matrícula E2E',
        competenciaInicio: new Date('2026-01-01'), competenciaFim: new Date('2026-12-31'),
        valor: new Prisma.Decimal('100.00'), vencimento: new Date('2099-01-01'),
        formaPagamento: 'PIX', status: 'PENDENTE', asaasPaymentId: paymentId,
      }, select: { id: true },
    });
    const contaB = await prisma.conta.create({
      data: { nome: `Escola isolada ${suffix}` },
      select: { id: true },
    });
    const alunoB = await prisma.aluno.create({
      data: {
        contaId: contaB.id, nome: `Aluno privado ${suffix}`,
        dataNasc: new Date('2015-01-01'), status: 'ATIVO',
      }, select: { id: true },
    });
    const matriculaB = await prisma.matricula.create({
      data: {
        contaId: contaB.id, alunoId: alunoB.id,
        dataInicio: new Date(), dataFimContrato: new Date('2027-12-31'),
        taxaMatricula: new Prisma.Decimal('250.00'), status: 'ATIVA',
      }, select: { id: true },
    });
    const cobrancaB = await prisma.cobranca.create({
      data: {
        contaId: contaB.id, matriculaId: matriculaB.id, tipo: 'TAXA_MATRICULA',
        descricao: `Cobrança privada ${suffix}`,
        competenciaInicio: new Date('2026-01-01'), competenciaFim: new Date('2026-12-31'),
        valor: new Prisma.Decimal('250.00'), vencimento: new Date('2099-01-01'),
        formaPagamento: 'PIX', status: 'PENDENTE', asaasPaymentId: `pay-b-${suffix}`,
      }, select: { id: true },
    });
    // Adversarial fixture: Cobranca has independent contaId and matriculaId
    // foreign keys, so represent a malformed cross-tenant row linked to A's
    // enrollment. Portal reads must still enforce the explicit contaId filter.
    const cobrancaBForAlunoA = await prisma.cobranca.create({
      data: {
        contaId: contaB.id, matriculaId: matricula.id, tipo: 'TAXA_MATRICULA',
        descricao: `Cobrança inconsistente privada ${suffix}`,
        competenciaInicio: new Date('2026-01-01'), competenciaFim: new Date('2026-12-31'),
        valor: new Prisma.Decimal('275.00'), vencimento: new Date('2099-01-01'),
        formaPagamento: 'PIX', status: 'PENDENTE', asaasPaymentId: `pay-b-a-${suffix}`,
      }, select: { id: true },
    });
    await prisma.charge.create({
      data: {
        contaId: contaB.id, cobrancaId: cobrancaB.id,
        externalReference: `charge:${cobrancaB.id}`,
        asaasPaymentId: `pay-b-${suffix}`, status: 'OPEN',
      },
    });
    await prisma.charge.create({
      data: {
        contaId, cobrancaId: cobranca.id, externalReference: `charge:${cobranca.id}`,
        asaasPaymentId: paymentId, status: 'OPEN',
      },
    });
    await prisma.charge.create({
      data: {
        contaId: contaB.id, cobrancaId: cobrancaBForAlunoA.id,
        externalReference: `charge:${cobrancaBForAlunoA.id}`,
        asaasPaymentId: `pay-b-a-${suffix}`, status: 'OPEN',
      },
    });
    await createWebhookAuthToken({ contaId, token: webhookToken });

    const delivery = await request.post('/api/webhooks/asaas', {
      headers: { 'asaas-access-token': webhookToken, 'content-type': 'application/json' },
      data: {
        id: `evt-${suffix}`, event: 'PAYMENT_CONFIRMED',
        payment: { id: paymentId, status: 'CONFIRMED', value: 100, netValue: 97, billingType: 'PIX' },
      },
    });
    expect(delivery.ok()).toBeTruthy();
    await expect.poll(async () => prisma.cobranca.findUnique({
      where: { id: cobranca.id }, select: { status: true },
    })).toEqual({ status: 'PAGO' });

    const portalToken = await encode({
      secret: process.env.NEXTAUTH_SECRET ?? 'testsecret',
      token: { id: responsavelUser.id, role: 'RESPONSAVEL', contaId, sessionVersion: 0 },
    });
    await page.context().addCookies([{
      name: 'next-auth.session-token', value: portalToken, domain: 'localhost', path: '/',
      httpOnly: true, secure: false, sameSite: 'Lax',
    }]);
    const portal = await page.request.get('/api/portal/financeiro');
    expect(portal.ok()).toBeTruthy();
    const readModel = await portal.json() as { cobrancas: Array<{ id: string; status: string; matricula: { aluno: { nome: string } } }> };
    expect(readModel.cobrancas.some((item) => item.id === cobrancaB.id)).toBe(false);
    expect(readModel.cobrancas.some((item) => item.id === cobrancaBForAlunoA.id)).toBe(false);
    expect(JSON.stringify(readModel)).not.toContain(`Aluno privado ${suffix}`);
    expect(JSON.stringify(readModel)).not.toContain(`Cobrança inconsistente privada ${suffix}`);
    expect(readModel.cobrancas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: cobranca.id,
        status: 'PAGO',
        matricula: expect.objectContaining({
          aluno: expect.objectContaining({ nome: aluno.nome }),
        }),
      }),
    ]));

    const crossTenantDetail = await page.request.get(`/api/portal/financeiro/${cobrancaB.id}`);
    expect(crossTenantDetail.status()).toBe(404);
    expect(await crossTenantDetail.json()).toEqual({ error: 'Cobrança não encontrada' });

    const malformedCrossTenantDetail = await page.request.get(
      `/api/portal/financeiro/${cobrancaBForAlunoA.id}`,
    );
    expect(malformedCrossTenantDetail.status()).toBe(404);
    expect(await malformedCrossTenantDetail.json()).toEqual({ error: 'Cobrança não encontrada' });
  });
});
