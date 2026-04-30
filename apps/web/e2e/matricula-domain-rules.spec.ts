/**
 * Testes E2E — Regras de Domínio de Matrícula (8 fases)
 *
 * Cenários cobertos:
 * 1. Máquina de estados (transições válidas/inválidas, terminais)
 * 2. Validação backend (capacidade, conflitos, datas)
 * 3. Criação de MatriculaTurma (N:N)
 * 4. Bloqueio de edição estrutural em status terminal
 * 5. Política de ativação (IMMEDIATE vs REQUIRES_PAYMENT)
 * 6. Elegibilidade de rematrícula
 * 7. Anomalia — status terminal não transiciona (via API)
 * 8. Responsável financeiro obrigatório para menor de idade
 */

import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

const prisma = new PrismaClient();

function uniqueCpfCnpj(): string {
  return String(Date.now()).slice(-14).padStart(14, '0');
}

function uniqueCpf(): string {
  return String(Date.now()).slice(-11).padStart(11, '0');
}

function futureDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function pastDate(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

interface SeedIds {
  contaId: string;
  userId: string;
  userEmail: string;
  modalidadeId: string;
  salaId: string;
  planoId: string;
  turmaId: string;
  turmaId2: string;
  alunoMaiorId: string;
  alunoMenorId: string;
  responsavelId: string;
}

async function seed(): Promise<SeedIds> {
  const contaId = randomUUID();
  const userId = randomUUID();
  const userEmail = `admin-domain-${Date.now()}@e2e.test`;

  await prisma.conta.create({
    data: { id: contaId, nome: 'E2E Domain Rules', cpfCnpj: uniqueCpfCnpj() },
  });

  await prisma.usuario.create({
    data: {
      id: userId,
      contaId,
      nome: 'Admin Domain',
      email: userEmail,
      senhaHash: 'hash',
      role: 'ADMIN',
      status: 'ATIVO',
    },
  });

  await prisma.conta.update({ where: { id: contaId }, data: { ownerUserId: userId } });

  const modalidade = await prisma.modalidade.create({
    data: { id: randomUUID(), contaId, nome: 'Mod E2E Domain', status: 'ATIVO' },
  });

  const sala = await prisma.sala.create({
    data: { id: randomUUID(), contaId, nome: 'Sala E2E Domain', capacidade: 30 },
  });

  const plano = await prisma.plano.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Plano E2E Domain',
      valor: 200,
      periodicidade: 'MENSAL',
      status: 'ATIVO',
    },
  });

  // Turma 1: Seg/Qua/Sex 08-09
  const turma = await prisma.turma.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Turma Alpha',
      modalidadeId: modalidade.id,
      salaId: sala.id,
      capacidade: 2,
      status: 'ATIVO',
      diasSemana: ['SEGUNDA', 'QUARTA', 'SEXTA'],
      horaInicio: '08:00',
      horaFim: '09:00',
    },
  });

  // Turma 2: Seg/Qua/Sex 08-09 (mesmo horário = conflito)
  const turma2 = await prisma.turma.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Turma Beta',
      modalidadeId: modalidade.id,
      salaId: sala.id,
      capacidade: 20,
      status: 'ATIVO',
      diasSemana: ['SEGUNDA', 'QUARTA', 'SEXTA'],
      horaInicio: '08:00',
      horaFim: '09:00',
    },
  });

  const responsavel = await prisma.responsavel.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Resp Domain E2E',
      cpf: uniqueCpf(),
      email: `resp-domain-${Date.now()}@e2e.test`,
      telefone: '11900001111',
    },
  });

  const alunoMaior = await prisma.aluno.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Adulto Domain',
      cpf: uniqueCpf(),
      dataNasc: pastDate(25),
      genero: 'MASCULINO',
      email: `adulto-domain-${Date.now()}@e2e.test`,
      telefone: '11900002222',
    },
  });

  const alunoMenor = await prisma.aluno.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: 'Menor Domain',
      dataNasc: pastDate(10),
      genero: 'FEMININO',
    },
  });

  await prisma.alunoResponsavel.create({
    data: {
      alunoId: alunoMenor.id,
      responsavelId: responsavel.id,
      tipoVinculo: 'RESPONSAVEL_FINANCEIRO',
    },
  });

  return {
    contaId,
    userId,
    userEmail,
    modalidadeId: modalidade.id,
    salaId: sala.id,
    planoId: plano.id,
    turmaId: turma.id,
    turmaId2: turma2.id,
    alunoMaiorId: alunoMaior.id,
    alunoMenorId: alunoMenor.id,
    responsavelId: responsavel.id,
  };
}

async function authenticate(page: Page, ids: SeedIds) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente');

  const token = await encode({
    secret,
    token: {
      id: ids.userId,
      email: ids.userEmail,
      name: 'Admin Domain',
      role: 'ADMIN',
      contaId: ids.contaId,
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

async function cleanup(contaId: string, responsavelId: string) {
  try {
    await prisma.rematriculaOperacao.deleteMany({ where: { contaId } });
    await prisma.matriculaLog.deleteMany({ where: { matricula: { aluno: { contaId } } } });
    await prisma.matriculaTurma.deleteMany({ where: { matricula: { aluno: { contaId } } } });
    await prisma.cobranca.deleteMany({ where: { matricula: { aluno: { contaId } } } });
    await prisma.matricula.deleteMany({ where: { aluno: { contaId } } });
    await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
    await prisma.aluno.deleteMany({ where: { contaId } });
    await prisma.responsavel.deleteMany({ where: { id: responsavelId } });
    await prisma.turma.deleteMany({ where: { contaId } });
    await prisma.plano.deleteMany({ where: { contaId } });
    await prisma.sala.deleteMany({ where: { contaId } });
    await prisma.modalidade.deleteMany({ where: { contaId } });
    await prisma.usuario.deleteMany({ where: { contaId } });
    await prisma.conta.deleteMany({ where: { id: contaId } });
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// Helper: cria matrícula via API
async function criarMatriculaViaAPI(
  page: Page,
  ids: SeedIds,
  overrides: Record<string, unknown> = {},
) {
  const body = {
    contaId: ids.contaId,
    alunoId: ids.alunoMaiorId,
    planoId: ids.planoId,
    turmaId: ids.turmaId,
    dataInicio: new Date().toISOString().split('T')[0],
    dataFimContrato: futureDate(365).toISOString().split('T')[0],
    vencimentoDia: 10,
    taxaMatricula: 0,
    taxaIsenta: true,
    pagarTaxaAgora: false,
    gerarCobrancaTaxa: false,
    criarCobranca: false,
    ...overrides,
  };

  const res = await page.request.post('/api/matriculas', {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });

  return { status: res.status(), body: await res.json() };
}

// Helper: atualiza status via API
async function atualizarStatusViaAPI(
  page: Page,
  matriculaId: string,
  status: string,
  contaId: string,
) {
  const res = await page.request.patch(`/api/matriculas/${matriculaId}`, {
    data: { status, contaId },
    headers: { 'Content-Type': 'application/json' },
  });

  return { status: res.status(), body: await res.json() };
}

// Helper: editar matrícula via API
async function editarMatriculaViaAPI(
  page: Page,
  matriculaId: string,
  contaId: string,
  data: Record<string, unknown>,
) {
  const res = await page.request.patch(`/api/matriculas/${matriculaId}/editar`, {
    data: { contaId, ...data },
    headers: { 'Content-Type': 'application/json' },
  });

  return { status: res.status(), body: await res.json() };
}

test.describe('Regras de Domínio — Matrícula', () => {
  let ids: SeedIds;

  test.beforeAll(async () => {
    ids = await seed();
  });

  test.afterAll(async () => {
    await cleanup(ids.contaId, ids.responsavelId);
    await prisma.$disconnect();
  });

  // Limpar matrículas entre cada teste para evitar acúmulo de vagas/conflitos
  test.afterEach(async () => {
    await prisma.rematriculaOperacao.deleteMany({ where: { contaId: ids.contaId } });
    await prisma.matriculaLog.deleteMany({ where: { matricula: { aluno: { contaId: ids.contaId } } } });
    await prisma.matriculaTurma.deleteMany({ where: { matricula: { aluno: { contaId: ids.contaId } } } });
    await prisma.cobranca.deleteMany({ where: { matricula: { aluno: { contaId: ids.contaId } } } });
    await prisma.matricula.deleteMany({ where: { aluno: { contaId: ids.contaId } } });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 1 & 4: Máquina de estados + transições válidas/inválidas
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 1: transição ATIVA → PAUSADA deve ser permitida', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;
    expect(matriculaId).toBeTruthy();

    const result = await atualizarStatusViaAPI(page, matriculaId, 'PAUSADA', ids.contaId);
    expect(result.status).toBe(200);
  });

  test('Fase 1: transição ATIVA → CANCELADA deve ser permitida', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    const result = await atualizarStatusViaAPI(page, matriculaId, 'CANCELADA', ids.contaId);
    expect(result.status).toBe(200);
  });

  test('Fase 1: transição PAUSADA → ATIVA deve ser permitida', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    // ATIVA → PAUSADA
    const paused = await atualizarStatusViaAPI(page, matriculaId, 'PAUSADA', ids.contaId);
    expect(paused.status).toBe(200);

    // PAUSADA → ATIVA
    const reactivated = await atualizarStatusViaAPI(page, matriculaId, 'ATIVA', ids.contaId);
    expect(reactivated.status).toBe(200);
  });

  test('Fase 1: transição CANCELADA → ATIVA deve ser rejeitada (terminal)', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    // Cancelar
    await atualizarStatusViaAPI(page, matriculaId, 'CANCELADA', ids.contaId);

    // Tentar reativar: deve falhar
    const result = await atualizarStatusViaAPI(page, matriculaId, 'ATIVA', ids.contaId);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('terminal');
  });

  test('Fase 1: transição ATIVA → RECUSADA deve ser rejeitada (inválida)', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    const result = await atualizarStatusViaAPI(page, matriculaId, 'RECUSADA', ids.contaId);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('não é permitida');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 2: Validação de capacidade, conflitos e datas
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 2: criação com turma lotada deve ser rejeitada', async ({ page }) => {
    await authenticate(page, ids);

    // Criar 2 matrículas para lotar turma (capacidade=2)
    const m1 = await criarMatriculaViaAPI(page, ids);
    expect(m1.status).toBe(200);

    // Segunda matrícula: novo aluno para evitar conflito no mesmo aluno
    const m2 = await criarMatriculaViaAPI(page, ids, { alunoId: ids.alunoMenorId, responsavelFinanceiroId: ids.responsavelId });
    expect(m2.status).toBe(200);

    // Terceira matrícula: deveria falhar por capacidade
    // Usar um terceiro aluno criado ad-hoc
    const alunoExtra = await prisma.aluno.create({
      data: {
        id: randomUUID(),
        contaId: ids.contaId,
        nome: 'Extra Cap',
        cpf: uniqueCpf(),
        dataNasc: pastDate(20),
        genero: 'MASCULINO',
        email: `extra-cap-${Date.now()}@e2e.test`,
        telefone: '11900009999',
      },
    });

    const m3 = await criarMatriculaViaAPI(page, ids, { alunoId: alunoExtra.id });
    expect(m3.status).toBe(500);
    expect(JSON.stringify(m3.body)).toContain('vagas');

    await prisma.aluno.delete({ where: { id: alunoExtra.id } });
  });

  test('Fase 2: criação com conflito de horário deve ser rejeitada', async ({ page }) => {
    await authenticate(page, ids);

    // Primeiro matricular em Turma Alpha
    const m1 = await criarMatriculaViaAPI(page, ids);
    expect(m1.status).toBe(200);

    // Depois tentar na Turma Beta (mesmo aluno, mesmo horário)
    const m2 = await criarMatriculaViaAPI(page, ids, { turmaId: ids.turmaId2 });
    expect(m2.status).toBe(500);
    expect(JSON.stringify(m2.body)).toContain('Conflito');
  });

  test('Fase 2: criação com data fim antes de início deve ser rejeitada', async ({ page }) => {
    await authenticate(page, ids);

    const result = await criarMatriculaViaAPI(page, ids, {
      dataInicio: futureDate(30).toISOString().split('T')[0],
      dataFimContrato: new Date().toISOString().split('T')[0],
    });

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('posterior');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 3: Criação de MatriculaTurma (N:N)
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 3: matrícula deve criar registro MatriculaTurma', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    // Verificar no banco que MatriculaTurma foi criada
    const mt = await prisma.matriculaTurma.findMany({
      where: { matriculaId },
    });

    expect(mt.length).toBe(1);
    expect(mt[0].turmaId).toBe(ids.turmaId);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 4: Bloqueio de edição estrutural em status terminal
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 4: edição de matrícula CANCELADA deve ser rejeitada', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    // Cancelar
    await atualizarStatusViaAPI(page, matriculaId, 'CANCELADA', ids.contaId);

    // Tentar editar: deve falhar
    const result = await editarMatriculaViaAPI(page, matriculaId, ids.contaId, {
      turmaId: ids.turmaId2,
    });

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('não pode ser editada');
  });

  test('Fase 4: edição de matrícula ATIVA deve ser permitida', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    const result = await editarMatriculaViaAPI(page, matriculaId, ids.contaId, {
      motivo: 'Mudança para fase 4 test',
    });

    expect(result.status).toBe(200);
  });

  test('Fase 4: edição para turma lotada deve ser rejeitada', async ({ page }) => {
    await authenticate(page, ids);

    const base = await criarMatriculaViaAPI(page, ids, {
      alunoId: ids.alunoMaiorId,
      turmaId: ids.turmaId,
    });
    expect(base.status).toBe(200);

    const aluno2 = await prisma.aluno.create({
      data: {
        id: randomUUID(),
        contaId: ids.contaId,
        nome: 'Aluno Lotacao 2',
        dataNasc: pastDate(20),
        genero: 'MASCULINO',
      },
      select: { id: true },
    });

    const segundaVaga = await criarMatriculaViaAPI(page, ids, {
      alunoId: aluno2.id,
      turmaId: ids.turmaId,
    });
    expect(segundaVaga.status).toBe(200);

    const aluno3 = await prisma.aluno.create({
      data: {
        id: randomUUID(),
        contaId: ids.contaId,
        nome: 'Aluno Lotacao 3',
        dataNasc: pastDate(22),
        genero: 'FEMININO',
      },
      select: { id: true },
    });

    const origem = await criarMatriculaViaAPI(page, ids, {
      alunoId: aluno3.id,
      turmaId: ids.turmaId2,
    });
    expect(origem.status).toBe(200);

    const origemId = origem.body.data?.matricula?.id ?? origem.body.matricula?.id;
    const result = await editarMatriculaViaAPI(page, origemId, ids.contaId, {
      turmaId: ids.turmaId,
    });

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('não possui vagas disponíveis');
  });

  test('Fase 4: edição com conflito de horário deve ser rejeitada', async ({ page }) => {
    await authenticate(page, ids);

    const aluno = await prisma.aluno.create({
      data: {
        id: randomUUID(),
        contaId: ids.contaId,
        nome: 'Aluno Conflito Edicao',
        dataNasc: pastDate(19),
        genero: 'MASCULINO',
      },
      select: { id: true },
    });

    const turmaSemConflito = await prisma.turma.create({
      data: {
        id: randomUUID(),
        contaId: ids.contaId,
        nome: `Turma Sem Conflito ${Date.now()}`,
        modalidadeId: ids.modalidadeId,
        salaId: ids.salaId,
        capacidade: 20,
        status: 'ATIVO',
        diasSemana: ['TERCA', 'QUINTA'],
        horaInicio: '10:00',
        horaFim: '11:00',
      },
      select: { id: true },
    });

    const primeira = await criarMatriculaViaAPI(page, ids, {
      alunoId: aluno.id,
      turmaId: ids.turmaId,
    });
    expect(primeira.status).toBe(200);

    const segunda = await criarMatriculaViaAPI(page, ids, {
      alunoId: aluno.id,
      turmaId: turmaSemConflito.id,
    });
    expect(segunda.status).toBe(200);

    const segundaId = segunda.body.data?.matricula?.id ?? segunda.body.matricula?.id;
    const result = await editarMatriculaViaAPI(page, segundaId, ids.contaId, {
      turmaId: ids.turmaId2,
    });

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('Conflito de horário');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 5: Política de ativação
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 5: IMMEDIATE — matrícula com taxa deve iniciar ATIVA', async ({ page }) => {
    await authenticate(page, ids);

    // Garantir política IMMEDIATE
    await prisma.conta.update({
      where: { id: ids.contaId },
      data: { matriculaActivationPolicy: 'IMMEDIATE' },
    });

    const created = await criarMatriculaViaAPI(page, ids, {
      taxaMatricula: 100,
      taxaIsenta: false,
      gerarCobrancaTaxa: true,
    });
    expect(created.status).toBe(200);
    const matricula = created.body.data?.matricula ?? created.body.matricula;

    expect(matricula.status).toBe('ATIVA');
  });

  test('Fase 5: REQUIRES_PAYMENT — matrícula com taxa deve iniciar PENDENTE_TAXA', async ({ page }) => {
    await authenticate(page, ids);

    // Mudar política
    await prisma.conta.update({
      where: { id: ids.contaId },
      data: { matriculaActivationPolicy: 'REQUIRES_PAYMENT' },
    });

    const created = await criarMatriculaViaAPI(page, ids, {
      taxaMatricula: 100,
      taxaIsenta: false,
      gerarCobrancaTaxa: true,
    });
    expect(created.status).toBe(200);
    const matricula = created.body.data?.matricula ?? created.body.matricula;

    expect(matricula.status).toBe('PENDENTE_TAXA');

    // Restaurar política
    await prisma.conta.update({
      where: { id: ids.contaId },
      data: { matriculaActivationPolicy: 'IMMEDIATE' },
    });
  });

  test('Fase 5: REQUIRES_PAYMENT — isenta deve iniciar ATIVA', async ({ page }) => {
    await authenticate(page, ids);

    await prisma.conta.update({
      where: { id: ids.contaId },
      data: { matriculaActivationPolicy: 'REQUIRES_PAYMENT' },
    });

    const created = await criarMatriculaViaAPI(page, ids, {
      taxaMatricula: 0,
      taxaIsenta: true,
    });
    expect(created.status).toBe(200);
    const matricula = created.body.data?.matricula ?? created.body.matricula;

    expect(matricula.status).toBe('ATIVA');

    await prisma.conta.update({
      where: { id: ids.contaId },
      data: { matriculaActivationPolicy: 'IMMEDIATE' },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 6: Elegibilidade de rematrícula
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 6: matrícula ATIVA com contrato não expirado aparece como elegível', async ({ page }) => {
    await authenticate(page, ids);

    // Criar matrícula ATIVA com data futura
    const created = await criarMatriculaViaAPI(page, ids, {
      dataFimContrato: futureDate(15).toISOString().split('T')[0],
    });
    expect(created.status).toBe(200);

    // Acessar listagem de rematrículas
    await page.goto('/rematriculas');

    // Deve exibir o aluno na lista
    await expect(page.getByText('Adulto Domain')).toBeVisible({ timeout: 15000 });
  });

  test('Fase 6: matrícula CANCELADA não aparece na listagem de rematrículas', async ({ page }) => {
    await authenticate(page, ids);

    // Criar e cancelar matrícula
    const created = await criarMatriculaViaAPI(page, ids, {
      dataFimContrato: futureDate(15).toISOString().split('T')[0],
    });
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    // Cancelar
    await atualizarStatusViaAPI(page, matriculaId, 'CANCELADA', ids.contaId);

    // Navegar e verificar que não aparece
    await page.goto('/rematriculas');
    await page.waitForLoadState('networkidle');

    // Único aluno com nome "Adulto Domain" e matrícula cancelada não deveria aparecer
    // mas pode haver matrículas ATIVAS anteriores desse teste
    // Verificar via API que a matrícula cancelada não está na lista
    const res = await page.request.get(`/api/rematriculas?contaId=${ids.contaId}`);
    if (res.ok()) {
      const data = await res.json();
      const items = data.data ?? data.matriculas ?? data;
      if (Array.isArray(items)) {
        const cancelledFound = items.find(
          (item: Record<string, unknown>) =>
            (item as { matriculaId?: string }).matriculaId === matriculaId ||
            (item as { id?: string }).id === matriculaId,
        );
        expect(cancelledFound).toBeFalsy();
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 7: Transição terminal bloqueada (anomalia simulada via API)
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 7: dupla tentativa de cancelamento não quebra (idempotência)', async ({ page }) => {
    await authenticate(page, ids);

    const created = await criarMatriculaViaAPI(page, ids);
    expect(created.status).toBe(200);
    const matriculaId = created.body.data?.matricula?.id ?? created.body.matricula?.id;

    // Primeiro cancelamento
    const first = await atualizarStatusViaAPI(page, matriculaId, 'CANCELADA', ids.contaId);
    expect(first.status).toBe(200);

    // Segundo cancelamento (terminal → terminal): deve falhar graciosamente
    const second = await atualizarStatusViaAPI(page, matriculaId, 'CANCELADA', ids.contaId);
    expect(second.status).toBe(500);
    expect(JSON.stringify(second.body)).toContain('terminal');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Fase 8: Responsável financeiro obrigatório para menor
  // ──────────────────────────────────────────────────────────────────────────

  test('Fase 8: menor sem responsável financeiro com cobrança deve ser rejeitado', async ({ page }) => {
    await authenticate(page, ids);

    const result = await criarMatriculaViaAPI(page, ids, {
      alunoId: ids.alunoMenorId,
      responsavelFinanceiroId: null,
      criarCobranca: true,
    });

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain('Responsável financeiro');
  });

  test('Fase 8: menor com responsável financeiro deve ser aceito', async ({ page }) => {
    await authenticate(page, ids);

    const result = await criarMatriculaViaAPI(page, ids, {
      alunoId: ids.alunoMenorId,
      responsavelFinanceiroId: ids.responsavelId,
    });

    expect(result.status).toBe(200);
    const matriculaId = result.body.data?.matricula?.id ?? result.body.matricula?.id;
  });

  test('Fase 8: maior de idade sem responsável deve ser aceito', async ({ page }) => {
    await authenticate(page, ids);

    const result = await criarMatriculaViaAPI(page, ids, {
      criarCobranca: true,
      responsavelFinanceiroId: null,
    });

    expect(result.status).toBe(200);
    const matriculaId = result.body.data?.matricula?.id ?? result.body.matricula?.id;
  });
});
