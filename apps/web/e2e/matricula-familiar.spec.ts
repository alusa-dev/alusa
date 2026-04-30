/**
 * E2E — Wizard de matrícula: Modo Familiar
 *
 * Execute com: pnpm --filter @alusa/web exec playwright test e2e/matricula-familiar.spec.ts --headed
 */
import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

// headed para inspeção visual conforme solicitado
test.use({ headless: false });

// ─── Prisma ──────────────────────────────────────────────────────────────────
const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return randomUUID();
}

/** CPF numérico único baseado em timestamp */
function uniqueCpf(): string {
  const ts = String(Date.now() + Math.floor(Math.random() * 1_000_000));
  return ts.slice(-11).padStart(11, '0');
}

/** CNPJ numérico único baseado em timestamp */
function uniqueCnpj(): string {
  const ts = String(Date.now() + Math.floor(Math.random() * 1_000_000));
  return ts.slice(-14).padStart(14, '0');
}

// ─── Tipos do Seed ────────────────────────────────────────────────────────────
interface SeedResult {
  contaId: string;
  userId: string;
  email: string;
  responsavelId: string;
  responsavelNome: string;
  aluno1Id: string;
  aluno1Nome: string;
  aluno2Id: string;
  aluno2Nome: string;
  aluno3Id: string;
  aluno3Nome: string;
  turma1Id: string;
  turma1Nome: string;
  turma2Id: string;
  turma2Nome: string;
  planoId: string;
  planoNome: string;
  modeloId: string;
  modeloNome: string;
}

// ─── Seed ────────────────────────────────────────────────────────────────────
async function seedFamiliarData(): Promise<SeedResult> {
  const contaId = uid();
  const userId = uid();
  const email = `admin-familiar-${Date.now()}@e2e.test`;

  await prisma.conta.create({
    data: { id: contaId, nome: 'Escola Familiar E2E', cpfCnpj: uniqueCnpj() },
  });

  const user = await prisma.usuario.create({
    data: {
      id: userId,
      contaId,
      nome: 'Admin Familiar',
      email,
      senhaHash: 'hash_nao_usado_no_e2e',
      role: 'ADMIN',
      status: 'ATIVO',
    },
    select: { id: true },
  });

  await prisma.conta.update({ where: { id: contaId }, data: { ownerUserId: user.id } });

  const responsavel = await prisma.responsavel.create({
    data: {
      id: uid(),
      contaId,
      nome: 'Maria Responsável',
      cpf: uniqueCpf(),
      email: `resp-${Date.now()}@e2e.test`,
      telefone: '11988887777',
      financeiro: true,
    },
    select: { id: true, nome: true },
  });

  const aluno1 = await prisma.aluno.create({
    data: { id: uid(), contaId, nome: 'João Familiar', dataNasc: new Date('2012-03-15'), status: 'ATIVO' },
    select: { id: true, nome: true },
  });
  const aluno2 = await prisma.aluno.create({
    data: { id: uid(), contaId, nome: 'Ana Familiar', dataNasc: new Date('2010-07-22'), status: 'ATIVO' },
    select: { id: true, nome: true },
  });
  const aluno3 = await prisma.aluno.create({
    data: { id: uid(), contaId, nome: 'Pedro Familiar', dataNasc: new Date('2014-01-10'), status: 'ATIVO' },
    select: { id: true, nome: true },
  });

  const modalidade = await prisma.modalidade.create({
    data: { id: uid(), contaId, nome: `Natação E2E ${uid().slice(0, 6)}`, status: 'ATIVO' },
    select: { id: true },
  });
  const sala = await prisma.sala.create({
    data: { id: uid(), contaId, nome: `Piscina ${uid().slice(0, 6)}`, capacidade: 20, status: 'ATIVO' },
    select: { id: true },
  });

  const turma1 = await prisma.turma.create({
    data: {
      id: uid(),
      contaId,
      nome: `Turma A ${uid().slice(0, 6)}`,
      modalidadeId: modalidade.id,
      salaId: sala.id,
      capacidade: 20,
      status: 'ATIVO',
      diasSemana: ['SEGUNDA', 'QUARTA'],
      horaInicio: '08:00',
      horaFim: '09:00',
    },
    select: { id: true, nome: true },
  });

  const turma2 = await prisma.turma.create({
    data: {
      id: uid(),
      contaId,
      nome: `Turma B ${uid().slice(0, 6)}`,
      modalidadeId: modalidade.id,
      salaId: sala.id,
      capacidade: 20,
      status: 'ATIVO',
      diasSemana: ['TERCA', 'QUINTA'],
      horaInicio: '10:00',
      horaFim: '11:00',
    },
    select: { id: true, nome: true },
  });

  const plano = await prisma.plano.create({
    data: { id: uid(), contaId, nome: `Plano Mensal ${uid().slice(0, 6)}`, valor: 200, periodicidade: 'MENSAL', status: 'ATIVO' },
    select: { id: true, nome: true },
  });

  const modelo = await prisma.contratoModelo.create({
    data: {
      id: uid(),
      contaId,
      nome: `Modelo E2E ${uid().slice(0, 6)}`,
      arquivoPdfUrl: 'https://example.com/modelo-e2e.pdf',
      hashSha256: uid().replace(/-/g, ''),
      status: 'ATIVO',
    },
    select: { id: true, nome: true },
  });

  return {
    contaId,
    userId,
    email,
    responsavelId: responsavel.id,
    responsavelNome: responsavel.nome,
    aluno1Id: aluno1.id,
    aluno1Nome: aluno1.nome,
    aluno2Id: aluno2.id,
    aluno2Nome: aluno2.nome,
    aluno3Id: aluno3.id,
    aluno3Nome: aluno3.nome,
    turma1Id: turma1.id,
    turma1Nome: turma1.nome,
    turma2Id: turma2.id,
    turma2Nome: turma2.nome,
    planoId: plano.id,
    planoNome: plano.nome,
    modeloId: modelo.id,
    modeloNome: modelo.nome,
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function authenticate(page: Page, seed: Pick<SeedResult, 'userId' | 'email' | 'contaId'>) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente no ambiente de teste');

  const token = await encode({
    secret,
    token: { id: seed.userId, email: seed.email, name: 'Admin Familiar', role: 'ADMIN', contaId: seed.contaId },
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

// ─── Navegação comum ──────────────────────────────────────────────────────────
async function openWizard(page: Page) {
  await page.goto('/matriculas');
  await page.waitForSelector('button[aria-label="Cadastrar matrícula"]', { timeout: 20_000 });
  await page.click('button[aria-label="Cadastrar matrícula"]');
  await expect(page.getByTestId('matricula-wizard')).toBeVisible({ timeout: 10_000 });
}

async function clickNext(page: Page) {
  await page.getByTestId('wizard-next').click();
}

async function clickBack(page: Page) {
  await page.getByTestId('wizard-back').click();
}

/**
 * Avança até o step `alunosFamiliares` passando por: modo → responsável
 */
async function navigateToAlunosStep(page: Page, seed: SeedResult) {
  // modo: FAMILIAR
  await page.getByTestId('modo-familiar').click();
  await clickNext(page);

  // responsavelFamiliar: buscar e selecionar
  await page.getByTestId('responsavel-search').fill(seed.responsavelNome.slice(0, 5));
  await page.waitForSelector('[data-testid="responsavel-selecionado"]', { state: 'hidden', timeout: 2_000 }).catch(() => {});
  await page.getByRole('button', { name: seed.responsavelNome }).click();
  await expect(page.getByTestId('responsavel-selecionado')).toBeVisible();
  await clickNext(page);

  // alunosFamiliares
  await expect(page.getByText('Alunos da família')).toBeVisible();
}

/**
 * Adiciona dois alunos e seleciona turmas para cada um.
 */
async function addTwoAlunosWithTurmas(page: Page, seed: SeedResult) {
  // aluno 1
  await page.getByTestId('alunos-search').fill(seed.aluno1Nome.slice(0, 5));
  await page.waitForTimeout(400); // aguarda debounce
  await page.getByRole('button', { name: seed.aluno1Nome }).click();

  // aluno 2
  await page.getByTestId('alunos-search').fill(seed.aluno2Nome.slice(0, 5));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: seed.aluno2Nome }).click();

  // selecionar turma para aluno 1
  await page.getByRole('combobox').filter({ hasText: 'Selecionar turma' }).first().click();
  await page.getByRole('option', { name: seed.turma1Nome }).click();

  // selecionar turma para aluno 2
  await page.getByRole('combobox').filter({ hasText: 'Selecionar turma' }).first().click();
  await page.getByRole('option', { name: seed.turma2Nome }).click();
}

/**
 * Avança pelos steps intermediários até o financeiro:
 * taxa → plano → bolsaBeneficios → jurosMulta → notificacoes → financeiro
 */
async function skipToFinanceiroStep(page: Page, seed: SeedResult) {
  // taxa: auto-preenchida
  await clickNext(page);

  // plano: selecionar
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: new RegExp(seed.planoNome) }).click();
  await clickNext(page);

  // bolsaBeneficios, jurosMulta, notificacoes: sem obrigatoriedades
  await clickNext(page); // bolsaBeneficios
  await clickNext(page); // jurosMulta
  await clickNext(page); // notificacoes

  await expect(page.getByText('Pagamento e Contrato')).toBeVisible();
}

/**
 * Preenche o step financeiro: data fim, forma de pagamento e modelo.
 */
async function fillFinanceiro(page: Page, seed: SeedResult) {
  // Data de fim: clicar no DatePicker e selecionar um dia futuro via calendário
  const triggerDataFim = page.getByRole('button', { name: /Selecione a data/ });
  await triggerDataFim.click();

  // Aguardar o calendário abrir (um grid aparece)
  await page.waitForSelector('[role="grid"]', { timeout: 5_000 });

  // Navegar para o próximo mês para garantir data futura
  const nextMonthBtn = page
    .getByRole('button')
    .filter({ hasText: /^›$/ })
    .or(page.locator('button[name="next month"]'))
    .or(page.locator('[aria-label*="next" i]').last())
    .or(page.getByLabel('Go to next month'));
  await nextMonthBtn.first().click().catch(async () => {
    // fallback: tentar botão de navegação do DayPicker
    await page.locator('nav button').last().click();
  });
  await page.waitForTimeout(300);

  // Clicar no dia 15 do mês
  await page
    .locator('[role="gridcell"]:not([aria-disabled="true"]) button')
    .filter({ hasText: /^15$/ })
    .first()
    .click();

  // Forma de pagamento: BOLETO
  await page.getByRole('button', { name: /Boleto/i }).click();

  // Modelo de contrato
  await page.getByRole('combobox').filter({ hasText: /Selecione um modelo|Carregando/i }).click();
  await page.getByRole('option', { name: new RegExp(seed.modeloNome) }).click();

  // Avançar para resumo
  await clickNext(page);
}

// ─── Tests ────────────────────────────────────────────────────────────────────
test.describe('Wizard — Modo Familiar', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ page }) => {
    seed = await seedFamiliarData();
    await authenticate(page, seed);
    await openWizard(page);
  });

  test.afterEach(async () => {
    // Cleanup isolado: remover apenas a conta criada neste teste
    await prisma.conta.delete({ where: { id: seed.contaId } }).catch(() => {});
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── 1. Seleção de modo ──────────────────────────────────────────────────────

  test('deve selecionar FAMILIAR e avançar para o step de responsável', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);

    await expect(page.getByText('Responsável financeiro')).toBeVisible();
  });

  test('deve selecionar INDIVIDUAL e avançar para o step de aluno', async ({ page }) => {
    await page.getByTestId('modo-individual').click();
    await clickNext(page);

    // Step responsavelFamiliar NÃO deve aparecer
    await expect(page.getByText('Responsável financeiro')).not.toBeVisible();
    // Step de aluno aparece
    await expect(page.getByText(/Selecionar aluno/i)).toBeVisible();
  });

  test('deve ocultar o botão Voltar no step inicial (modo)', async ({ page }) => {
    await expect(page.getByTestId('wizard-back')).not.toBeVisible();
  });

  test('deve exibir Voltar a partir do segundo step', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);

    await expect(page.getByTestId('wizard-back')).toBeVisible();
  });

  // ── 2. Troca de modo ────────────────────────────────────────────────────────

  test('deve trocar de FAMILIAR para INDIVIDUAL ao voltar e clicar em Individual', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);
    await expect(page.getByText('Responsável financeiro')).toBeVisible();

    await clickBack(page);

    await page.getByTestId('modo-individual').click();
    await clickNext(page);

    await expect(page.getByText('Responsável financeiro')).not.toBeVisible();
  });

  // ── 3. Step: Responsável ───────────────────────────────────────────────────

  test('deve bloquear Avançar sem responsável selecionado', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);

    await expect(page.getByTestId('wizard-next')).toBeDisabled();
  });

  test('deve buscar e selecionar responsável existente', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);

    await page.getByTestId('responsavel-search').fill(seed.responsavelNome.slice(0, 5));
    await page.waitForTimeout(400);

    await page.getByRole('button', { name: seed.responsavelNome }).click();

    await expect(page.getByTestId('responsavel-selecionado')).toBeVisible();
    await expect(page.getByText('Selecionado como responsável financeiro')).toBeVisible();
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
  });

  test('deve limpar seleção ao clicar em Trocar', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);

    await page.getByTestId('responsavel-search').fill(seed.responsavelNome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.responsavelNome }).click();
    await expect(page.getByTestId('responsavel-selecionado')).toBeVisible();

    await page.getByRole('button', { name: 'Trocar' }).click();

    await expect(page.getByTestId('responsavel-selecionado')).not.toBeVisible();
    await expect(page.getByTestId('wizard-next')).toBeDisabled();
  });

  test('deve cadastrar novo responsável via formulário inline', async ({ page }) => {
    await page.getByTestId('modo-familiar').click();
    await clickNext(page);

    await page.getByTestId('responsavel-novo-btn').click();
    await expect(page.getByTestId('responsavel-form')).toBeVisible();

    const novoNome = `Novo Resp ${Date.now()}`;
    await page.getByPlaceholder('Nome completo').fill(novoNome);
    await page.getByPlaceholder('email@exemplo.com').fill(`novo-resp-${Date.now()}@e2e.test`);

    await page.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(page.getByTestId('responsavel-selecionado')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Selecionado como responsável financeiro')).toBeVisible();
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
  });

  // ── 4. Step: Alunos da família ─────────────────────────────────────────────

  test('deve exibir aviso ao ter menos de 2 alunos', async ({ page }) => {
    await navigateToAlunosStep(page, seed);

    // Sem alunos: aviso "pelo menos 2"
    await expect(page.getByTestId('alunos-aviso-minimo')).toBeVisible();
    await expect(page.getByText(/Adicione pelo menos 2 alunos/)).toBeVisible();

    // Com 1 aluno: aviso "mais 1"
    await page.getByTestId('alunos-search').fill(seed.aluno1Nome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.aluno1Nome }).click();

    await expect(page.getByText(/Adicione mais 1 aluno para continuar/)).toBeVisible();
  });

  test('deve bloquear Avançar sem turma selecionada (2 alunos adicionados)', async ({ page }) => {
    await navigateToAlunosStep(page, seed);

    // Adicionar 2 alunos sem selecionar turma
    await page.getByTestId('alunos-search').fill(seed.aluno1Nome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.aluno1Nome }).click();

    await page.getByTestId('alunos-search').fill(seed.aluno2Nome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.aluno2Nome }).click();

    await expect(page.getByTestId('wizard-next')).toBeDisabled();
  });

  test('deve habilitar Avançar com 2 alunos e turmas selecionadas', async ({ page }) => {
    await navigateToAlunosStep(page, seed);
    await addTwoAlunosWithTurmas(page, seed);

    await expect(page.getByTestId('wizard-next')).toBeEnabled();
  });

  test('deve remover aluno da lista', async ({ page }) => {
    await navigateToAlunosStep(page, seed);

    await page.getByTestId('alunos-search').fill(seed.aluno1Nome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.aluno1Nome }).click();

    await page.getByTestId('alunos-search').fill(seed.aluno2Nome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.aluno2Nome }).click();

    // remover primeiro aluno
    await page.getByRole('button', { name: 'Remover aluno' }).first().click();

    // aviso "mais 1" deve voltar (apenas 1 aluno na lista)
    await expect(page.getByText(/Adicione mais 1 aluno para continuar/)).toBeVisible();
  });

  test('deve trocar para modo COMBO e mostrar select de combo', async ({ page }) => {
    await navigateToAlunosStep(page, seed);

    await page.getByRole('tab', { name: 'Combo' }).click();

    await page.getByTestId('alunos-search').fill(seed.aluno1Nome.slice(0, 5));
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: seed.aluno1Nome }).click();

    // Select de combo deve aparecer (placeholder "Selecionar combo")
    await expect(page.getByRole('combobox').filter({ hasText: 'Selecionar combo' })).toBeVisible();
  });

  // ── 5. Fluxo completo ──────────────────────────────────────────────────────

  test('deve completar fluxo familiar com sucesso (2 matrículas criadas)', async ({ page }) => {
    await navigateToAlunosStep(page, seed);
    await addTwoAlunosWithTurmas(page, seed);
    await clickNext(page); // alunosFamiliares → taxa

    await skipToFinanceiroStep(page, seed);
    await fillFinanceiro(page, seed);

    // resumo
    await expect(page.getByText('Cadastrar matrícula')).toBeVisible();
    await page.locator('#confirmacao-revisao-familiar').check();
    await expect(page.getByTestId('wizard-next')).toBeEnabled();

    await page.getByTestId('wizard-next').click();

    // painel de resultados
    await expect(page.getByText('Matrículas processadas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/2 criadas com sucesso/)).toBeVisible();

    // verificar no banco
    const count = await prisma.matricula.count({ where: { aluno: { contaId: seed.contaId } } });
    expect(count).toBe(2);
  });

  test('deve exibir falha parcial (1 sucesso, 1 erro) via mock de rota', async ({ page }) => {
    let callCount = 0;

    await page.route('**/api/matriculas', async (route) => {
      callCount++;
      if (callCount === 1) {
        // primeira chamada: falhar
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Erro simulado de teste' }),
        });
      } else {
        // demais: passar para o servidor real
        await route.continue();
      }
    });

    await navigateToAlunosStep(page, seed);
    await addTwoAlunosWithTurmas(page, seed);
    await clickNext(page);

    await skipToFinanceiroStep(page, seed);
    await fillFinanceiro(page, seed);

    await page.locator('#confirmacao-revisao-familiar').check();
    await page.getByTestId('wizard-next').click();

    await expect(page.getByText('Matrículas processadas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/1 criada com sucesso/)).toBeVisible();
    await expect(page.getByText(/1 com erro/)).toBeVisible();
    await expect(page.getByText(/Erro simulado de teste/)).toBeVisible();
  });

  test('deve fechar o painel de resultados e reiniciar o wizard', async ({ page }) => {
    await navigateToAlunosStep(page, seed);
    await addTwoAlunosWithTurmas(page, seed);
    await clickNext(page);

    await skipToFinanceiroStep(page, seed);
    await fillFinanceiro(page, seed);

    await page.locator('#confirmacao-revisao-familiar').check();
    await page.getByTestId('wizard-next').click();

    await expect(page.getByText('Matrículas processadas')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Fechar' }).click();

    // dialog deve fechar após clicar em Fechar
    await expect(page.getByTestId('matricula-wizard')).not.toBeVisible({ timeout: 5_000 });
  });
});
