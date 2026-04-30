import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { sendEmailVerificationForUser } from '../lib/auth-email-flow';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function issueVerificationLink(email: string) {
  const user = await prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`Usuário não encontrado para o e-mail ${email}`);
  }

  const verification = await sendEmailVerificationForUser(
    user.id,
    { ip: '127.0.0.1', userAgent: 'playwright' },
    { callbackUrl: '/finance/wizard' },
  );

  if (!verification.actionUrl) {
    throw new Error('Link de verificação não foi gerado.');
  }

  return verification.actionUrl;
}

test.describe('Primeira conta -> confirmar e-mail -> onboarding', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('cria a primeira conta, confirma o e-mail e redireciona para o onboarding financeiro', async ({ page }) => {
    const email = 'owner-e2e@example.com';

    await page.goto('/register');

    await page.getByTestId('register-nome-first').fill('Bryan');
    await page.getByTestId('register-nome-last').fill('Bezerra');
    await page.getByTestId('register-email').fill(email);
    await page.getByTestId('register-senha').fill('SenhaFort3!');
    await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');
    await page.locator('input[type="checkbox"]').check();

    await page.getByTestId('register-submit').click();

    await page.waitForURL('**/auth/confirm-email?callbackUrl=%2Ffinance%2Fwizard');
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    const verificationUrl = await issueVerificationLink(email);

    // Usar path relativo para que o Playwright resolva contra baseURL (localhost:3001),
    // evitando que buildAppUrl (que usa NEXTAUTH_URL do processo runner) gere porto errado.
    const verificationPath = new URL(verificationUrl).pathname + new URL(verificationUrl).search;
    await page.goto(verificationPath);

    await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();
    await expect(page.getByText('E-mail confirmado com sucesso.')).toBeVisible();

    await page.waitForURL('**/finance/wizard', { timeout: 15_000 });

    await expect(page.getByText('Passo 1 de 6')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tipo de Conta' })).toBeVisible();
  });
});