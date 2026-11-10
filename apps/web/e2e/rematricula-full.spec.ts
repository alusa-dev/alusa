import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

test.describe.configure({ mode: 'serial' });

type Seed = Awaited<ReturnType<typeof seedSchool>>;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function digits(length: number) {
  return randomUUID().replace(/\D/g, '').padEnd(length, '1').slice(0, length);
}

function dateAtNoonUtc(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function dateInputKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * ONE_DAY_MS);
}

function brl(value: unknown) {
  return Number(value ?? 0);
}

async function parseJson(response: APIResponse) {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { text, body };
}

async function expectOk(response: APIResponse) {
  const parsed = await parseJson(response);
  expect(response.ok(), parsed.text).toBeTruthy();
  return parsed.body as Record<string, any>;
}

async function expectStatus(response: APIResponse, status: number) {
  const parsed = await parseJson(response);
  expect(response.status(), parsed.text).toBe(status);
  return parsed.body as Record<string, any>;
}

async function authenticate(page: Page, seed: { userId: string; userEmail: string; contaId: string; role: string }) {
  const secret = process.env.NEXTAUTH_SECRET ?? 'testsecret';
  const token = await encode({
    secret,
    token: {
      id: seed.userId,
      email: seed.userEmail,
      name: 'Gestão E2E',
      role: seed.role,
      contaId: seed.contaId,
      authContext: 'OWNER',
      emailVerified: true,
      accountActive: true,
      sessionVersion: 0,
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
  await page.route('**/api/finance/account-status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [],
          overallStatus: 'APPROVED',
          commercialInfoStatus: 'APPROVED',
          commercialInfoScheduledDate: null,
          commercialInfoExpiration: null,
          statusLabels: {},
          lastCheckedAt: new Date().toISOString(),
        },
      }),
    });
  });
  const sessionResponse = await page.goto('/api/auth/session');
  const sessionBody = await sessionResponse?.json();
  expect(sessionBody?.user?.contaId).toBe(seed.contaId);
}

async function seedFinancialAccount(contaId: string) {
  const asaasAccountId = `acc_e2e_${randomUUID()}`;
  const profile = await prisma.financeProfile.create({
    data: {
      contaId,
      asaasAccountId,
      status: 'APPROVED',
      isOnboardingCompleted: true,
      onboardingCompletedAt: new Date(),
      wizardStep: 6,
      wizardCompletedAt: new Date(),
    },
    select: { id: true },
  });

  await prisma.asaasAccount.create({
    data: {
      financeProfileId: profile.id,
      asaasAccountId,
      externalReference: `acc-ref-${randomUUID()}`,
      status: 'APPROVED',
      // Keep local mock gate state without any credential that can reach Asaas.
      apiKeyEncrypted: null,
      apiKeyStatus: 'CONNECTED',
      operationalStatus: 'OPERATIONAL',
      webhookStatus: 'ACTIVE',
      provisionedAt: addDays(new Date(), -1),
      documentsCache: {
        version: 2,
        myAccountStatus: {
          general: 'APPROVED',
          documentation: 'APPROVED',
          bankAccountInfo: 'APPROVED',
          commercialInfo: 'APPROVED',
        },
        groups: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(),
    },
  });
}

async function seedSchool(options: { role?: string } = {}) {
  await resetDb(prisma);

  const role = options.role ?? 'ADMIN';
  const now = new Date();
  const currentContractEnd = addDays(now, 14);
  const currentContractStart = new Date(currentContractEnd);
  currentContractStart.setUTCFullYear(currentContractStart.getUTCFullYear() - 1);
  const targetYear = currentContractEnd.getUTCFullYear() + 1;
  const targetPeriodId = String(targetYear);
  const futureStartKey = `${targetYear}-01-05`;
  const futureEndKey = `${targetYear}-12-31`;
  const futureExtendedEndKey = `${targetYear + 1}-01-31`;

  const conta = await prisma.conta.create({
    data: {
      nome: `Alusa E2E Rematrícula ${randomUUID().slice(0, 8)}`,
      cpfCnpj: digits(14),
      financeStatus: 'FINANCE_APPROVED',
      externalAsaasOnboardingStatus: 'READY',
    },
    select: { id: true },
  });

  await prisma.platformBillingAccount.create({
    data: {
      contaId: conta.id,
      environment: 'TEST',
      status: 'TRIALING',
      planCode: 'STARTER',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      paymentMethodStatus: 'UNKNOWN',
    },
  });

  const userEmail = `gestao-rematricula-${randomUUID()}@e2e.alusa`;
  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Gestão E2E',
      email: userEmail,
      senhaHash: 'hash_nao_usado_no_e2e',
      role,
      status: 'ATIVO',
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });

  await prisma.usuarioConta.create({
    data: {
      contaId: conta.id,
      usuarioId: user.id,
      role,
      status: 'ATIVO',
      lastAccessedAt: new Date(),
    },
  });
  await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: user.id } });
  await prisma.authCredential.create({
    data: {
      context: 'OWNER',
      normalizedEmail: userEmail.toLowerCase(),
      userId: user.id,
      passwordHash: 'not-used-e2e',
      emailVerifiedAt: new Date(),
    },
  });
  await seedFinancialAccount(conta.id);

  const modalidade = await prisma.modalidade.create({
    data: { contaId: conta.id, nome: `Ballet E2E ${randomUUID().slice(0, 6)}`, status: 'ATIVO' },
    select: { id: true },
  });
  const sourceCycle = await prisma.cicloAcademico.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
      nome: String(currentContractEnd.getUTCFullYear()),
      sequencia: 1,
      dataInicio: dateAtNoonUtc(`${currentContractEnd.getUTCFullYear()}-01-01`),
      dataFim: dateAtNoonUtc(`${currentContractEnd.getUTCFullYear()}-12-31`),
    },
    select: { id: true },
  });
  const targetCycle = await prisma.cicloAcademico.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
      nome: targetPeriodId,
      sequencia: 2,
      dataInicio: dateAtNoonUtc(`${targetYear}-01-01`),
      dataFim: dateAtNoonUtc(`${targetYear}-12-31`),
    },
    select: { id: true },
  });
  const sala = await prisma.sala.create({
    data: { contaId: conta.id, nome: `Sala E2E ${randomUUID().slice(0, 6)}`, capacidade: 50 },
    select: { id: true },
  });

  const currentClass = await prisma.turma.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
      cicloAcademicoId: sourceCycle.id,
      salaId: sala.id,
      nome: 'Ballet Clássico - Matutino',
      diasSemana: ['SEGUNDA', 'QUARTA'],
      horaInicio: '09:00',
      horaFim: '10:00',
      capacidade: 30,
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });

  const nextCycleClass = await prisma.turma.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
      cicloAcademicoId: targetCycle.id,
      salaId: sala.id,
      nome: 'Ballet Clássico - Próximo Ciclo',
      diasSemana: ['TERCA', 'QUINTA'],
      horaInicio: '15:00',
      horaFim: '16:00',
      capacidade: 30,
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });

  const afternoonClass = await prisma.turma.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
      cicloAcademicoId: targetCycle.id,
      salaId: sala.id,
      nome: 'Ballet Clássico - Vespertino',
      diasSemana: ['TERCA', 'QUINTA'],
      horaInicio: '15:00',
      horaFim: '16:00',
      capacidade: 30,
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });

  const fullClass = await prisma.turma.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
      cicloAcademicoId: targetCycle.id,
      salaId: sala.id,
      nome: 'Ballet Lotado E2E',
      diasSemana: ['SEXTA'],
      horaInicio: '17:00',
      horaFim: '18:00',
      capacidade: 1,
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });

  const planBasic = await prisma.plano.create({
    data: { contaId: conta.id, nome: 'Plano Básico - Individual', valor: 150, periodicidade: 'MENSAL', status: 'ATIVO' },
    select: { id: true, nome: true },
  });
  const planAnnual = await prisma.plano.create({
    data: { contaId: conta.id, nome: 'Plano Anual E2E', valor: 1800, periodicidade: 'ANUAL', status: 'ATIVO' },
    select: { id: true, nome: true },
  });
  const planFamily = await prisma.plano.create({
    data: { contaId: conta.id, nome: 'Plano Familiar E2E', valor: 300, periodicidade: 'MENSAL', status: 'ATIVO' },
    select: { id: true, nome: true },
  });

  const contractModel = await prisma.contratoModelo.create({
    data: {
      contaId: conta.id,
      nome: 'Modelo Padrão Rematrícula E2E',
      arquivoPdfUrl: 'https://example.com/modelo-rematricula.pdf',
      hashSha256: `hash-${randomUUID()}`,
      versao: 1,
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });
  const alternateContractModel = await prisma.contratoModelo.create({
    data: {
      contaId: conta.id,
      nome: 'Modelo Alternativo Rematrícula E2E',
      arquivoPdfUrl: 'https://example.com/modelo-rematricula-alt.pdf',
      hashSha256: `hash-${randomUUID()}`,
      versao: 1,
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });
  await prisma.contratoModeloCampo.createMany({
    data: [contractModel.id, alternateContractModel.id].flatMap((modeloId) => [
      {
        contaId: conta.id,
        modeloId,
        tipo: 'ASSINATURA',
        papel: 'ESCOLA',
        pagina: 1,
        x: 10,
        y: 10,
        largura: 20,
        altura: 10,
        obrigatorio: true,
        ordem: 0,
      },
      {
        contaId: conta.id,
        modeloId,
        tipo: 'ASSINATURA',
        papel: 'RESPONSAVEL_OU_ALUNO',
        pagina: 1,
        x: 40,
        y: 10,
        largura: 20,
        altura: 10,
        obrigatorio: true,
        ordem: 1,
      },
    ]),
  });

  async function enrollmentForAluno(input: {
    nome: string;
    responsavelId?: string | null;
    turmaId?: string;
    planoId?: string;
    dataFimContrato?: Date;
  }) {
    const aluno = await prisma.aluno.create({
      data: {
        contaId: conta.id,
        nome: input.nome,
        cpf: digits(11),
        dataNasc: new Date('2012-05-10T12:00:00.000Z'),
        foto: `https://example.com/fotos/${encodeURIComponent(input.nome)}.png`,
        status: 'ATIVO',
      },
      select: { id: true, nome: true },
    });

    const matricula = await prisma.matricula.create({
      data: {
        contaId: conta.id,
        alunoId: aluno.id,
        responsavelFinanceiroId: input.responsavelId ?? null,
        turmaId: input.turmaId ?? currentClass.id,
        planoId: input.planoId ?? planBasic.id,
        dataInicio: currentContractStart,
        dataFimContrato: input.dataFimContrato ?? currentContractEnd,
        status: 'ATIVA',
        statusFinanceiro: 'ADIMPLENTE',
        statusContrato: 'ATIVO',
        taxaMatricula: 150,
        taxaStatus: 'PENDENTE',
        taxaIsenta: false,
        formaPagamento: 'BOLETO',
        formaPagamentoTaxa: 'PIX',
        vencimentoDia: 5,
        multaPercentual: 2,
        jurosMensal: 1,
        descontoAntecipado: 5,
        prazoDesconto: 7,
      },
      select: { id: true },
    });

    await prisma.matriculaVinculoAcademico.create({
      data: {
        contaId: conta.id,
        matriculaId: matricula.id,
        modalidadeId: modalidade.id,
        cicloAcademicoId: sourceCycle.id,
        vigenciaIniciadaEm: currentContractStart,
        classificacao: 'PRIMEIRO_INGRESSO',
        classificacaoOrigem: 'AUTOMATICA',
        classificacaoMotivo: 'PRIMEIRO_VINCULO',
      },
    });

    await prisma.cobranca.create({
      data: {
        contaId: conta.id,
        matriculaId: matricula.id,
        tipo: 'MENSALIDADE',
        descricao: `Mensalidade atual de ${input.nome}`,
        competenciaInicio: currentContractStart,
        competenciaFim: currentContractEnd,
        vencimento: addDays(new Date(), 7),
        valor: 150,
        valorFinal: 150,
        formaPagamento: 'BOLETO',
        status: 'A_VENCER',
      },
    });

    return { aluno, matriculaId: matricula.id };
  }

  const breno = await enrollmentForAluno({ nome: 'Breno de Alencar Bezerra' });
  const bryan = await enrollmentForAluno({ nome: 'Bryan de Alencar Bezerra' });
  const keison = await enrollmentForAluno({ nome: 'Keison de Alencar Bezerra' });

  const responsavel = await prisma.responsavel.create({
    data: {
      contaId: conta.id,
      nome: 'Maria Lúcia Gomes de Alencar',
      cpf: digits(11),
      email: `maria-lucia-${randomUUID()}@e2e.alusa`,
      telefone: '11999990000',
      financeiro: true,
      foto: 'https://example.com/fotos/maria-lucia.png',
    },
    select: { id: true, nome: true },
  });

  const davi = await enrollmentForAluno({ nome: 'Davi Oliveira de Souza', responsavelId: responsavel.id, planoId: planFamily.id });
  const fernanda = await enrollmentForAluno({ nome: 'Fernanda Souza de Costa', responsavelId: responsavel.id, planoId: planFamily.id });
  const nicole = await enrollmentForAluno({ nome: 'Nicole de Alencar Bezerra', responsavelId: responsavel.id, planoId: planFamily.id });

  for (const alunoId of [davi.aluno.id, fernanda.aluno.id, nicole.aluno.id]) {
    await prisma.alunoResponsavel.create({
      data: {
        contaId: conta.id,
        alunoId,
        responsavelId: responsavel.id,
        tipoVinculo: 'RESPONSAVEL_FINANCEIRO',
      },
    });
  }

  await enrollmentForAluno({
    nome: 'Aluno Ocupante Turma Lotada',
    turmaId: fullClass.id,
    dataFimContrato: dateAtNoonUtc(`${targetYear}-11-30`),
  });

  return {
    contaId: conta.id,
    userId: user.id,
    userEmail: user.email,
    role,
    targetPeriodId,
    futureStartKey,
    futureEndKey,
    futureExtendedEndKey,
    currentContractEndKey: dateInputKey(currentContractEnd),
    cycles: { source: sourceCycle.id, target: targetCycle.id },
    classes: { current: currentClass, nextCycle: nextCycleClass, afternoon: afternoonClass, full: fullClass },
    plans: { basic: planBasic, annual: planAnnual, family: planFamily },
    contractModels: { default: contractModel, alternate: alternateContractModel },
    enrollments: {
      breno: breno.matriculaId,
      bryan: bryan.matriculaId,
      keison: keison.matriculaId,
      davi: davi.matriculaId,
      fernanda: fernanda.matriculaId,
      nicole: nicole.matriculaId,
    },
    alunos: {
      breno: breno.aluno.id,
      bryan: bryan.aluno.id,
      keison: keison.aluno.id,
      davi: davi.aluno.id,
      fernanda: fernanda.aluno.id,
      nicole: nicole.aluno.id,
    },
    responsavel,
  };
}

async function setupAuthenticatedPage(page: Page, options: { role?: string } = {}) {
  const seed = await seedSchool(options);
  await authenticate(page, seed);
  return seed;
}

async function createCampaign(page: Page, seed: Seed, overrides: Record<string, unknown> = {}) {
  const response = await page.request.post('/api/rematriculas/campanhas', {
    data: {
      nome: `Rematrículas ${seed.targetPeriodId}`,
      descricao: 'Campanha E2E para próximo ciclo',
      targetPeriodId: seed.targetPeriodId,
      campaignStartsAt: new Date().toISOString(),
      campaignEndsAt: null,
      audienceDefinition: { diasAntecedencia: 365 },
      ...overrides,
    },
  });
  const body = await expectOk(response);
  return body.campaign as { id: string; nome: string; targetPeriodId: string; status: string };
}

async function createIndividualRenewal(
  page: Page,
  seed: Seed,
  input: {
    matriculaId: string;
    campaignId?: string | null;
    turmaId?: string;
    planoId?: string;
    contractModelId?: string | null;
    dataInicio?: string;
    dataFimContrato?: string;
    taxaIsenta?: boolean;
    taxaMatricula?: number;
    vencimentoDia?: number;
    targetPeriodId?: string;
    comboId?: string;
    uiRequestId?: string;
  },
) {
  const response = await page.request.post('/api/rematriculas', {
    data: {
      matriculaId: input.matriculaId,
      campaignId: input.campaignId ?? null,
      targetPeriodId: input.targetPeriodId ?? seed.targetPeriodId,
      comboId: input.comboId,
      uiRequestId: input.uiRequestId,
      planoId: input.planoId ?? seed.plans.basic.id,
      turmaId: input.turmaId ?? seed.classes.nextCycle.id,
      contractModelId: input.contractModelId ?? seed.contractModels.default.id,
      dataInicio: input.dataInicio ?? seed.futureStartKey,
      dataFimContrato: input.dataFimContrato ?? seed.futureEndKey,
      formaPagamento: 'BOLETO',
      formaPagamentoTaxa: 'PIX',
      vencimentoDia: input.vencimentoDia ?? 5,
      taxaIsenta: input.taxaIsenta ?? false,
      taxaMatricula: input.taxaMatricula ?? 120,
      taxaJustificativa: input.taxaIsenta ? 'Isenção administrativa E2E' : undefined,
      multaPercentual: 2,
      jurosMensal: 1,
      descontoAntecipado: 4,
      prazoDesconto: 6,
    },
  });
  return { response, body: await parseJson(response) };
}

async function latestProcessForEnrollment(contaId: string, matriculaOrigemId: string) {
  return prisma.rematriculaProcesso.findFirstOrThrow({
    where: { contaId, itens: { some: { matriculaOrigemId } } },
    orderBy: { createdAt: 'desc' },
    include: {
      itens: { include: { matriculaFutura: true, matriculaOrigem: true } },
      reservas: true,
      contratos: true,
      financeiros: true,
    },
  });
}

test.beforeAll(async () => {
  if (process.env.ASAAS_API_KEY !== 'E2E_BLOCKED_NO_PROVIDER_CREDENTIAL') {
    throw new Error('E2E exige o sentinel local sem credencial de provedor.');
  }
  if (process.env.ASAAS_BASE_URL !== 'https://127.0.0.1:1/v3') {
    throw new Error('E2E exige ASAAS_BASE_URL local para bloquear tráfego de saída.');
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('bloqueia acesso sem autenticação e mostra estados básicos autenticados', async ({ page }) => {
  await resetDb(prisma);

  await page.goto('/reenrollments');
  await expect(page).toHaveURL(/auth|login/);

  const seed = await setupAuthenticatedPage(page);
  await page.goto('/reenrollments');
  await expect(page.getByRole('heading', { name: 'Gestão de Rematrículas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campanhas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Todos os processos' })).toBeVisible();
  await expect(page.getByText('Nenhuma campanha encontrada')).toBeVisible();

  await page.getByRole('button', { name: 'Criar campanha' }).click();
  const modal = page.getByRole('dialog', { name: 'Criar campanha' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Criar campanha' })).toBeDisabled();
  await expect(modal.getByText('Nome da campanha')).toBeVisible();
  await expect(modal.getByText('Período de destino')).toBeVisible();
  const targetYearSelect = modal.getByRole('combobox', { name: 'Período de destino' });
  await targetYearSelect.click();
  const currentYear = new Date().getFullYear();
  await expect(page.getByRole('option', { name: String(currentYear) })).toBeVisible();
  await page.getByRole('option', { name: String(currentYear + 1) }).click();
  await expect(targetYearSelect).toContainText(String(currentYear + 1));

  const response = await page.request.get(`/api/rematriculas?contaId=${seed.contaId}&diasAntecedencia=365`);
  const body = await expectOk(response);
  expect(body.itens.length).toBeGreaterThanOrEqual(6);
});

test('cria, edita, valida janela e arquiva campanhas sem vazar para outra conta', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);

  const invalid = await page.request.post('/api/rematriculas/campanhas', {
    data: {
      nome: 'Campanha inválida',
      targetPeriodId: seed.targetPeriodId,
      campaignStartsAt: `${seed.targetPeriodId}-08-10`,
      campaignEndsAt: `${seed.targetPeriodId}-08-01`,
      status: 'ACTIVE',
    },
  });
  await expectStatus(invalid, 422);

  const campaign = await createCampaign(page, seed, { nome: 'Rematrículas Antecipadas E2E' });
  expect(campaign.status).toBe('ACTIVE');
  const update = await page.request.patch(`/api/rematriculas/campanhas/${campaign.id}`, {
    data: {
      nome: 'Rematrículas Antecipadas Editada',
      descricao: 'Descrição alterada pelo E2E',
      campaignStartsAt: new Date().toISOString(),
      campaignEndsAt: null,
    },
  });
  await expectOk(update);

  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  const listResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/rematriculas' && response.request().method() === 'GET',
  );
  await page.goto('/reenrollments');
  const listResponse = await listResponsePromise;
  const listBody = await listResponse.json().catch(() => null);
  expect(listResponse.status(), JSON.stringify({ body: listBody, browserErrors })).toBe(200);
  await expect(page.getByText('Rematrículas Antecipadas Editada')).toBeVisible();
  const campaignRow = page.getByRole('row').filter({ hasText: 'Rematrículas Antecipadas Editada' });
  await expect(campaignRow.getByRole('cell').nth(1)).toHaveText('0');

  const hardDelete = await page.request.delete(`/api/rematriculas/campanhas/${campaign.id}`);
  await expect(await hardDelete.json()).toMatchObject({ mode: 'HARD_DELETE' });
  await expect(prisma.rematriculaCampanha.findUnique({ where: { id: campaign.id } })).resolves.toBeNull();
  await expect(
    prisma.rematriculaAuditLog.findMany({ where: { contaId: seed.contaId, campanhaId: campaign.id } }),
  ).resolves.toEqual([]);

  const campaignWithHistory = await createCampaign(page, seed, { nome: 'Rematrículas com histórico E2E' });
  const activate = await page.request.post(`/api/rematriculas/campanhas/${campaignWithHistory.id}/activate`);
  await expectOk(activate);

  const softDelete = await page.request.delete(`/api/rematriculas/campanhas/${campaignWithHistory.id}`);
  await expect(await softDelete.json()).toMatchObject({ mode: 'SOFT_DELETE' });

  const deleted = await prisma.rematriculaCampanha.findUniqueOrThrow({ where: { id: campaignWithHistory.id } });
  expect(deleted.status).toBe('DELETED');
  await expect(
    prisma.rematriculaAuditLog.findMany({ where: { contaId: seed.contaId, campanhaId: campaignWithHistory.id } }),
  ).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: 'CAMPAIGN_CREATED' }),
      expect.objectContaining({ action: 'CAMPAIGN_ACTIVATED' }),
      expect.objectContaining({ action: 'CAMPAIGN_DELETED' }),
    ]),
  );
});

test('cria campanha semestral pela UI preservando targetPeriodId no backend', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  await page.goto('/reenrollments');
  await page.getByRole('button', { name: 'Criar campanha' }).click();
  const dialog = page.getByRole('dialog');
  const target = dialog.getByRole('combobox', { name: 'Período de destino' });
  await target.click();
  const targetYear = Number(seed.targetPeriodId) + 1;
  await page.getByRole('option', { name: `${targetYear} · 2º semestre` }).click();
  await dialog.getByPlaceholder('Ex.: Rematrículas 2027').fill('Campanha semestral E2E');
  await dialog.getByRole('button', { name: 'Criar campanha' }).click();
  await expect(page.getByText('Campanha semestral E2E')).toBeVisible();
  await expect(prisma.rematriculaCampanha.findFirst({
    where: { contaId: seed.contaId, nome: 'Campanha semestral E2E' },
    select: { targetPeriodId: true },
  })).resolves.toEqual({ targetPeriodId: `${targetYear}.2` });
});

test('rematricula até ciclo semestral YYYY.2 cria matrícula futura vinculada ao ciclo', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const targetYear = Number(seed.targetPeriodId) + 1;
  const targetPeriodId = `${targetYear}.2`;
  const sourceCycle = await prisma.cicloAcademico.create({
    data: {
      contaId: seed.contaId,
      modalidadeId: (await prisma.matriculaVinculoAcademico.findFirstOrThrow({
        where: { contaId: seed.contaId, matriculaId: seed.enrollments.breno }, select: { modalidadeId: true },
      })).modalidadeId,
      nome: `${targetYear}.1`,
      sequencia: 3,
      dataInicio: dateAtNoonUtc(`${targetYear}-01-01`),
      dataFim: dateAtNoonUtc(`${targetYear}-06-30`),
    },
    select: { id: true, modalidadeId: true },
  });
  const targetCycle = await prisma.cicloAcademico.create({
    data: {
      contaId: seed.contaId,
      modalidadeId: sourceCycle.modalidadeId,
      nome: targetPeriodId,
      sequencia: 4,
      dataInicio: dateAtNoonUtc(`${targetYear}-07-01`),
      dataFim: dateAtNoonUtc(`${targetYear}-12-31`),
    },
    select: { id: true },
  });
  const classRoom = await prisma.turma.findFirstOrThrow({
    where: { contaId: seed.contaId, cicloAcademicoId: seed.cycles.target }, select: { salaId: true },
  });
  const semesterClass = await prisma.turma.create({
    data: {
      contaId: seed.contaId,
      modalidadeId: sourceCycle.modalidadeId,
      cicloAcademicoId: targetCycle.id,
      salaId: classRoom.salaId,
      nome: `Ballet ${targetPeriodId}`,
      diasSemana: ['SEGUNDA'],
      horaInicio: '09:00',
      horaFim: '10:00',
      capacidade: 30,
      status: 'ATIVO',
    },
    select: { id: true },
  });
  await prisma.matriculaVinculoAcademico.updateMany({
    where: { contaId: seed.contaId, matriculaId: seed.enrollments.breno },
    data: { cicloAcademicoId: sourceCycle.id },
  });
  const campaign = await createCampaign(page, seed, { targetPeriodId, nome: `Campanha ${targetPeriodId}` });
  const start = `${targetYear}-07-01`;
  const end = `${targetYear}-12-31`;
  const result = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.breno,
    campaignId: campaign.id,
    targetPeriodId,
    turmaId: semesterClass.id,
    dataInicio: start,
    dataFimContrato: end,
  });
  expect(result.response.status(), result.body.text).toBe(200);
  const futureId = result.body.body.novaMatricula?.id as string | undefined;
  expect(futureId).toBeTruthy();
  await expect(prisma.rematriculaItem.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaFuturaId: futureId! },
    select: { targetPeriodId: true },
  })).resolves.toEqual({ targetPeriodId });
  await expect(prisma.matriculaVinculoAcademico.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaId: futureId! },
    select: { cicloAcademicoId: true, classificacao: true, vigenciaIniciadaEm: true },
  })).resolves.toEqual({
    cicloAcademicoId: targetCycle.id,
    classificacao: 'REMATRICULA',
    vigenciaIniciadaEm: null,
  });
});

test('renovação de combo persiste vínculos por modalidade e classificação independente', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const campaign = await createCampaign(page, seed);
  const modality = await prisma.modalidade.create({
    data: { contaId: seed.contaId, nome: `Teatro combo ${randomUUID().slice(0, 6)}`, status: 'ATIVO' },
    select: { id: true },
  });
  const cycle = await prisma.cicloAcademico.create({
    data: {
      contaId: seed.contaId,
      modalidadeId: modality.id,
      nome: seed.targetPeriodId,
      sequencia: 1,
      dataInicio: dateAtNoonUtc(`${seed.targetPeriodId}-01-01`),
      dataFim: dateAtNoonUtc(`${seed.targetPeriodId}-12-31`),
    },
    select: { id: true },
  });
  await prisma.historicoAcademicoCobertura.create({
    data: {
      contaId: seed.contaId,
      modalidadeId: modality.id,
      coberturaDesde: dateAtNoonUtc('2000-01-01'),
      revisadoPor: seed.userId,
      motivo: 'Histórico conferido para comprovar novo curso no combo de rematrícula.',
      revisadoEm: new Date(),
    },
  });
  const existingClass = await prisma.turma.findFirstOrThrow({
    where: { contaId: seed.contaId, cicloAcademicoId: seed.cycles.target },
    select: { salaId: true },
  });
  const theaterClass = await prisma.turma.create({
    data: {
      contaId: seed.contaId,
      modalidadeId: modality.id,
      cicloAcademicoId: cycle.id,
      salaId: existingClass.salaId,
      nome: `Teatro ${seed.targetPeriodId}`,
      diasSemana: ['TERCA'],
      horaInicio: '10:00',
      horaFim: '11:00',
      capacidade: 30,
      status: 'ATIVO',
    },
    select: { id: true },
  });
  const combo = await prisma.combo.create({
    data: {
      contaId: seed.contaId,
      nome: `Combo Ballet Teatro ${randomUUID().slice(0, 6)}`,
      valor: 250,
      periodicidade: 'MENSAL',
    },
    select: { id: true },
  });
  await prisma.comboTurma.createMany({
    data: [seed.classes.nextCycle.id, theaterClass.id].map((turmaId) => ({ contaId: seed.contaId, comboId: combo.id, turmaId })),
  });

  const created = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.breno,
    campaignId: campaign.id,
    comboId: combo.id,
  });
  expect(created.response.status(), created.body.text).toBe(200);
  const futureId = created.body.body.novaMatricula?.id as string | undefined;
  expect(futureId).toBeTruthy();
  const links = await prisma.matriculaVinculoAcademico.findMany({
    where: { contaId: seed.contaId, matriculaId: futureId! },
    select: { modalidadeId: true, cicloAcademicoId: true, classificacao: true },
  });
  expect(links).toHaveLength(2);
  expect(links).toEqual(expect.arrayContaining([
    expect.objectContaining({
      modalidadeId: (await prisma.matriculaVinculoAcademico.findFirstOrThrow({
        where: { contaId: seed.contaId, matriculaId: seed.enrollments.breno }, select: { modalidadeId: true },
      })).modalidadeId,
      cicloAcademicoId: seed.cycles.target,
      classificacao: 'REMATRICULA',
    }),
    expect.objectContaining({ modalidadeId: modality.id, cicloAcademicoId: cycle.id, classificacao: 'PRIMEIRO_INGRESSO' }),
  ]));
});

test('realiza rematrícula individual pela campanha e preserva ciclo financeiro atual', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const campaign = await createCampaign(page, seed);
  const beforeCharges = await prisma.cobranca.findMany({
    where: { matriculaId: seed.enrollments.breno },
    select: { id: true, status: true, valor: true },
  });

  await page.goto(`/reenrollments/campaigns/${campaign.id}`);
  await expect(page.getByRole('heading', { name: 'Detalhes da Campanha' })).toBeVisible();
  const sessionResponse = await page.request.get('/api/auth/session');
  const sessionBody = await sessionResponse.json();
  expect(sessionBody?.user?.contaId).toBe(seed.contaId);
  await page.getByRole('button', { name: 'Rematricular' }).click();
  const searchModal = page.getByRole('dialog', { name: 'Rematricular' });
  await expect(searchModal).toBeVisible();
  await searchModal.getByPlaceholder('Buscar aluno ou responsável').fill('Breno');
  await page.getByRole('option', { name: /Breno de Alencar Bezerra/ }).click();
  await searchModal.getByRole('button', { name: 'Confirmar' }).click();

  const renewalModal = page.getByTestId('rematricula-dialog');
  await expect(renewalModal).toBeVisible();
  await renewalModal.locator('input[type="date"]').nth(0).fill(seed.futureStartKey);
  await renewalModal.locator('input[type="date"]').nth(1).fill(seed.futureEndKey);
  await renewalModal.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: /Ballet Clássico - Próximo Ciclo/ }).click();
  await renewalModal.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: seed.contractModels.default.nome }).click();
  const previewResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/rematriculas/preview' &&
      response.request().method() === 'POST',
  );
  const saveResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/rematriculas' &&
      response.request().method() === 'POST',
  );
  await renewalModal.getByRole('button', { name: 'Salvar' }).click();
  const previewResponse = await previewResponsePromise;
  const previewBody = await previewResponse.json();
  expect(previewResponse.status(), JSON.stringify(previewBody)).toBe(200);
  expect(previewBody.blockers, JSON.stringify(previewBody)).toEqual([]);
  const saveResponse = await saveResponsePromise;
  const saveBody = await saveResponse.text();
  const saveRequestBody = saveResponse.request().postData();
  expect(saveResponse.ok(), `${saveBody}\n\nrequest=${saveRequestBody}`).toBeTruthy();
  await expect(renewalModal).toBeHidden({ timeout: 20_000 });

  // This route renders the campaign's class/occupancy overview after save;
  // the created process and its scheduled state are verified from Prisma below.
  await expect(page.getByText('Ballet Clássico - Próximo Ciclo')).toBeVisible();
  await expect(page.getByText('SCHEDULED')).toHaveCount(0);

  const renewalProcess = await latestProcessForEnrollment(seed.contaId, seed.enrollments.breno);
  expect(renewalProcess.status).toBe('WAITING_FOR_START');
  expect(renewalProcess.origin).toBe('CAMPAIGN');
  expect(renewalProcess.campanhaId).toBe(campaign.id);
  expect(renewalProcess.renewCount).toBe(1);
  expect(brl(renewalProcess.monthlyTotal)).toBe(150);

  const item = renewalProcess.itens[0]!;
  expect(item.matriculaFuturaId).toBeTruthy();
  expect(item.matriculaFutura?.status).toBe('AGUARDANDO_CONFIRMACAO');
  expect(item.matriculaFutura?.rematriculadaDeId).toBe(seed.enrollments.breno);
  const futureAcademicLink = await prisma.matriculaVinculoAcademico.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaId: item.matriculaFuturaId! },
  });
  expect(futureAcademicLink).toMatchObject({
    cicloAcademicoId: seed.cycles.target,
    classificacao: 'REMATRICULA',
  });
  expect(futureAcademicLink.vigenciaIniciadaEm).toBeNull();
  expect(item.matriculaOrigem.status).toBe('ATIVA');
  expect(renewalProcess.reservas[0]?.status).toBe('RESERVED');
  expect(renewalProcess.contratos[0]?.status).toBe('WAITING_SIGNATURE');
  expect(renewalProcess.contratos[0]?.contractModelId).toBe(seed.contractModels.default.id);
  expect(renewalProcess.financeiros[0]?.status).toBe('SCHEDULED');
  expect(brl(renewalProcess.financeiros[0]?.enrollmentFeeTotal)).toBe(150);

  const afterCharges = await prisma.cobranca.findMany({
    where: { matriculaId: seed.enrollments.breno },
    select: { id: true, status: true, valor: true },
  });
  expect(afterCharges.map((charge) => ({ id: charge.id, status: charge.status, valor: brl(charge.valor) }))).toEqual(
    beforeCharges.map((charge) => ({ id: charge.id, status: charge.status, valor: brl(charge.valor) })),
  );

  await page.getByRole('button', { name: 'Rematricular' }).click();
  await page.getByPlaceholder('Buscar aluno ou responsável').fill('Breno');
  await expect(page.getByText('Nenhum aluno ou responsável encontrado')).toBeVisible();
});

test('abre detalhes em modal e edita próximo ciclo salvando dados futuros coerentes', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const campaign = await createCampaign(page, seed);
  const created = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.bryan,
    campaignId: campaign.id,
  });
  expect(created.response.ok(), created.body.text).toBeTruthy();

  await page.goto('/reenrollments');
  await page.getByRole('button', { name: 'Todos os processos' }).click();
  const row = page.locator('tr', { hasText: 'Bryan de Alencar Bezerra' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Rematrículas 2027')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Pendências' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Período' })).toHaveCount(0);
  await row.getByRole('button', { name: /Ações do processo/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalhes' }).click();
  const details = page.getByRole('dialog', { name: 'Detalhes da rematrícula' });
  await expect(details).toBeVisible();
  await expect(details.getByText('Próximo ciclo')).toBeVisible();
  await expect(page).toHaveURL(/\/rematriculas$/);
  await details.getByRole('button', { name: 'Fechar' }).click();

  await row.getByRole('button', { name: /Ações do processo/ }).click();
  await page.getByRole('menuitem', { name: 'Editar próximo ciclo' }).click();
  const edit = page.getByTestId('rematricula-dialog');
  await expect(edit).toBeVisible();
  await expect(edit.getByText('Editar próximo ciclo')).toBeVisible();
  await expect(edit.locator('input').first()).toHaveValue('Bryan de Alencar Bezerra');
  await edit
    .getByRole('textbox', { name: 'Explique por que o próximo ciclo está sendo alterado.' })
    .fill('Alteração administrativa validada pelo E2E.');
  const contractEndInput = edit.locator('input[type="date"]').nth(1);
  await contractEndInput.fill(seed.futureExtendedEndKey);
  await expect(contractEndInput).toHaveValue(seed.futureExtendedEndKey);
  const dueDayInput = edit.locator('input[type="number"]').first();
  await dueDayInput.fill('12');
  await expect(dueDayInput).toHaveValue('12');
  await edit.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: seed.contractModels.alternate.nome }).click();
  const editResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/rematriculas/') &&
      response.url().includes('/future-link') &&
      response.request().method() === 'PATCH',
  );
  await edit.getByRole('button', { name: 'Salvar alterações' }).click();
  const editResponse = await editResponsePromise;
  const editResponseBody = await editResponse.text();
  const editRequestBody = editResponse.request().postData();
  expect(editResponse.ok(), `${editResponseBody}\n\nrequest=${editRequestBody}`).toBeTruthy();
  await expect(edit).toBeHidden({ timeout: 20_000 });

  const renewalProcess = await latestProcessForEnrollment(seed.contaId, seed.enrollments.bryan);
  const item = process.itens[0]!;
  expect(dateInputKey(item.matriculaFutura!.dataFimContrato)).toBe(seed.futureExtendedEndKey);
  expect(item.matriculaFutura!.vencimentoDia).toBe(12);
  expect(process.contratos[0]?.contractModelId).toBe(seed.contractModels.alternate.id);
  expect(process.contratos[0]?.status).toBe('WAITING_SIGNATURE');
  expect(process.financeiros[0]?.status).toBe('SCHEDULED');
  expect(process.financeiros[0]?.firstDueDate?.getUTCDate()).toBe(12);
  expect(process.itens[0]?.matriculaOrigem.status).toBe('ATIVA');

  const audit = await prisma.rematriculaAuditLog.findFirst({
    where: { contaId: seed.contaId, processoId: process.id, action: 'FUTURE_LINK_UPDATED' },
  });
  expect(audit?.reason).toContain('Alteração administrativa');
});

test('exige motivo ao cancelar, cancela artefatos futuros e permite nova rematrícula', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const created = await createIndividualRenewal(page, seed, { matriculaId: seed.enrollments.bryan });
  expect(created.response.ok(), created.body.text).toBeTruthy();
  const firstProcess = await latestProcessForEnrollment(seed.contaId, seed.enrollments.bryan);

  const blocked = await page.request.post(`/api/rematriculas/${firstProcess.id}/cancel`, { data: { reason: '' } });
  await expectStatus(blocked, 422);

  await page.goto('/reenrollments');
  await page.getByRole('button', { name: 'Todos os processos' }).click();
  await expect(page.getByText('Bryan de Alencar Bezerra')).toBeVisible();
  const row = page.locator('tr', { hasText: 'Bryan de Alencar Bezerra' }).first();
  await row.getByRole('button', { name: /Ações do processo/ }).click();
  await page.getByRole('menuitem', { name: 'Cancelar futuro' }).click();
  const cancelDialog = page.getByRole('alertdialog', { name: 'Cancelar próximo ciclo' });
  await expect(cancelDialog).toBeVisible();
  await expect(cancelDialog.getByRole('button', { name: 'Cancelar futuro' })).toBeDisabled();
  await cancelDialog.locator('textarea').fill('Responsável solicitou troca de datas antes de confirmar.');
  await cancelDialog.getByRole('button', { name: 'Cancelar futuro' }).click();
  await expect(cancelDialog).toBeHidden({ timeout: 20_000 });

  const cancelled = await prisma.rematriculaProcesso.findUniqueOrThrow({
    where: { id: firstProcess.id },
    include: { itens: true, reservas: true, contratos: true, financeiros: true },
  });
  expect(cancelled.status).toBe('CANCELLED');
  expect(cancelled.itens.every((item) => item.status === 'CANCELLED')).toBe(true);
  expect(cancelled.reservas.every((item) => item.status === 'CANCELLED')).toBe(true);
  expect(cancelled.contratos.every((item) => item.status === 'CANCELLED')).toBe(true);
  expect(cancelled.financeiros.every((item) => item.status === 'CANCELLED')).toBe(true);

  const repeated = await createIndividualRenewal(page, seed, { matriculaId: seed.enrollments.bryan });
  expect(repeated.response.ok(), repeated.body.text).toBeTruthy();
  const activeProcesses = await prisma.rematriculaProcesso.findMany({
    where: {
      contaId: seed.contaId,
      status: { not: 'CANCELLED' },
      itens: { some: { matriculaOrigemId: seed.enrollments.bryan, targetPeriodId: seed.targetPeriodId } },
    },
  });
  expect(activeProcesses).toHaveLength(1);
  expect(activeProcesses[0]!.id).not.toBe(firstProcess.id);
});

test('rematrícula familiar parcial gera apenas vínculos renovados e financeiro único do responsável', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const campaign = await createCampaign(page, seed);

  const familyPayload = {
      campaignId: campaign.id,
      targetPeriodId: seed.targetPeriodId,
      responsavelId: seed.responsavel.id,
      dataInicio: seed.futureStartKey,
      dataFimContrato: seed.futureEndKey,
      formaPagamento: 'BOLETO',
      formaPagamentoTaxa: 'PIX',
      vencimentoDia: 10,
      taxaMatricula: 80,
      taxaIsenta: false,
      contratoModeloId: seed.contractModels.default.id,
      uiRequestId: `family-${randomUUID()}`,
      itens: [
        {
          matriculaId: seed.enrollments.davi,
          decision: 'REMATRICULAR_AGORA',
          turmaId: seed.classes.nextCycle.id,
          planoId: seed.plans.basic.id,
        },
        {
          matriculaId: seed.enrollments.fernanda,
          decision: 'NAO_CONTINUARA',
          decisionReason: 'Família decidiu não renovar este vínculo.',
        },
        {
          matriculaId: seed.enrollments.nicole,
          decision: 'DECIDIR_DEPOIS',
          decisionReason: 'Decisão pendente da família.',
        },
      ],
    };
  const [response, concurrentReplay] = await Promise.all([
    page.request.post('/api/rematriculas/familiar', { data: familyPayload }),
    page.request.post('/api/rematriculas/familiar', { data: familyPayload }),
  ]);
  const [firstResult, concurrentResult] = await Promise.all([
    expectStatus(response, 202),
    expectStatus(concurrentReplay, 202),
  ]);
  expect(concurrentResult.familyId).toBe(firstResult.familyId);
  const changedIntent = await page.request.post('/api/rematriculas/familiar', {
    data: { ...familyPayload, taxaMatricula: 81 },
  });
  const changedIntentBody = await expectStatus(changedIntent, 409);
  expect(changedIntentBody.error.code).toBe('IDEMPOTENCY_CONFLICT');

  const renewalProcess = await latestProcessForEnrollment(seed.contaId, seed.enrollments.davi);
  expect(renewalProcess.holderType).toBe('RESPONSIBLE');
  expect(renewalProcess.holderId).toBe(seed.responsavel.id);
  expect(renewalProcess.renewCount).toBe(1);
  expect(renewalProcess.nonRenewalCount).toBe(1);
  expect(renewalProcess.pendingCount).toBe(1);
  expect(renewalProcess.itens).toHaveLength(3);
  expect(renewalProcess.itens.filter((item) => item.matriculaFuturaId)).toHaveLength(1);
  expect(renewalProcess.itens.find((item) => item.matriculaOrigemId === seed.enrollments.fernanda)?.matriculaFuturaId).toBeNull();
  expect(renewalProcess.itens.find((item) => item.matriculaOrigemId === seed.enrollments.nicole)?.matriculaFuturaId).toBeNull();
  expect(renewalProcess.financeiros).toHaveLength(1);
  expect(renewalProcess.financeiros[0]?.responsavelId).toBe(seed.responsavel.id);
  expect(brl(renewalProcess.financeiros[0]?.monthlyTotal)).toBe(150);
  expect(renewalProcess.contratos).toHaveLength(1);
  expect(renewalProcess.reservas).toHaveLength(1);
  const renewedFutureId = renewalProcess.itens.find((item) => item.matriculaOrigemId === seed.enrollments.davi)?.matriculaFuturaId;
  expect(renewedFutureId).toBeTruthy();
  await expect(prisma.rematriculaProcesso.count({
    where: { contaId: seed.contaId, idempotencyKey: familyPayload.uiRequestId },
  })).resolves.toBe(1);
  await expect(prisma.matricula.count({
    where: { contaId: seed.contaId, rematriculadaDeId: seed.enrollments.davi },
  })).resolves.toBe(1);
  await expect(prisma.matriculaVinculoAcademico.count({
    where: { contaId: seed.contaId, matriculaId: renewedFutureId! },
  })).resolves.toBe(1);
  await expect(prisma.matriculaVinculoAcademico.findFirst({
    where: { contaId: seed.contaId, matriculaId: renewedFutureId! },
    select: { modalidadeId: true, cicloAcademicoId: true, classificacao: true, vigenciaIniciadaEm: true },
  })).resolves.toEqual({
    modalidadeId: (await prisma.matriculaVinculoAcademico.findFirstOrThrow({
      where: { contaId: seed.contaId, matriculaId: seed.enrollments.davi }, select: { modalidadeId: true },
    })).modalidadeId,
    cicloAcademicoId: seed.cycles.target,
    classificacao: 'REMATRICULA',
    vigenciaIniciadaEm: null,
  });

  const effectiveStart = new Date(`${seed.futureStartKey}T00:00:00.000Z`);
  const sourceContractEnd = new Date(effectiveStart);
  sourceContractEnd.setUTCDate(sourceContractEnd.getUTCDate() - 1);
  await prisma.matricula.update({
    where: { id: seed.enrollments.davi },
    data: { dataFimContrato: sourceContractEnd },
  });
  await prisma.contratoFuturo.updateMany({
    where: { contaId: seed.contaId, processoId: renewalProcess.id },
    data: { status: 'SIGNED_SCHEDULED', signedAt: new Date() },
  });
  await prisma.acordoFinanceiroFuturo.updateMany({
    where: { contaId: seed.contaId, processoId: renewalProcess.id },
    data: { status: 'ACTIVE' },
  });
  const activationNow = new Date(effectiveStart);
  activationNow.setUTCDate(activationNow.getUTCDate() + 1);
  const activation = await page.request.post(
    `/api/jobs/rematriculas/activate?contaId=${seed.contaId}&now=${encodeURIComponent(activationNow.toISOString())}`,
    { headers: { 'x-cron-token': process.env.CRON_SECRET ?? 'test-cron-secret' } },
  );
  const activationBody = await expectOk(activation);
  expect(activationBody.processed).toBeGreaterThanOrEqual(1);

  const replayAfterActivation = await page.request.post('/api/rematriculas/familiar', { data: familyPayload });
  const activatedReplay = await expectStatus(replayAfterActivation, 202);
  expect(activatedReplay.status).toBe('EFFECTIVE');
  expect(activatedReplay.step).toBe('CYCLE_EFFECTIVE');
  expect(activatedReplay.academicStatus).toBe('ATIVA');
  expect(activatedReplay.targetBillingStatus).toBe('ACTIVE');
  expect(activatedReplay.contractStatus).toBe('ACTIVE');
  expect(activatedReplay.results.find((item: { matriculaId: string }) => item.matriculaId === seed.enrollments.davi)?.status).toBe('success');

  const stillActive = await prisma.matricula.findMany({
    where: { id: { in: [seed.enrollments.fernanda, seed.enrollments.nicole] } },
    select: { id: true, status: true },
  });
  expect(stillActive.every((item) => item.status === 'ATIVA')).toBe(true);
});

test('replay individual idêntico é idempotente e reutilização divergente da chave conflita', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const intent = { matriculaId: seed.enrollments.breno, uiRequestId: `individual-${randomUUID()}` };
  const first = await createIndividualRenewal(page, seed, intent);
  expect(first.response.status(), first.body.text).toBe(200);
  const replay = await createIndividualRenewal(page, seed, intent);
  expect(replay.response.status(), replay.body.text).toBe(200);
  const futureId = first.body.body.novaMatricula?.id as string;

  await expect(prisma.rematriculaProcesso.count({
    where: { contaId: seed.contaId, idempotencyKey: intent.uiRequestId },
  })).resolves.toBe(1);
  await expect(prisma.matricula.count({
    where: { contaId: seed.contaId, rematriculadaDeId: seed.enrollments.breno },
  })).resolves.toBe(1);
  await expect(prisma.matriculaVinculoAcademico.count({
    where: { contaId: seed.contaId, matriculaId: futureId },
  })).resolves.toBe(1);

  const changed = await createIndividualRenewal(page, seed, {
    ...intent,
    taxaMatricula: 121,
  });
  const conflict = await expectStatus(changed.response, 409);
  expect(conflict.error.code).toBe('IDEMPOTENCY_CONFLICT');
  await expect(prisma.rematriculaProcesso.count({
    where: { contaId: seed.contaId, idempotencyKey: intent.uiRequestId },
  })).resolves.toBe(1);
  await expect(prisma.matricula.count({
    where: { contaId: seed.contaId, rematriculadaDeId: seed.enrollments.breno },
  })).resolves.toBe(1);
  await expect(prisma.matriculaVinculoAcademico.count({
    where: { contaId: seed.contaId, matriculaId: futureId },
  })).resolves.toBe(1);
});

test('bloqueia duplicidade ativa, capacidade lotada e isolamento multi-tenant', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const first = await createIndividualRenewal(page, seed, { matriculaId: seed.enrollments.breno });
  expect(first.response.ok(), first.body.text).toBeTruthy();

  const duplicate = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.breno,
    turmaId: seed.classes.afternoon.id,
    planoId: seed.plans.annual.id,
  });
  await expectStatus(duplicate.response, 422);
  expect(duplicate.body.text).toContain('Já existe rematrícula ativa');

  const fullClass = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.keison,
    turmaId: seed.classes.full.id,
  });
  await expectStatus(fullClass.response, 422);
  expect(fullClass.body.text).toContain('não possui vagas disponíveis');

  const other = await prisma.conta.create({
    data: { nome: 'Outra conta E2E', cpfCnpj: digits(14) },
    select: { id: true },
  });
  const cross = await page.request.post('/api/rematriculas/campanhas', {
    data: {
      contaId: other.id,
      nome: 'Campanha Cross Tenant',
      targetPeriodId: seed.targetPeriodId,
      campaignStartsAt: new Date().toISOString(),
      status: 'ACTIVE',
    },
  });
  await expectStatus(cross, 201);
  const created = (await parseJson(cross)).body as Record<string, any>;
  const campaign = await prisma.rematriculaCampanha.findUniqueOrThrow({ where: { id: created.campaign.id } });
  expect(campaign.contaId).toBe(seed.contaId);
});

test('efetiva processo vencido pelo job sem alterar cobranças do ciclo atual', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const beforeChargeCount = await prisma.cobranca.count({ where: { matriculaId: seed.enrollments.bryan } });
  await prisma.matricula.update({
    where: { id: seed.enrollments.bryan },
    data: { dataFimContrato: addDays(new Date(), -1) },
  });
  const created = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.bryan,
    dataInicio: dateInputKey(addDays(new Date(), 1)),
    dataFimContrato: dateInputKey(addDays(new Date(), 370)),
  });
  expect(created.response.ok(), created.body.text).toBeTruthy();
  const renewalProcess = await latestProcessForEnrollment(seed.contaId, seed.enrollments.bryan);

  // The activation job requires an already signed future contract and
  // provisioned future finance; satisfy those persisted prerequisites without
  // invoking an external provider in this test.
  await prisma.contratoFuturo.updateMany({
    where: { contaId: seed.contaId, processoId: renewalProcess.id },
    data: { status: 'SIGNED_SCHEDULED', signedAt: new Date() },
  });
  await prisma.acordoFinanceiroFuturo.updateMany({
    where: { contaId: seed.contaId, processoId: renewalProcess.id },
    data: { status: 'ACTIVE' },
  });

  const activate = await page.request.post(
    `/api/jobs/rematriculas/activate?contaId=${seed.contaId}&now=${encodeURIComponent(addDays(new Date(), 2).toISOString())}`,
    { headers: { 'x-cron-token': process.env.CRON_SECRET ?? 'test-cron-secret' } },
  );
  const body = await expectOk(activate);
  expect(body.processed).toBeGreaterThanOrEqual(1);

  const effective = await prisma.rematriculaProcesso.findUniqueOrThrow({
    where: { id: renewalProcess.id },
    include: { itens: { include: { matriculaOrigem: true, matriculaFutura: true } }, reservas: true, contratos: true, financeiros: true },
  });
  expect(effective.status).toBe('EFFECTIVE');
  expect(effective.itens[0]?.matriculaOrigem.status).toBe('ENCERRADA');
  expect(effective.itens[0]?.matriculaFutura?.status).toBe('ATIVA');
  const academicLink = await prisma.matriculaVinculoAcademico.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaId: effective.itens[0]!.matriculaFuturaId! },
    select: { vigenciaIniciadaEm: true },
  });
  expect(academicLink.vigenciaIniciadaEm).not.toBeNull();
  const firstActivationTimestamp = academicLink.vigenciaIniciadaEm?.getTime();
  expect(effective.reservas[0]?.status).toBe('CONVERTED');
  expect(effective.contratos[0]?.status).toBe('ACTIVE');
  expect(effective.financeiros[0]?.status).toBe('ACTIVE');

  const replayActivation = await page.request.post(
    `/api/jobs/rematriculas/activate?contaId=${seed.contaId}&now=${encodeURIComponent(addDays(new Date(), 3).toISOString())}`,
    { headers: { 'x-cron-token': process.env.CRON_SECRET ?? 'test-cron-secret' } },
  );
  const replayBody = await expectOk(replayActivation);
  expect(replayBody.processed).toBe(0);
  const linkAfterReplay = await prisma.matriculaVinculoAcademico.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaId: effective.itens[0]!.matriculaFuturaId! },
    select: { vigenciaIniciadaEm: true },
  });
  expect(linkAfterReplay.vigenciaIniciadaEm?.getTime()).toBe(firstActivationTimestamp);
  await expect(prisma.cobranca.count({ where: { matriculaId: seed.enrollments.bryan } })).resolves.toBe(beforeChargeCount);
});

test('permissões negam operações críticas para usuário sem papel operacional', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page, { role: 'PROFESSOR' });

  await page.goto('/reenrollments');
  await expect(page.getByRole('heading', { name: 'Gestão de Rematrículas' })).toBeVisible();

  const create = await page.request.post('/api/rematriculas/campanhas', {
    data: {
      nome: 'Campanha sem permissão',
      targetPeriodId: seed.targetPeriodId,
      campaignStartsAt: new Date().toISOString(),
      status: 'ACTIVE',
    },
  });
  await expectStatus(create, 403);

  const renew = await createIndividualRenewal(page, seed, { matriculaId: seed.enrollments.breno });
  await expectStatus(renew.response, 403);
});
