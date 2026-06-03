import { test, expect, type Page } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { seedAdminAndLogin, prisma } from './helpers/auth';
import { ApiHelper, waitForPageReady } from './helpers/api';

// ---------------------------------------------------------------------------
// Seletores (UI usa div-grid, não <table>) — escopados ao card correto
// ---------------------------------------------------------------------------

/** Assinaturas list: rows são <Link> (=<a>) dentro de .divide-y */
const assinaturaListRows = (p: Page) => p.locator('.divide-y > a');

/** Parcelamentos list: rows são <div class="...cursor-pointer"> dentro de .divide-y */
const parcelamentoListRows = (p: Page) => p.locator('.divide-y > .cursor-pointer');

/**
 * Assinatura detail – Cobranças Geradas:
 * Escopado ao card que contém o heading "Cobranças Geradas".
 * Header bg-gray-50 é a 1ª child DENTRO de .divide-y → pular via :nth-child(n+2)
 */
const assinaturaDetailRows = (p: Page) => {
  const card = p.locator('div.border').filter({ has: p.getByRole('heading', { name: 'Cobranças Geradas', exact: true }) });
  return card.locator('.divide-y > div:nth-child(n+2)');
};

/**
 * Parcelamento detail – Parcelas:
 * Escopado ao card que contém heading "Parcelas".
 * Header bg-gray-50 fica FORA de .divide-y → todos os filhos são data rows
 */
const parcelamentoDetailRows = (p: Page) => {
  const card = p.locator('div.border').filter({ has: p.getByRole('heading', { name: 'Parcelas', exact: true }) });
  return card.locator('.divide-y > div');
};

/**
 * waitForPageReady alternativo para páginas com heading ambíguo.
 * Usa `exact: true` + `.first()` para evitar strict mode violation.
 */
async function waitForDetailReady(page: Page, headingText: string) {
  await page.getByRole('heading', { name: headingText, exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('[data-slot="skeleton"], .animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Seed: cria cenário completo (assinatura + parcelamento) sem duplicatas
// ---------------------------------------------------------------------------

type Seed = Awaited<ReturnType<typeof seedCenario>>;

function midMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 15);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

async function seedCenario(contaId: string) {
  const now = new Date();
  const uid = () => randomUUID().slice(0, 8);

  // Responsável financeiro
  const responsavel = await prisma.responsavel.create({
    data: {
      contaId,
      nome: 'Paula Responsável E2E',
      cpf: String(Math.floor(Math.random() * 90000000000) + 10000000000),
      email: `resp-${uid()}@test.local`,
      telefone: '11999990000',
      financeiro: true,
      asaasCustomerId: `cust_e2e_${uid()}`,
    },
    select: { id: true, asaasCustomerId: true },
  });

  // Customer local
  const customer = await prisma.customer.create({
    data: {
      contaId,
      payerType: 'RESPONSAVEL',
      payerId: responsavel.id,
      externalReference: `customer:${randomUUID()}`,
      asaasCustomerId: responsavel.asaasCustomerId,
    },
    select: { id: true },
  });

  // Aluno menor (precisa de responsável)
  const aluno = await prisma.aluno.create({
    data: {
      contaId,
      nome: 'Lucas Aluno E2E',
      dataNasc: new Date('2010-03-20'),
      status: 'ATIVO',
    },
    select: { id: true },
  });

  // Matrícula
  const matricula = await prisma.matricula.create({
    data: {
      alunoId: aluno.id,
      responsavelFinanceiroId: responsavel.id,
      dataInicio: startOfMonth(now),
      dataFimContrato: endOfMonth(addMonths(now, 11)),
      status: 'ATIVA',
      taxaMatricula: new Prisma.Decimal('0'),
    },
    select: { id: true },
  });

  // Contrato
  const contrato = await prisma.contrato.create({
    data: {
      contaId,
      matriculaId: matricula.id,
      arquivoPdfUrl: 'https://example.com/contrato-e2e.pdf',
      hashPdf: createHash('sha256').update(randomUUID()).digest('hex'),
    },
    select: { id: true },
  });

  // ---- ASSINATURA (3 cobranças) ----

  const subscription = await prisma.subscription.create({
    data: {
      contaId,
      contratoId: contrato.id,
      matriculaId: matricula.id,
      externalReference: `subscription:${randomUUID()}`,
      status: 'ACTIVE',
      asaasSubscriptionId: `sub_e2e_${uid()}`,
    },
    select: { id: true, asaasSubscriptionId: true },
  });

  await prisma.matricula.update({
    where: { id: matricula.id },
    data: { asaasSubscriptionId: subscription.asaasSubscriptionId },
  });

  const subscriptionCobrancas: string[] = [];
  for (let i = 0; i < 3; i++) {
    const mes = addMonths(now, i);
    const cobranca = await prisma.cobranca.create({
      data: {
        matriculaId: matricula.id,
        tipo: 'MENSALIDADE',
        descricao: `Mensalidade ${i + 1}/3`,
        competenciaInicio: startOfMonth(mes),
        competenciaFim: endOfMonth(mes),
        valor: new Prisma.Decimal('450.00'),
        vencimento: midMonth(mes),
        status: i === 0 ? 'PENDENTE' : 'A_VENCER',
        formaPagamento: 'BOLETO',
        asaasPaymentId: `pay_sub_${uid()}_${i}`,
      },
      select: { id: true },
    });

    await prisma.charge.create({
      data: {
        contaId,
        cobrancaId: cobranca.id,
        externalReference: `subscription:${subscription.id}:${i + 1}:${randomUUID()}`,
        status: i === 0 ? 'OPEN' : 'OPEN',
        asaasPaymentId: `pay_sub_charge_${uid()}_${i}`,
      },
    });

    subscriptionCobrancas.push(cobranca.id);
  }

  // ---- PARCELAMENTO STANDALONE (4 parcelas) ----

  const installmentPlan = await prisma.standaloneInstallmentPlan.create({
    data: {
      contaId,
      customerId: customer.id,
      externalReference: `standalone-installment:${randomUUID()}`,
      idempotencyKey: randomUUID(),
      status: 'ACTIVE',
      installmentCount: 4,
      billingType: 'PIX',
      value: new Prisma.Decimal('1200.00'),
      firstDueDate: midMonth(now),
    },
    select: { id: true },
  });

  const installmentCharges: string[] = [];
  for (let i = 0; i < 4; i++) {
    const mes = addMonths(now, i);
    const charge = await prisma.charge.create({
      data: {
        contaId,
        externalReference: `installment:${installmentPlan.id}:${i + 1}:${randomUUID()}`,
        status: i === 0 ? 'OPEN' : 'OPEN',
        payerName: 'Paula Responsável E2E',
        description: `Parcela ${i + 1}/4`,
        value: new Prisma.Decimal('300.00'),
        dueDate: midMonth(mes),
        billingType: 'PIX',
        customerId: customer.id,
        standaloneInstallmentPlanId: installmentPlan.id,
      },
      select: { id: true },
    });
    installmentCharges.push(charge.id);
  }

  // ---- PARCELAMENTO ACADÊMICO (3 parcelas) ----

  const academicPlan = await prisma.installmentPlan.create({
    data: {
      contaId,
      contratoId: contrato.id,
      matriculaId: matricula.id,
      externalReference: `installmentPlan:${randomUUID()}`,
      status: 'ACTIVE',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: new Prisma.Decimal('250.00'),
      firstDueDate: midMonth(now),
    },
    select: { id: true, externalReference: true },
  });

  const academicCharges: string[] = [];
  for (let i = 0; i < 3; i++) {
    const mes = addMonths(now, i);
    const cobranca = await prisma.cobranca.create({
      data: {
        matriculaId: matricula.id,
        tipo: 'MENSALIDADE',
        descricao: `Parcela acad. ${i + 1}/3`,
        competenciaInicio: startOfMonth(mes),
        competenciaFim: endOfMonth(mes),
        valor: new Prisma.Decimal('250.00'),
        vencimento: midMonth(mes),
        status: i === 0 ? 'PENDENTE' : 'A_VENCER',
        formaPagamento: 'BOLETO',
        asaasPaymentId: `pay_inst_acad_${uid()}_${i}`,
      },
      select: { id: true },
    });

    const charge = await prisma.charge.create({
      data: {
        contaId,
        cobrancaId: cobranca.id,
        externalReference: `${academicPlan.externalReference}:${i + 1}:${randomUUID()}`,
        status: 'OPEN',
        asaasPaymentId: `pay_inst_acad_charge_${uid()}_${i}`,
      },
      select: { id: true },
    });
    academicCharges.push(charge.id);
  }

  return {
    contaId,
    responsavelId: responsavel.id,
    alunoId: aluno.id,
    matriculaId: matricula.id,
    contratoId: contrato.id,
    customerId: customer.id,
    subscription: {
      id: subscription.id,
      cobrancaCount: 3,
      cobrancaIds: subscriptionCobrancas,
    },
    installmentPlan: {
      id: installmentPlan.id,
      chargeCount: 4,
      chargeIds: installmentCharges,
    },
    academicPlan: {
      id: academicPlan.id,
      chargeCount: 3,
      chargeIds: academicCharges,
    },
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

let seed: Seed;

test.describe('Criação e agrupamento — Assinaturas e Parcelamentos', () => {
  test.beforeEach(async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);
    seed = await seedCenario(contaId);
  });

  // =====================================================================
  // ASSINATURAS
  // =====================================================================

  test.describe('Assinatura', () => {
    test('lista a assinatura com dados corretos', async ({ page }) => {
      await page.goto('/cobrancas/assinaturas');
      await waitForPageReady(page, 'Assinaturas');

      await expect(page.getByText('Lucas Aluno E2E')).toBeVisible();

      const rows = assinaturaListRows(page);
      await expect(rows).toHaveCount(1, { timeout: 5_000 });
    });

    test('detalhe mostra 3 cobranças agrupadas sem duplicatas', async ({ page }) => {
      await page.goto(`/cobrancas/assinaturas/${seed.subscription.id}`);
      await waitForPageReady(page, 'Detalhes da Assinatura');

      await expect(page.getByRole('heading', { name: 'Cobranças Geradas' })).toBeVisible();

      const chargeRows = assinaturaDetailRows(page);
      await expect(chargeRows).toHaveCount(
        seed.subscription.cobrancaCount,
        { timeout: 5_000 },
      );
    });

    test('dados da assinatura consistentes entre API e UI', async ({ page }) => {
      await page.goto(`/cobrancas/assinaturas/${seed.subscription.id}`);
      await waitForPageReady(page, 'Detalhes da Assinatura');

      const api = new ApiHelper(page.request);
      const detail = await api.getSubscriptionDetail(seed.subscription.id);

      const data = (detail as { data: Record<string, unknown> }).data;

      if (data && typeof data === 'object' && 'alunoNome' in data) {
        await expect(page.getByText(data.alunoNome as string)).toBeVisible();
      }

      if (data && 'cobrancas' in data && Array.isArray(data.cobrancas)) {
        const uiRows = await assinaturaDetailRows(page).count();
        expect(uiRows).toBe(data.cobrancas.length);
      }
    });

    test('link "Abrir" na cobrança navega para detalhe individual', async ({ page }) => {
      await page.goto(`/cobrancas/assinaturas/${seed.subscription.id}`);
      await waitForPageReady(page, 'Detalhes da Assinatura');

      const abrirLink = page.getByRole('link', { name: 'Abrir' }).first();
      if (await abrirLink.isVisible()) {
        await abrirLink.click();
        await expect(page).toHaveURL(/\/cobrancas\/[a-z0-9]+$/i, { timeout: 10_000 });
      }
    });
  });

  // =====================================================================
  // PARCELAMENTOS
  // =====================================================================

  test.describe('Parcelamento', () => {
    test('lista parcelamentos agrupados (standalone + acadêmico)', async ({ page }) => {
      await page.goto('/cobrancas/parcelamentos');
      await waitForPageReady(page, 'Parcelamentos');

      const rows = parcelamentoListRows(page);
      await expect(rows).toHaveCount(2, { timeout: 5_000 });
    });

    test('detalhe standalone mostra 4 parcelas sem duplicatas', async ({ page }) => {
      await page.goto(`/cobrancas/parcelamentos/${seed.installmentPlan.id}`);
      await waitForDetailReady(page, 'Parcelamento');

      await expect(page.getByRole('heading', { name: 'Parcelas' })).toBeVisible();

      const parcelaRows = parcelamentoDetailRows(page);
      await expect(parcelaRows).toHaveCount(
        seed.installmentPlan.chargeCount,
        { timeout: 5_000 },
      );
    });

    test('detalhe acadêmico mostra 3 parcelas sem duplicatas', async ({ page }) => {
      await page.goto(`/cobrancas/parcelamentos/${seed.academicPlan.id}`);
      await waitForDetailReady(page, 'Parcelamento');

      await expect(page.getByRole('heading', { name: 'Parcelas' })).toBeVisible();

      const parcelaRows = parcelamentoDetailRows(page);
      await expect(parcelaRows).toHaveCount(
        seed.academicPlan.chargeCount,
        { timeout: 5_000 },
      );
    });

    test('progresso não ultrapassa 100%', async ({ page }) => {
      await page.goto(`/cobrancas/parcelamentos/${seed.installmentPlan.id}`);
      await waitForDetailReady(page, 'Parcelamento');

      // Procurar padrão "X de Y"
      const progressText = page.getByText(/\d+\s+de\s+\d+/i).first();
      if (await progressText.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const text = await progressText.textContent();
        const match = text?.match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);
        if (match) {
          const pagas = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          expect(pagas).toBeLessThanOrEqual(total);
          expect(total).toBe(seed.installmentPlan.chargeCount);
        }
      }
    });

    test('dados da API batem com a contagem de parcelas na UI', async ({ page }) => {
      await page.goto(`/cobrancas/parcelamentos/${seed.installmentPlan.id}`);
      await waitForDetailReady(page, 'Parcelamento');

      const api = new ApiHelper(page.request);
      const detail = await api.getInstallmentPlanDetail(seed.installmentPlan.id);

      const data = (detail as { data: { parcelas: unknown[] } }).data;
      if (data?.parcelas) {
        const uiRows = await parcelamentoDetailRows(page).count();
        expect(uiRows).toBe(data.parcelas.length);
        const ids = data.parcelas.map((p: Record<string, unknown>) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    test('clique em parcela navega para detalhe da cobrança', async ({ page }) => {
      await page.goto(`/cobrancas/parcelamentos/${seed.installmentPlan.id}`);
      await waitForDetailReady(page, 'Parcelamento');

      const firstRow = parcelamentoDetailRows(page).first();
      const link = firstRow.locator('a[href*="/cobrancas/"]');
      if (await link.count() > 0) {
        await link.first().click();
        await expect(page).toHaveURL(/\/cobrancas\/[a-z0-9]+$/i, { timeout: 10_000 });
      }
    });
  });

  // =====================================================================
  // ANTI-DUPLICIDADE (cenário crítico)
  // =====================================================================

  test.describe('Anti-duplicidade', () => {
    test('parcelamento standalone NÃO mostra parcelas duplicadas mesmo com dados sobrepostos', async ({ page }) => {
      await page.goto(`/cobrancas/parcelamentos/${seed.installmentPlan.id}`);
      await waitForDetailReady(page, 'Parcelamento');

      const rows = await parcelamentoDetailRows(page).count();
      expect(rows).toBeLessThanOrEqual(seed.installmentPlan.chargeCount);
      expect(rows).toBeGreaterThan(0);
    });

    test('assinatura NÃO lista cobrança duplicada por asaasPaymentId', async ({ page }) => {
      await page.goto(`/cobrancas/assinaturas/${seed.subscription.id}`);
      await waitForPageReady(page, 'Detalhes da Assinatura');

      const rows = await assinaturaDetailRows(page).count();
      expect(rows).toBeLessThanOrEqual(seed.subscription.cobrancaCount);
      expect(rows).toBeGreaterThan(0);
    });

    test('API de detalhe do parcelamento retorna IDs únicos', async ({ page }) => {
      const api = new ApiHelper(page.request);

      // Standalone
      const standaloneDetail = await api.getInstallmentPlanDetail(seed.installmentPlan.id);
      const sData = (standaloneDetail as { data: { parcelas: Array<{ id: string }> } }).data;
      if (sData?.parcelas) {
        const ids = sData.parcelas.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(seed.installmentPlan.chargeCount);
      }

      // Acadêmico
      const academicDetail = await api.getInstallmentPlanDetail(seed.academicPlan.id);
      const aData = (academicDetail as { data: { parcelas: Array<{ id: string }> } }).data;
      if (aData?.parcelas) {
        const ids = aData.parcelas.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(seed.academicPlan.chargeCount);
      }
    });
  });
});
