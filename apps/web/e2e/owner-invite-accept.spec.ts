import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from './utils/auth';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

test.describe('Owner + Invite + Accept — fluxo ponta-a-ponta', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('Owner válido preserva bloqueios, convida e aceita usuário', async ({ page, browser }) => {
    // 1) Usa a fixture canônica para o usuário owner; o cadastro público e a
    // confirmação de e-mail são cobertos pelos E2Es de autenticação.
    await seedAdminAndAuthenticate(page, { email: `owner-${randomUUID()}@e2e.test` });

    // 2) Obter ID do usuário atual (Owner)
    const me = await page.evaluate(async () => {
      const r = await fetch('/api/users/me');
      const j = await r.json();
      return j as { id: string; email: string; role: string };
    });
    expect(me.role).toBe('ADMIN');

    // 3) A própria conta não pode alterar o próprio status.
    const patchOwner = await page.request.patch(`/api/users/${me.id}`, { data: { status: 'INATIVO' } });
    expect(patchOwner.status()).toBe(400);
    const patchErr = await patchOwner.json();
    expect(String(patchErr.error || '')).toMatch(/próprio status/i);

    // 4) A própria conta não pode remover o próprio acesso.
    const delOwner = await page.request.delete(`/api/users/${me.id}`);
    expect(delOwner.status()).toBe(400);
    const delErr = await delOwner.json();
    expect(String(delErr.error || '')).toMatch(/próprio acesso/i);

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
      await p2.getByTestId('register-termos-checkbox').click();
      await p2.getByTestId('legal-acceptance-inner-checkbox').click();
      await p2.getByRole('button', { name: /Aceitar e continuar/i }).click();
      await p2.getByTestId('register-submit').click();
      await p2.waitForURL('**/auth/confirm-email?callbackUrl=%2Fdashboard');
      await expect(p2.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
