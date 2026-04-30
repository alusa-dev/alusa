import { test, expect } from '@playwright/test';
import { resetDb } from '../utils/reset-db';
import { prisma, registerAndLogin, getContaId, createAlunoWithMatriculaAndSubscription, createWebhookAuthToken } from '../utils/fixtures';

const WEBHOOK_TOKEN = 'test-webhook-token-1';

test.describe('Webhook não ressuscita matrícula cancelada', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await registerAndLogin(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('SUBSCRIPTION_UPDATED ACTIVE não altera matrícula cancelada', async ({ request }) => {
    const contaId = await getContaId();

    await createWebhookAuthToken({ contaId, token: WEBHOOK_TOKEN });

    const { matriculaId, subscriptionId } = await createAlunoWithMatriculaAndSubscription({
      contaId,
      statusMatricula: 'CANCELADA',
      asaasSubscriptionId: 'sub-activate-1',
    });

    const payload = {
      id: 'evt-sub-updated-active-1',
      event: 'SUBSCRIPTION_UPDATED',
      subscription: {
        id: subscriptionId,
        status: 'ACTIVE',
        externalReference: `subscription:${subscriptionId}`,
      },
    };

    const res = await request.post('/api/webhooks/asaas', {
      headers: {
        'content-type': 'application/json',
        'access_token': WEBHOOK_TOKEN,
      },
      data: payload,
    });

    expect(res.ok()).toBe(true);

    const matricula = await prisma.matricula.findUnique({ where: { id: matriculaId }, select: { status: true } });
    expect(matricula?.status).toBe('CANCELADA');

    const audit = await prisma.auditLog.findFirst({
      where: {
        contaId,
        action: 'finance.webhook.matricula_update_skipped',
        entityId: matriculaId,
      },
      select: { id: true },
    });

    expect(audit).not.toBeNull();
  });
});
