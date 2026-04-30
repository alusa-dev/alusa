import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function waitSession(page: Page) {
  await expect.poll(async () => {
    const ok = await page.evaluate(async () => {
      const r = await fetch('/api/auth/session');
      if (!r.ok) return false;
      const j = (await r.json()) as { user?: { email?: string } };
      return Boolean(j.user?.email);
    });
    return ok;
  }, { timeout: 10_000 }).toBe(true);
}

test.describe('Owner + Invite + Accept — fluxo ponta-a-ponta', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('Cria Owner via first-register, valida bloqueios, convida e aceita', async ({ page, browser }) => {
    // 1) Primeiro registro cria ADMIN (Owner)
    await page.goto('/register');
  await page.fill('[data-testid="register-nome-first"]', 'Owner');
  await page.fill('[data-testid="register-nome-last"]', 'E2E');
  await page.fill('[data-testid="register-cpfCnpj"]', '11144477735');
  await page.fill('[data-testid="register-birthDate"]', '1990-01-01');
    await page.fill('[data-testid="register-email"]', 'owner+e2e@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
  await page.fill('[data-testid="register-senha-confirmar"]', 'SenhaFort3!');
  // aceitar termos
  await page.locator('form[data-testid="register-form"] input[type="checkbox"]').first().check();
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await waitSession(page);

    // 2) Obter ID do usuário atual (Owner)
    const me = await page.evaluate(async () => {
      const r = await fetch('/api/users/me');
      const j = await r.json();
      return j as { id: string; email: string; role: string };
    });
    expect(me.role).toBe('ADMIN');

    // 3) Bloqueio: não pode alterar status do Owner
    const patchOwner = await page.request.patch(`/api/users/${me.id}`, { data: { status: 'INATIVO' } });
    expect(patchOwner.status()).toBe(403);
    const patchErr = await patchOwner.json();
    expect(String(patchErr.error || '')).toMatch(/Owner/);

    // 4) Bloqueio: não pode excluir Owner (nem soft e nem hard)
    const delOwner = await page.request.delete(`/api/users/${me.id}`);
    expect(delOwner.status()).toBe(403);
    const delErr = await delOwner.json();
    expect(String(delErr.error || '')).toMatch(/Owner/);

    // 5) Bloqueio: convite ADMIN não permitido
    const adminInviteEmail = `admin.invite+${Date.now()}@example.com`;
    const inviteAdmin = await page.evaluate(async (payload) => {
      const r = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await r.json().catch(() => ({}));
      return { status: r.status, json };
    }, { email: adminInviteEmail, role: 'ADMIN' });
    expect(inviteAdmin.status).toBe(403);
  expect(String((inviteAdmin.json as { error?: string } | undefined)?.error || '')).toMatch(/ADMIN/i);

    // 6) Convite válido (RECEPCAO)
    const recepEmail = `reception+${Date.now()}@example.com`;
    const inviteResp = await page.evaluate(async (payload) => {
      const r = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await r.json().catch(() => ({}));
      return { status: r.status, json };
    }, { email: recepEmail, role: 'RECEPCAO' });
    expect(inviteResp.status).toBe(201);
  const token = (inviteResp.json as { invite?: { token?: string } } | undefined)?.invite?.token;
    expect(token).toBeTruthy();

    // 7) Convite duplicado deve retornar 409
    const duplicate = await page.evaluate(async (payload) => {
      const r = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return r.status;
    }, { email: recepEmail, role: 'RECEPCAO' });
    expect(duplicate).toBe(409);

    // 8) Aceite do convite em contexto separado (sem sessão do admin)
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    try {
      await p2.goto(`/register?token=${encodeURIComponent(String(token))}`);
      // Form de aceite usa o mesmo RegisterForm em modo invite
      await p2.getByTestId('register-nome-first').fill('Recep');
      await p2.getByTestId('register-nome-last').fill('E2E');
      await p2.getByTestId('register-senha').fill('Aa!23456');
      await p2.getByTestId('register-senha-confirmar').fill('Aa!23456');
      await p2.locator('form[data-testid="register-form"] input[type="checkbox"]').first().check();
      await p2.getByTestId('register-submit').click();
      await p2.waitForURL('**/dashboard');
      await expect(p2.locator('[data-testid="dashboard-header"]')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
