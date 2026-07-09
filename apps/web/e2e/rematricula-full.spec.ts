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

function legacyEncryptedSecret(value: string) {
  return `v1:${Buffer.from(value, 'utf8').toString('base64')}`;
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
      emailVerified: true,
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
      apiKeyEncrypted: legacyEncryptedSecret('$aact_hmlg_e2e_key'),
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

  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Gestão E2E',
      email: `gestao-rematricula-${randomUUID()}@e2e.alusa`,
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
  await seedFinancialAccount(conta.id);

  const modalidade = await prisma.modalidade.create({
    data: { contaId: conta.id, nome: `Ballet E2E ${randomUUID().slice(0, 6)}`, status: 'ATIVO' },
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

  const afternoonClass = await prisma.turma.create({
    data: {
      contaId: conta.id,
      modalidadeId: modalidade.id,
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
    classes: { current: currentClass, afternoon: afternoonClass, full: fullClass },
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
  },
) {
  const response = await page.request.post('/api/rematriculas', {
    data: {
      matriculaId: input.matriculaId,
      campaignId: input.campaignId ?? null,
      targetPeriodId: seed.targetPeriodId,
      planoId: input.planoId ?? seed.plans.basic.id,
      turmaId: input.turmaId ?? seed.classes.current.id,
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

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('bloqueia acesso sem autenticação e mostra estados básicos autenticados', async ({ page }) => {
  await resetDb(prisma);

  await page.goto('/rematriculas');
  await expect(page).toHaveURL(/auth|login/);

  const seed = await setupAuthenticatedPage(page);
  await page.goto('/rematriculas');
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

  await page.goto('/rematriculas');
  await expect(page.getByText('Rematrículas Antecipadas Editada')).toBeVisible();
  await expect(page.getByText('0 Rematriculados')).toBeVisible();

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

test('realiza rematrícula individual pela campanha e preserva ciclo financeiro atual', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page);
  const campaign = await createCampaign(page, seed);
  const beforeCharges = await prisma.cobranca.findMany({
    where: { matriculaId: seed.enrollments.breno },
    select: { id: true, status: true, valor: true },
  });

  await page.goto(`/rematriculas/campanhas/${campaign.id}`);
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
  await renewalModal.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: seed.contractModels.default.nome }).click();
  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/rematriculas') &&
      response.request().method() === 'POST',
  );
  await renewalModal.getByRole('button', { name: 'Salvar' }).click();
  const saveResponse = await saveResponsePromise;
  const saveBody = await saveResponse.text();
  const saveRequestBody = saveResponse.request().postData();
  expect(saveResponse.ok(), `${saveBody}\n\nrequest=${saveRequestBody}`).toBeTruthy();
  await expect(renewalModal).toBeHidden({ timeout: 20_000 });

  await expect(page.getByText('Breno de Alencar Bezerra')).toBeVisible();
  await expect(page.getByText('Aguardando início')).toBeVisible();
  await expect(page.getByText('Agendado')).toBeVisible();
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

  await page.goto('/rematriculas');
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

  await page.goto('/rematriculas');
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

  const response = await page.request.post('/api/rematriculas/familiar', {
    data: {
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
          turmaId: seed.classes.current.id,
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
    },
  });
  await expectStatus(response, 202);

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

  const stillActive = await prisma.matricula.findMany({
    where: { id: { in: [seed.enrollments.fernanda, seed.enrollments.nicole] } },
    select: { id: true, status: true },
  });
  expect(stillActive.every((item) => item.status === 'ATIVA')).toBe(true);
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
  const created = await createIndividualRenewal(page, seed, {
    matriculaId: seed.enrollments.bryan,
    dataInicio: dateInputKey(addDays(new Date(), 1)),
    dataFimContrato: dateInputKey(addDays(new Date(), 370)),
  });
  expect(created.response.ok(), created.body.text).toBeTruthy();
  const renewalProcess = await latestProcessForEnrollment(seed.contaId, seed.enrollments.bryan);

  await prisma.matricula.update({
    where: { id: seed.enrollments.bryan },
    data: { dataFimContrato: addDays(new Date(), -1) },
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
  expect(effective.itens[0]?.matriculaOrigem.status).toBe('CANCELADA');
  expect(effective.itens[0]?.matriculaFutura?.status).toBe('ATIVA');
  expect(effective.reservas[0]?.status).toBe('CONVERTED');
  expect(effective.contratos[0]?.status).toBe('ACTIVE');
  expect(effective.financeiros[0]?.status).toBe('READY_TO_PROVISION');
  await expect(prisma.cobranca.count({ where: { matriculaId: seed.enrollments.bryan } })).resolves.toBe(beforeChargeCount);
});

test('permissões negam operações críticas para usuário sem papel operacional', async ({ page }) => {
  const seed = await setupAuthenticatedPage(page, { role: 'PROFESSOR' });

  await page.goto('/rematriculas');
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
