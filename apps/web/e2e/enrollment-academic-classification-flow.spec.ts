import { expect, test, type Page } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';
import { encryptSecret } from '@alusa/database';

import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();
test.setTimeout(180_000);
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

type Seed = {
  contaId: string;
  userId: string;
  email: string;
  balletId: string;
  theaterId: string;
  planId: string;
  contractModelId: string;
  cycles: Record<string, { ballet: string; theater: string }>;
  classes: Record<string, { ballet: string; theater: string }>;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateAtNoon(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addYears(date: Date, years: number) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function digits(length: number) {
  return randomUUID().replace(/\D/g, '').padEnd(length, '1').slice(0, length);
}

function validCpf() {
  const base = Array.from(digits(9), Number);
  const firstDigit = base.reduce((sum, digit, index) => sum + digit * (10 - index), 0) * 10 % 11;
  base.push(firstDigit === 10 ? 0 : firstDigit);
  const secondDigit = base.reduce((sum, digit, index) => sum + digit * (11 - index), 0) * 10 % 11;
  base.push(secondDigit === 10 ? 0 : secondDigit);
  return base.join('');
}

async function authenticate(
  page: Page,
  seed: Pick<Seed, 'contaId' | 'userId' | 'email'>,
  options: { hydrateClientSessionFromServer?: boolean } = {},
) {
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET ?? 'testsecret',
    token: {
      id: seed.userId,
      email: seed.email,
      name: 'Admin classificação acadêmica E2E',
      role: 'ADMIN',
      contaId: seed.contaId,
      authContext: 'OWNER',
      emailVerified: true,
      accountActive: true,
      sessionVersion: 0,
    },
  });
  await page.context().addCookies([{
    name: 'next-auth.session-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);
  const sessionResponse = await page.request.get('/api/auth/session');
  const sessionText = await sessionResponse.text();
  expect(sessionResponse.ok(), sessionText).toBe(true);
  const session = JSON.parse(sessionText) as {
    user?: { id?: string; role?: string; contaId?: string; authContext?: string };
    expires?: string;
  };
  expect(session.user).toMatchObject({
    id: seed.userId,
    role: 'ADMIN',
    contaId: seed.contaId,
    authContext: 'OWNER',
  });
  if (options.hydrateClientSessionFromServer) {
    // Replay only the real authenticated session payload for client hydration.
    // All protected API calls still use and validate the actual JWT cookie.
    await page.route('**/api/auth/session', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(session),
      });
    });
  }
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
}

async function seedSchool(page: Page, options: { hydrateClientSessionFromServer?: boolean } = {}): Promise<Seed> {
  const conta = await prisma.conta.create({
    data: {
      nome: `Classificação acadêmica E2E ${randomUUID().slice(0, 8)}`,
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
      trialEndsAt: addYears(new Date(), 1),
      paymentMethodStatus: 'UNKNOWN',
    },
  });

  const email = `academic-classification-${randomUUID()}@e2e.alusa`;
  const user = await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Admin classificação acadêmica E2E',
      email,
      senhaHash: 'not-used-e2e',
      role: 'ADMIN',
      status: 'ATIVO',
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.usuarioConta.create({
    data: { contaId: conta.id, usuarioId: user.id, role: 'ADMIN', status: 'ATIVO', lastAccessedAt: new Date() },
  });
  await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: user.id } });
  await prisma.authCredential.create({
    data: {
      context: 'OWNER',
      normalizedEmail: email.toLowerCase(),
      userId: user.id,
      passwordHash: 'not-used-e2e',
      emailVerifiedAt: new Date(),
    },
  });

  const asaasAccountId = `acc_e2e_${randomUUID()}`;
  const financeProfile = await prisma.financeProfile.create({
    data: {
      contaId: conta.id,
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
      financeProfileId: financeProfile.id,
      asaasAccountId,
      externalReference: `academic-classification-${randomUUID()}`,
      status: 'APPROVED',
      // Decrypts only to the synthetic key accepted by Playwright's loopback
      // Asaas stub; no sandbox or production credential is used by this test.
      apiKeyEncrypted: encryptSecret('E2E_SYNTHETIC_ASAAS_KEY'),
      apiKeyStatus: 'CONNECTED',
      operationalStatus: 'OPERATIONAL',
      webhookStatus: 'ACTIVE',
      provisionedAt: new Date(Date.now() - 60_000),
    },
  });

  const seedIdentity = { contaId: conta.id, userId: user.id, email };
  await authenticate(page, seedIdentity, options);

  const modalities = await Promise.all([
    prisma.modalidade.create({ data: { contaId: conta.id, nome: 'Ballet E2E', status: 'ATIVO' }, select: { id: true } }),
    prisma.modalidade.create({ data: { contaId: conta.id, nome: 'Teatro E2E', status: 'ATIVO' }, select: { id: true } }),
  ]);
  const [ballet, theater] = modalities;
  const cycles: Seed['cycles'] = {};
  const cycleYears = [2024, 2025, 2026, 2027];
  for (const [index, year] of cycleYears.entries()) {
    const [balletCycle, theaterCycle] = await Promise.all([
      prisma.cicloAcademico.create({ data: { contaId: conta.id, modalidadeId: ballet.id, nome: String(year), sequencia: index + 1, dataInicio: dateAtNoon(`${year}-01-01`), dataFim: dateAtNoon(`${year}-12-31`) }, select: { id: true } }),
      prisma.cicloAcademico.create({ data: { contaId: conta.id, modalidadeId: theater.id, nome: String(year), sequencia: index + 1, dataInicio: dateAtNoon(`${year}-01-01`), dataFim: dateAtNoon(`${year}-12-31`) }, select: { id: true } }),
    ]);
    cycles[String(year)] = { ballet: balletCycle.id, theater: theaterCycle.id };
  }

  for (const modalidadeId of [ballet.id, theater.id]) {
    await prisma.historicoAcademicoCobertura.create({
      data: { contaId: conta.id, modalidadeId, coberturaDesde: dateAtNoon('2000-01-01'), revisadoPor: user.id, revisadoEm: new Date(), motivo: 'Histórico integral conferido para o cenário E2E.' },
    });
    await prisma.historicoAcademicoCoberturaAudit.create({
      data: { contaId: conta.id, modalidadeId, coberturaDesdeAnterior: null, coberturaDesdeNova: dateAtNoon('2000-01-01'), motivo: 'Histórico integral conferido para o cenário E2E.', autorId: user.id },
    });
  }

  const room = await prisma.sala.create({
    data: { contaId: conta.id, nome: 'Sala acadêmica E2E', capacidade: 50, status: 'ATIVO' },
    select: { id: true },
  });
  const classes: Seed['classes'] = {};
  for (const year of cycleYears) {
    for (const [course, modalidadeId] of [['ballet', ballet.id], ['theater', theater.id]] as const) {
      const created = await prisma.turma.create({
        data: {
          contaId: conta.id,
          modalidadeId,
          cicloAcademicoId: cycles[String(year)][course],
          salaId: room.id,
          nome: `${course === 'ballet' ? 'Ballet' : 'Teatro'} ${year}`,
          diasSemana: ['SEGUNDA'],
          horaInicio: `${String(8 + year % 6).padStart(2, '0')}:00`,
          horaFim: `${String(9 + year % 6).padStart(2, '0')}:00`,
          capacidade: 50,
          status: 'ATIVO',
        },
        select: { id: true },
      });
      classes[String(year)] ??= { ballet: '', theater: '' };
      classes[String(year)][course] = created.id;
    }
  }

  const plan = await prisma.plano.create({
    data: { contaId: conta.id, nome: 'Plano E2E', valor: 100, periodicidade: 'MENSAL', status: 'ATIVO' },
    select: { id: true },
  });
  const model = await prisma.contratoModelo.create({
    data: {
      contaId: conta.id,
      nome: 'Contrato E2E classificação',
      arquivoPdfUrl: 'https://example.test/contract.pdf',
      hashSha256: `academic-${randomUUID()}`,
      versao: 1,
      status: 'ATIVO',
    },
    select: { id: true },
  });
  await prisma.contratoModeloCampo.createMany({
    data: [
      { contaId: conta.id, modeloId: model.id, tipo: 'ASSINATURA', papel: 'ESCOLA', pagina: 1, x: 10, y: 10, largura: 20, altura: 10, obrigatorio: true, ordem: 0 },
      { contaId: conta.id, modeloId: model.id, tipo: 'ASSINATURA', papel: 'RESPONSAVEL_OU_ALUNO', pagina: 1, x: 40, y: 10, largura: 20, altura: 10, obrigatorio: true, ordem: 1 },
    ],
  });

  const seed: Seed = {
    contaId: conta.id,
    userId: user.id,
    email,
    balletId: ballet.id,
    theaterId: theater.id,
    planId: plan.id,
    contractModelId: model.id,
    cycles,
    classes,
  };
  return seed;
}

async function createStudent(seed: Seed, name: string) {
  return prisma.aluno.create({
    data: {
      contaId: seed.contaId,
      nome: name,
      cpf: validCpf(),
      dataNasc: new Date('1990-05-10T12:00:00.000Z'),
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });
}

async function createAdministrativeUiEnrollment(seed: Seed, input: {
  studentId: string;
  course: 'ballet' | 'theater';
  year: 2025 | 2026;
  status: 'ATIVA' | 'PAUSADA';
}) {
  const today = new Date();
  const enrollment = await prisma.matricula.create({
    data: {
      contaId: seed.contaId,
      alunoId: input.studentId,
      turmaId: seed.classes[String(input.year)][input.course],
      planoId: seed.planId,
      dataInicio: input.year === 2025 ? dateAtNoon('2025-01-15') : dateAtNoon(dateKey(today)),
      dataFimContrato: input.year === 2025 ? dateAtNoon('2025-12-15') : dateAtNoon(dateKey(addYears(today, 1))),
      status: input.status,
      statusFinanceiro: input.status === 'PAUSADA' ? 'SUSPENSO' : 'ADIMPLENTE',
      statusContrato: 'AGUARDANDO_ASSINATURA',
      taxaMatricula: new Prisma.Decimal(0),
      taxaIsenta: true,
      taxaStatus: 'ISENTO',
      ...(input.status === 'PAUSADA' ? {
        pausaAtiva: true,
        dataInicioPausa: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
        dataRetornoPrevista: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
        manterVaga: true,
        cobrarDurantePausa: false,
        motivoPausa: 'Pausa vencida para teste E2E administrativo.',
        asaasSubscriptionId: null,
      } : {}),
      uiRequestId: `academic-admin-ui-${randomUUID()}`,
    },
    select: { id: true },
  });
  const link = await prisma.matriculaVinculoAcademico.create({
    data: {
      contaId: seed.contaId,
      matriculaId: enrollment.id,
      modalidadeId: input.course === 'ballet' ? seed.balletId : seed.theaterId,
      cicloAcademicoId: seed.cycles[String(input.year)][input.course],
      vigenciaIniciadaEm: input.year === 2025 ? dateAtNoon('2025-01-15') : dateAtNoon(dateKey(today)),
      classificacao: 'HISTORICO_INDETERMINADO',
      classificacaoOrigem: 'AUTOMATICA',
      classificacaoMotivo: 'HISTORICO_PRE_MIGRACAO_NAO_RECONSTRUIDO',
    },
    select: { id: true },
  });
  await prisma.matriculaTurma.create({
    data: { contaId: seed.contaId, matriculaId: enrollment.id, turmaId: seed.classes[String(input.year)][input.course] },
  });
  if (input.status === 'PAUSADA') {
    await prisma.matriculaOperacao.create({
      data: {
        contaId: seed.contaId,
        matriculaId: enrollment.id,
        tipo: 'PAUSA',
        origem: 'USER',
        status: 'SINCRONIZADO',
        actorId: seed.userId,
        observacao: 'Pausa vencida criada para o fluxo E2E administrativo.',
      },
    });
  }
  return { enrollmentId: enrollment.id, linkId: link.id };
}

async function openAdminEnrollmentActions(page: Page, enrollmentId: string, classId: string) {
  await page.goto(`/enrollments/class/${classId}`);
  const actions = page.getByTestId(`matricula-actions-${enrollmentId}`);
  await expect(actions).toBeVisible({ timeout: 15_000 });
  await actions.click();
}

async function createHistoricalEnrollment(seed: Seed, input: {
  studentId: string;
  course: 'ballet' | 'theater';
  year: 2024 | 2025 | 2026 | 2027;
  status?: 'ENCERRADA' | 'CANCELADA' | 'ATIVA';
  canceledAt?: Date;
  includeAcademicLink?: boolean;
}) {
  const yearStart = dateAtNoon(`${input.year}-01-01`);
  const enrollment = await prisma.matricula.create({
    data: {
      contaId: seed.contaId,
      alunoId: input.studentId,
      turmaId: seed.classes[String(input.year)][input.course],
      planoId: seed.planId,
      dataInicio: yearStart,
      dataFimContrato: dateAtNoon(`${input.year}-12-31`),
      status: input.status ?? 'ENCERRADA',
      ...(input.canceledAt ? { cancelledAt: input.canceledAt } : {}),
      statusFinanceiro: 'ADIMPLENTE',
      statusContrato: 'ATIVO',
      taxaMatricula: new Prisma.Decimal(0),
      taxaIsenta: true,
      uiRequestId: `academic-history-${randomUUID()}`,
    },
    select: { id: true },
  });
  if (input.includeAcademicLink !== false) {
    await prisma.matriculaVinculoAcademico.create({
      data: {
        contaId: seed.contaId,
        matriculaId: enrollment.id,
        modalidadeId: input.course === 'ballet' ? seed.balletId : seed.theaterId,
        cicloAcademicoId: seed.cycles[String(input.year)][input.course],
        vigenciaIniciadaEm: yearStart,
        classificacao: 'PRIMEIRO_INGRESSO',
        classificacaoOrigem: 'AUTOMATICA',
        classificacaoMotivo: 'PRIMEIRO_VINCULO',
      },
    });
  }
  return enrollment.id;
}

async function createEffectiveLink(seed: Seed, input: Parameters<typeof createHistoricalEnrollment>[1]) {
  const matriculaId = await createHistoricalEnrollment(seed, input);
  return prisma.matriculaVinculoAcademico.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaId },
    select: { id: true, modalidadeId: true },
  });
}

async function createEnrollmentThroughApi(page: Page, seed: Seed, input: {
  studentId: string;
  course?: 'ballet' | 'theater';
  targetYear: 2026 | 2027;
  transferOriginLinkId?: string;
  comboId?: string;
  dataInicio?: string;
}) {
  const turmaId = input.comboId ? undefined : seed.classes[String(input.targetYear)][input.course ?? 'ballet'];
  const dataInicio = input.dataInicio ?? dateKey(new Date());
  const dataFimContrato = dateKey(addYears(new Date(), 1));
  const uiRequestId = `academic-e2e-${randomUUID()}`;
  const body = {
    contaId: seed.contaId,
    alunoId: input.studentId,
    planoId: seed.planId,
    ...(input.comboId ? { comboId: input.comboId } : { turmaId }),
    modeloId: seed.contractModelId,
    dataInicio,
    dataFimContrato,
    vencimentoDia: 10,
    taxaMatricula: 0,
    taxaIsenta: true,
    taxaJustificativa: 'Isenção para E2E acadêmico.',
    formaPagamento: 'BOLETO',
    formaPagamentoTaxa: 'PIX',
    pagarTaxaAgora: false,
    gerarCobrancaTaxa: false,
    criarCobranca: false,
    uiRequestId,
    billingStrategy: { kind: 'SEPARATE' },
    ...(input.transferOriginLinkId ? {
      transferenciaOrigemVinculoId: input.transferOriginLinkId,
      transferenciaMotivo: 'Transferência acadêmica validada no cenário E2E.',
    } : {}),
  };
  const preview = await page.request.post('/api/matriculas/billing-preview', {
    data: {
      contaId: seed.contaId,
      strategy: 'CREATE_SEPARATE',
      billingStrategy: body.billingStrategy,
      responsavelFinanceiroId: null,
      existingFamilyGroupId: null,
      dataInicio,
      dataFimContrato,
      formaPagamento: 'BOLETO',
      vencimentoDia: body.vencimentoDia,
      descontoIds: [],
      items: [{ alunoId: input.studentId, ...(input.comboId ? { comboId: input.comboId } : { turmaId, comboId: null }), planoId: seed.planId, taxaMatricula: 0, valorMensalidadeOverride: null }],
    },
  });
  const previewBody = await preview.json();
  expect(preview.status(), JSON.stringify(previewBody)).toBe(200);
  const response = await page.request.post('/api/matriculas', {
    data: {
      ...body,
      billingStrategy: previewBody.billingStrategy ?? body.billingStrategy,
      previewHash: previewBody.previewHash,
      sourceVersion: previewBody.sourceVersion,
      previewExpiresAt: previewBody.expiresAt,
    },
  });
  const responseBody = await response.json();
  if (response.status() !== 200) return { enrollmentId: '', responseBody, status: response.status() };
  const enrollmentId = responseBody.data?.matricula?.id ?? responseBody.matricula?.id;
  expect(enrollmentId).toBeTruthy();
  return { enrollmentId: String(enrollmentId), responseBody, status: response.status() };
}

async function expectClassification(page: Page, seed: Seed, enrollmentId: string, expected: string) {
  const response = await page.request.get(`/api/matriculas/${enrollmentId}/vinculos-academicos`);
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.data).toHaveLength(1);
  expect(body.data[0].classificacao).toBe(expected);
  const persisted = await prisma.matriculaVinculoAcademico.findFirstOrThrow({
    where: { contaId: seed.contaId, matriculaId: enrollmentId },
    select: { classificacao: true, cicloAcademicoId: true, vigenciaIniciadaEm: true },
  });
  expect(persisted.classificacao).toBe(expected);
  return body.data[0] as { id: string; classificacao: string };
}

test.beforeAll(async () => {
  const stubPort = process.env.E2E_ASAAS_STUB_PORT ?? '9443';
  if (process.env.E2E_ASAAS_STUB !== 'true') {
    throw new Error('Este spec exige o stub local Asaas via E2E_ASAAS_STUB=true.');
  }
  if (
    process.env.ASAAS_API_KEY !== 'E2E_SYNTHETIC_ASAAS_KEY' ||
    process.env.ASAAS_BASE_URL !== `https://127.0.0.1:${stubPort}/v3/`
  ) {
    throw new Error('E2E exige chave sintética e ASAAS_BASE_URL loopback do stub local.');
  }
  await resetDb(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('wizard cria matrícula imediata pela rota real com Asaas local e persiste primeiro ingresso', async ({ page }) => {
  const renderWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Maximum update depth exceeded')) {
      renderWarnings.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (error.message.includes('Maximum update depth exceeded')) renderWarnings.push(error.stack ?? error.message);
  });
  const seed = await seedSchool(page);

  await test.step('percorre a interface completa até a submissão', async () => {
    const student = await createStudent(seed, 'Primeiro Ingresso E2E');
    await page.goto('/enrollments');
    const openWizard = page.getByRole('button', { name: 'Cadastrar matrícula' });
    await expect(openWizard).toBeVisible();
    await openWizard.click();
    await page.getByTestId('modo-individual').click();
    const studentSearch = page.getByPlaceholder('Ex.: Maria Silva ou 123.456.789-00');
    await studentSearch.fill(student.nome);
    await page.getByRole('option', { name: new RegExp(student.nome) }).click();
    await page.getByTestId('wizard-next').click();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Ballet 2026/ }).click();
    await page.getByTestId('wizard-next').click();
    await page.getByRole('button', { name: 'Isentar taxa' }).click();
    await page.getByLabel('Justificativa da isenção').fill('Isenção de taxa no cenário de primeiro ingresso E2E.');
    await page.getByTestId('wizard-next').click();
    await page.getByRole('button', { name: 'Plano E2E' }).click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();

    const financeStep = page.getByText('Período do contrato');
    await expect(financeStep).toBeVisible();
    const endDateButton = page.getByRole('button', { name: 'Selecione a data' });
    await endDateButton.click();
    const calendar = page.locator('[data-slot="calendar"]');
    const yearSelect = calendar.locator('select').nth(1);
    await yearSelect.selectOption(String(new Date().getFullYear() + 1));
    const monthSelect = calendar.locator('select').nth(0);
    await monthSelect.selectOption('11');
    const endDate = dateAtNoon(`${new Date().getFullYear() + 1}-12-15`);
    await calendar.locator(`[data-day="${endDate.toLocaleDateString()}"]`).click();
    const modelSelect = page.getByRole('combobox').last();
    await modelSelect.click();
    await page.getByRole('option', { name: 'Contrato E2E classificação' }).click();
    await page.getByRole('button', { name: /^Boleto/ }).click();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByText('Confirmo que revisei todas as informações da matrícula.')).toBeVisible();
    await page.getByLabel('Confirmo que revisei todas as informações da matrícula.').check();
    const createResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/matriculas') && response.request().method() === 'POST',
    );
    await page.getByTestId('wizard-next').click();
    const response = await createResponse;
    expect(response.request().postDataJSON()).toMatchObject({ criarCobranca: true });
    const result = await response.json();
    expect(response.status(), JSON.stringify(result)).toBe(200);
    const matriculaId = result.matricula?.id;
    expect(matriculaId).toBeTruthy();
    const persisted = await prisma.matricula.findFirstOrThrow({
      where: { contaId: seed.contaId, alunoId: student.id, id: matriculaId },
      select: { id: true, status: true },
    });
    expect(persisted.status).toBe('ATIVA');
    const academicLink = await prisma.matriculaVinculoAcademico.findFirstOrThrow({
      where: { contaId: seed.contaId, matriculaId: persisted.id },
    });
    expect(academicLink).toMatchObject({
      modalidadeId: seed.balletId,
      cicloAcademicoId: seed.cycles['2026'].ballet,
      classificacao: 'PRIMEIRO_INGRESSO',
    });
    expect(academicLink.vigenciaIniciadaEm).not.toBeNull();
    console.info(`[e2e] maximum-update-depth warnings observed: ${renderWarnings.length}${renderWarnings[0] ? `; first=${renderWarnings[0]}` : ''}`);
  });
});

test('rotas reais persistem todas as classificações acadêmicas', async ({ page }) => {
  const seed = await seedSchool(page);
  const today = dateKey(new Date());
  const contractEnd = dateKey(addYears(new Date(), 1));

  await test.step('primeiro ingresso pela rota real', async () => {
    const student = await createStudent(seed, 'Primeiro Ingresso API E2E');
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'PRIMEIRO_INGRESSO');
  });

  await test.step('ciclo imediatamente seguinte continua rematrícula mesmo na entrada tardia', async () => {
    const student = await createStudent(seed, 'Entrada Tardia E2E');
    await createEffectiveLink(seed, { studentId: student.id, course: 'ballet', year: 2025 });
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'REMATRICULA');
  });

  await test.step('lacuna coberta entre ciclos classifica retorno', async () => {
    const student = await createStudent(seed, 'Retorno por lacuna E2E');
    await createEffectiveLink(seed, { studentId: student.id, course: 'ballet', year: 2024 });
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'RETORNO');
  });

  await test.step('ruptura formal prevalece sobre ciclo seguinte', async () => {
    const student = await createStudent(seed, 'Retorno por cancelamento E2E');
    const sourceId = await createHistoricalEnrollment(seed, { studentId: student.id, course: 'ballet', year: 2025, status: 'CANCELADA', canceledAt: dateAtNoon('2025-08-01') });
    await prisma.matriculaOperacao.create({
      data: {
        contaId: seed.contaId,
        matriculaId: sourceId,
        tipo: 'CANCELAMENTO',
        origem: 'USER',
        status: 'SINCRONIZADO',
        observacao: 'Desistência definitiva formalizada no cenário E2E.',
      },
    });
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'RETORNO');
  });

  await test.step('transferência formal mantém origem e classificação', async () => {
    const student = await createStudent(seed, 'Transferência E2E');
    const source = await createEffectiveLink(seed, { studentId: student.id, course: 'ballet', year: 2025 });
    const created = await createEnrollmentThroughApi(page, seed, {
      studentId: student.id,
      course: 'theater',
      targetYear: 2026,
      transferOriginLinkId: source.id,
    });
    const link = await expectClassification(page, seed, created.enrollmentId, 'TRANSFERENCIA');
    const transfer = await prisma.transferenciaAcademicaVinculo.findFirstOrThrow({
      where: { contaId: seed.contaId, origemVinculoId: source.id, destinoVinculoId: link.id },
    });
    expect(transfer.motivo).toContain('Transferência acadêmica validada');
  });

  await test.step('evidência incompleta não vira primeiro ingresso', async () => {
    const student = await createStudent(seed, 'Histórico indeterminado E2E');
    await createHistoricalEnrollment(seed, { studentId: student.id, course: 'ballet', year: 2025, includeAcademicLink: false });
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'HISTORICO_INDETERMINADO');
  });

  await test.step('classificação é independente por curso', async () => {
    const student = await createStudent(seed, 'Histórico por curso E2E');
    await createEffectiveLink(seed, { studentId: student.id, course: 'ballet', year: 2025 });
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'theater', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'PRIMEIRO_INGRESSO');
  });

  await test.step('matrícula cancelada antes da vigência não comprova estudo', async () => {
    const student = await createStudent(seed, 'Cancelado antes do início E2E');
    const attempted = await prisma.matricula.create({
      data: {
        contaId: seed.contaId,
        alunoId: student.id,
        turmaId: seed.classes['2025'].ballet,
        planoId: seed.planId,
        dataInicio: dateAtNoon('2025-03-01'),
        dataFimContrato: dateAtNoon('2025-12-31'),
        status: 'CANCELADA',
        cancelledAt: dateAtNoon('2025-02-28'),
        taxaMatricula: new Prisma.Decimal(0),
        taxaIsenta: true,
        uiRequestId: `academic-before-start-${randomUUID()}`,
      },
      select: { id: true },
    });
    await prisma.matriculaVinculoAcademico.create({
      data: {
        contaId: seed.contaId,
        matriculaId: attempted.id,
        modalidadeId: seed.balletId,
        classificacao: 'HISTORICO_INDETERMINADO',
        classificacaoMotivo: 'HISTORICO_PRE_MIGRACAO_NAO_RECONSTRUIDO',
      },
    });
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    await expectClassification(page, seed, created.enrollmentId, 'PRIMEIRO_INGRESSO');
  });

  await test.step('reativação reaproveita o vínculo acadêmico existente', async () => {
    const student = await createStudent(seed, 'Reativação E2E');
    const created = await createEnrollmentThroughApi(page, seed, { studentId: student.id, course: 'ballet', targetYear: 2026 });
    const before = await expectClassification(page, seed, created.enrollmentId, 'PRIMEIRO_INGRESSO');
    // The isolated creation request uses separate deferred billing, so establish
    // the active state required by the pause endpoint as part of this scenario's fixture.
    await prisma.matricula.update({ where: { id: created.enrollmentId }, data: { status: 'ATIVA' } });
    const pause = await page.request.post(`/api/matriculas/${created.enrollmentId}/pausar`, {
      data: {
        motivoPausa: 'Pausa temporária para validar reativação E2E.',
        dataInicioPausa: today,
        dataRetornoPrevista: contractEnd,
        manterVaga: true,
        cobrarDurantePausa: true,
      },
    });
    expect(pause.status(), await pause.text()).toBe(200);
    const reactivate = await page.request.post(`/api/matriculas/${created.enrollmentId}/reativar`, {
      data: { dataRetornoEfetiva: today, nextDueDate: contractEnd, observacao: 'Retorno da pausa no cenário E2E.' },
    });
    expect(reactivate.status(), await reactivate.text()).toBe(200);
    const links = await prisma.matriculaVinculoAcademico.findMany({
      where: { contaId: seed.contaId, matriculaId: created.enrollmentId },
      select: { id: true, classificacao: true, vigenciaIniciadaEm: true },
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: before.id, classificacao: 'PRIMEIRO_INGRESSO' });
    expect(links[0]?.vigenciaIniciadaEm).not.toBeNull();
  });

  await test.step('sem cobertura histórica, primeiro vínculo persistido fica indeterminado', async () => {
    await prisma.historicoAcademicoCobertura.deleteMany({
      where: { contaId: seed.contaId, modalidadeId: seed.balletId },
    });
    const student = await createStudent(seed, 'Sem cobertura histórica E2E');
    const created = await createEnrollmentThroughApi(page, seed, {
      studentId: student.id,
      course: 'ballet',
      targetYear: 2026,
    });
    await expectClassification(page, seed, created.enrollmentId, 'HISTORICO_INDETERMINADO');
  });
});

test('rejeita combo com dois ciclos da mesma modalidade antes de persistir matrícula', async ({ page }) => {
  const seed = await seedSchool(page);
  const student = await createStudent(seed, 'Combo com ciclos conflitantes E2E');
  const combo = await prisma.combo.create({
    data: {
      contaId: seed.contaId,
      nome: `Combo conflitante ${randomUUID()}`,
      valor: new Prisma.Decimal(200),
      periodicidade: 'MENSAL',
    },
    select: { id: true },
  });
  await prisma.comboTurma.createMany({
    data: [seed.classes['2025'].ballet, seed.classes['2026'].ballet].map((turmaId) => ({
      contaId: seed.contaId,
      comboId: combo.id,
      turmaId,
    })),
  });

  const result = await createEnrollmentThroughApi(page, seed, {
    studentId: student.id,
    targetYear: 2026,
    comboId: combo.id,
  });
  expect(result.status).toBe(409);
  expect(result.responseBody).toMatchObject({ error: { code: 'COMBO_CICLO_ACADEMICO_CONFLITANTE' } });
  expect(await prisma.matricula.count({ where: { contaId: seed.contaId, alunoId: student.id } })).toBe(0);
  expect(await prisma.matriculaVinculoAcademico.count({ where: { contaId: seed.contaId, modalidadeId: seed.balletId } })).toBe(0);
});

test('persiste classificação independente para cada modalidade de um combo válido', async ({ page }) => {
  const seed = await seedSchool(page);
  const student = await createStudent(seed, 'Combo multi modalidade E2E');
  const theaterClass = seed.classes['2027'].theater;
  const combo = await prisma.combo.create({
    data: {
      contaId: seed.contaId,
      nome: `Combo Ballet Teatro ${randomUUID()}`,
      valor: new Prisma.Decimal(200),
      periodicidade: 'MENSAL',
    },
    select: { id: true },
  });
  await prisma.comboTurma.createMany({
    data: [seed.classes['2026'].ballet, theaterClass].map((turmaId) => ({ contaId: seed.contaId, comboId: combo.id, turmaId })),
  });

  const created = await createEnrollmentThroughApi(page, seed, {
    studentId: student.id,
    targetYear: 2027,
    comboId: combo.id,
    dataInicio: '2027-01-01',
  });
  expect(created.status, JSON.stringify(created.responseBody)).toBe(200);
  const links = await prisma.matriculaVinculoAcademico.findMany({
    where: { contaId: seed.contaId, matriculaId: created.enrollmentId },
    select: { modalidadeId: true, cicloAcademicoId: true, classificacao: true },
  });
  expect(links).toHaveLength(2);
  expect(links).toEqual(expect.arrayContaining([
    expect.objectContaining({ modalidadeId: seed.balletId, cicloAcademicoId: seed.cycles['2026'].ballet, classificacao: 'PRIMEIRO_INGRESSO' }),
    expect.objectContaining({ modalidadeId: seed.theaterId, cicloAcademicoId: seed.cycles['2027'].theater, classificacao: 'PRIMEIRO_INGRESSO' }),
  ]));
});

test('ADMIN regulariza pausa vencida pela interface e decide retomar separadamente', async ({ page }) => {
  const seed = await seedSchool(page, { hydrateClientSessionFromServer: true });
  const student = await createStudent(seed, 'Pausa regularizada pela interface E2E');
  const paused = await createAdministrativeUiEnrollment(seed, {
    studentId: student.id,
    course: 'ballet',
    year: 2026,
    status: 'PAUSADA',
  });

  await openAdminEnrollmentActions(page, paused.enrollmentId, seed.classes['2026'].ballet);
  await expect(page.getByTestId(`matricula-action-regularizar-pausa-${paused.enrollmentId}`)).toBeVisible();
  await page.getByTestId(`matricula-action-regularizar-pausa-${paused.enrollmentId}`).click();
  await expect(page.getByRole('heading', { name: 'Regularizar prazo da pausa' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('O prazo venceu e o contrato está vigente.');
  await page.getByLabel('Justificativa para regularizar o prazo da pausa').fill('A instituição confirma o retorno do aluno.');

  const regularizationResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/matriculas/${paused.enrollmentId}/regularizar-pausa`) &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Regularizar prazo' }).click();
  const regularized = await regularizationResponse;
  expect(regularized.status(), await regularized.text()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Regularizar prazo da pausa' })).toHaveCount(0);
  expect(await prisma.matricula.findFirstOrThrow({
    where: { id: paused.enrollmentId, contaId: seed.contaId }, select: { status: true, pausaAtiva: true },
  })).toEqual({ status: 'PAUSADA', pausaAtiva: true });
  expect(await prisma.matriculaOperacao.count({
    where: { contaId: seed.contaId, matriculaId: paused.enrollmentId, tipo: 'REGULARIZACAO_PAUSA' },
  })).toBe(1);

  const actions = page.getByTestId(`matricula-actions-${paused.enrollmentId}`);
  await expect(actions).toBeVisible();
  await actions.click();
  await expect(page.getByTestId(`matricula-action-retomar-${paused.enrollmentId}`)).toBeVisible();
  await page.getByTestId(`matricula-action-retomar-${paused.enrollmentId}`).click();
  await expect(page.getByRole('heading', { name: 'Reativar matrícula' })).toBeVisible();
  await page.locator('#reativarRetorno').fill(dateKey(new Date()));
  await page.locator('#reativarDueDate').fill(dateKey(addYears(new Date(), 0)));

  const reactivationResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/matriculas/${paused.enrollmentId}/reativar`) &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Reativar matrícula' }).click();
  const reactivated = await reactivationResponse;
  expect(reactivated.status(), await reactivated.text()).toBe(200);
  const result = await reactivated.json();
  expect(result.data?.asaasAction ?? result.asaasAction).toBe('LOCAL_ONLY');
  expect(await prisma.matricula.findFirstOrThrow({
    where: { id: paused.enrollmentId, contaId: seed.contaId }, select: { status: true, pausaAtiva: true },
  })).toEqual({ status: 'ATIVA', pausaAtiva: false });
  expect(await prisma.matriculaVinculoAcademico.count({
    where: { contaId: seed.contaId, matriculaId: paused.enrollmentId },
  })).toBe(1);
});
