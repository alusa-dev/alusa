import { test, expect } from '@playwright/test';
import prisma from '../lib/prisma';
import { resetDb } from './utils/reset-db';
import { seedContratoPublico } from './utils/seed-contratos';
import crypto from 'crypto';

function buildAssinaturaHashPayload(input: {
  contratoId: string;
  conteudoFinal: string;
  cpf: string;
  nome: string;
  email?: string;
  assinadoEmIso: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return {
    v: 1,
    contratoId: input.contratoId,
    assinadoEm: input.assinadoEmIso,
    cpf: input.cpf,
    nome: input.nome,
    email: input.email || null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    conteudoFinal: input.conteudoFinal,
  };
}

test.describe('Contratos (público)', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('token inválido mostra erro', async ({ page }) => {
    await page.goto('/p/contrato/token-inexistente');
    await page.waitForResponse((r) => r.url().includes('/api/public/contrato/token-inexistente'));
    await expect(page.getByText(/não foi possível acessar/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/contrato não encontrado/i)).toBeVisible();
  });

  test('renderiza com sanitização (sem XSS / sem placeholders)', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    const other = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
      conteudoFinal: '<p>Contrato OUTRO</p>',
    });

    await page.goto(`/p/contrato/${seed.token}`);

    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();
    await expect(page.locator('#xss-text')).toBeVisible();

    const content = page.locator('div.prose');

    // Sanitização: não pode ter script nem handlers inline
    await expect(content.locator('script')).toHaveCount(0);
    await expect(content.locator('[onclick], [onerror]')).toHaveCount(0);

    // Conteúdo final não deve renderizar placeholders brutos
    await expect(content).not.toContainText(/\{\{.+?\}\}/);

    const href = await page.locator('#xss-link').getAttribute('href');
    expect(href ?? '').not.toMatch(/javascript:/i);

    const mention = page.locator('#mention');
    await expect(mention).toHaveAttribute('data-type', 'mention');
    await expect(mention).toHaveAttribute('data-id', '123');
    await expect(mention).toHaveAttribute('data-label', 'Aluno');
    await expect(mention).not.toHaveAttribute('data-foo');

    const style = await page.locator('#xss-style').getAttribute('style');
    expect(style ?? '').not.toMatch(/url\(/i);
    expect(style ?? '').not.toMatch(/@import/i);

    // Isolamento por token: não mistura contratos
    await expect(page.getByText('Contrato OUTRO')).toHaveCount(0);

    await page.goto(`/p/contrato/${other.token}`);
    await expect(page.getByText('Contrato OUTRO')).toBeVisible();
    await expect(page.locator('#xss-text')).toHaveCount(0);

  });

  test('assina com sucesso (responsável financeiro) e persiste no DB + reload', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();

    // Assinatura: CPF com pontuação deve funcionar (normalizado no server)
    await page.fill('#nome', 'Responsável E2E');
    await page.fill(
      '#cpf',
      (seed.responsavelCpfDigits ?? '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
    );

    await page.locator('#aceite').click();
    await page.getByRole('button', { name: /assinar contrato/i }).click();

    await expect(page.getByText(/contrato assinado!/i)).toBeVisible();

    const contratoDb = await prisma.contrato.findUnique({
      where: { tokenPublico: seed.token },
      select: {
        status: true,
        matricula: { select: { statusContrato: true, contratoAtualId: true } },
      },
    });
    expect(contratoDb?.status).toBe('ASSINADO');
    expect(contratoDb?.matricula.statusContrato).toBe('ATIVO');
    expect(contratoDb?.matricula.contratoAtualId).toBeTruthy();

    await page.reload();
    await expect(page.getByText(/contrato assinado!/i)).toBeVisible();
  });

  test('bloqueia re-assinatura quando já está ASSINADO (API) e mostra tela de sucesso', async ({ request, page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    const first = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      data: {
        nome: 'Responsável E2E',
        cpf: seed.responsavelCpfDigits,
        email: 'resp@e2e.local',
        userAgent: 'playwright',
      },
    });
    expect(first.status()).toBe(200);

    const second = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: {
        nome: 'Responsável E2E',
        cpf: seed.responsavelCpfDigits,
        email: 'resp@e2e.local',
        userAgent: 'playwright',
      },
    });
    expect(second.status()).toBe(400);
    const json = await second.json();
    expect(String(json?.error?.message || '')).toMatch(/já assinado/i);

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByText(/contrato assinado!/i)).toBeVisible();
  });

  test('bloqueia assinatura sem aceite', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();

    await page.fill('#nome', 'Responsável E2E');
    await page.fill('#cpf', (seed.responsavelCpfDigits ?? '00000000000'));

    await page.getByRole('button', { name: /assinar contrato/i }).click();
    await expect(page.getByText(/você deve ler e aceitar os termos/i)).toBeVisible();
  });

  test('bloqueia assinatura sem nome/CPF', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();

    await page.locator('#aceite').click();
    await page.getByRole('button', { name: /assinar contrato/i }).click();

    await expect(page.getByText(/preencha seu nome e cpf/i)).toBeVisible();
  });

  test('aluno maior de idade assina quando não há responsável financeiro', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
      withResponsavelFinanceiro: false,
      alunoDataNasc: new Date('2000-01-01T00:00:00.000Z'),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();

    await page.fill('#nome', 'Aluno E2E');
    await page.fill('#cpf', seed.alunoCpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
    await page.locator('#aceite').click();

    await page.getByRole('button', { name: /assinar contrato/i }).click();
    await expect(page.getByText(/contrato assinado!/i)).toBeVisible();
  });

  test('aluno menor de idade não pode assinar', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
      withResponsavelFinanceiro: false,
      alunoDataNasc: new Date('2018-01-01T00:00:00.000Z'),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();

    await page.fill('#nome', 'Aluno E2E');
    await page.fill('#cpf', seed.alunoCpfDigits);
    await page.locator('#aceite').click();

    await page.getByRole('button', { name: /assinar contrato/i }).click();

    await expect(page.getByText(/aluno menor de idade/i)).toBeVisible();
    await expect(page.getByText(/contrato assinado!/i)).toHaveCount(0);
  });

  test('rejeita assinatura com CPF não autorizado', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByRole('heading', { name: /assinatura de contrato/i })).toBeVisible();

    await page.fill('#nome', 'Pessoa Errada');
    await page.fill('#cpf', '000.000.000-00');
    await page.locator('#aceite').click();

    await page.getByRole('button', { name: /assinar contrato/i }).click();

    await expect(page.getByText(/cpf não corresponde/i)).toBeVisible();
    await expect(page.getByText(/contrato assinado!/i)).toHaveCount(0);
  });

  test('bloqueia link expirado', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() - 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByText(/não foi possível acessar/i)).toBeVisible();
    await expect(page.getByText(/link expirado/i)).toBeVisible();
  });

  test('bloqueia link expirado quando status é EXPIRADO', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'EXPIRADO',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByText(/não foi possível acessar/i)).toBeVisible();
    await expect(page.getByText(/link expirado/i)).toBeVisible();
  });

  test('bloqueia contrato cancelado', async ({ page }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'CANCELADO',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    await page.goto(`/p/contrato/${seed.token}`);
    await expect(page.getByText(/não foi possível acessar/i)).toBeVisible();
    await expect(page.getByText(/cancelado/i)).toBeVisible();
  });

  test('hash de assinatura é determinístico e auditável', async ({ request }) => {
    const seed = await seedContratoPublico(prisma, {
      status: 'PENDENTE',
      tokenExpiraEm: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      data: {
        nome: 'Responsável E2E',
        cpf: seed.responsavelCpfDigits,
        email: 'resp@e2e.local',
        userAgent: 'playwright',
      },
    });
    expect(res.status()).toBe(200);

    const contratoDb = await prisma.contrato.findUnique({
      where: { tokenPublico: seed.token },
      select: {
        id: true,
        conteudoFinal: true,
        assinadoCpf: true,
        assinadoPor: true,
        assinadoEmail: true,
        assinadoEm: true,
        assinadoIp: true,
        assinadoUserAgent: true,
        hashAssinatura: true,
      },
    });

    expect(contratoDb?.hashAssinatura).toBeTruthy();
    expect(contratoDb?.assinadoEm).toBeTruthy();

    const payload = buildAssinaturaHashPayload({
      contratoId: contratoDb!.id,
      conteudoFinal: contratoDb!.conteudoFinal,
      cpf: String(contratoDb!.assinadoCpf),
      nome: String(contratoDb!.assinadoPor),
      email: contratoDb!.assinadoEmail ?? undefined,
      assinadoEmIso: contratoDb!.assinadoEm!.toISOString(),
      ip: contratoDb!.assinadoIp,
      userAgent: contratoDb!.assinadoUserAgent,
    });
    const expected = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    expect(contratoDb!.hashAssinatura).toBe(expected);
  });
});
