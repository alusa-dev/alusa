import { test, expect } from '@playwright/test';
import { seedAdminAndLogin, prisma } from './helpers/auth';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { waitForPageReady } from './helpers/api';

test.describe('Regressão: cobrança paga sai de "Todas"', () => {
  test('cobrança pendente some de "Todas" ao mudar status para PAID', async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);

    const now = new Date();
    const midMonth = new Date(now.getFullYear(), now.getMonth(), 15);

    // Criar uma cobrança standalone pendente do mês atual
    const charge = await prisma.charge.create({
      data: {
        contaId,
        externalReference: `charge:regression:${randomUUID()}`,
        status: 'OPEN',
        payerName: 'Pagador Regressão',
        description: 'Cobrança para regressão',
        value: new Prisma.Decimal('123.45'),
        dueDate: midMonth,
        billingType: 'PIX',
      },
      select: { id: true },
    });

    // 1. Verificar que aparece em "Todas"
    await page.goto('/cobrancas');
    await waitForPageReady(page, 'Todas as Cobranças');
    await expect(page.getByText('Cobrança para regressão')).toBeVisible();

    // 2. Simular pagamento: alterar status para PAID direto no banco
    //    (equivale ao efeito de um webhook payment_confirmed)
    await prisma.charge.update({
      where: { id: charge.id },
      data: { status: 'PAID', statusUpdatedAt: new Date() },
    });

    // 3. Recarregar a página
    await page.reload();
    await waitForPageReady(page, 'Todas as Cobranças');

    // 4. A cobrança NÃO deve mais aparecer
    await expect(page.getByText('Cobrança para regressão')).not.toBeVisible();
  });

  test('cobrança cancelada some de "Todas"', async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);

    const now = new Date();
    const midMonth = new Date(now.getFullYear(), now.getMonth(), 15);

    const charge = await prisma.charge.create({
      data: {
        contaId,
        externalReference: `charge:cancel-regression:${randomUUID()}`,
        status: 'OPEN',
        payerName: 'Pagador Cancel',
        description: 'Cobrança para cancelar',
        value: new Prisma.Decimal('99.99'),
        dueDate: midMonth,
        billingType: 'BOLETO',
      },
      select: { id: true },
    });

    await page.goto('/cobrancas');
    await waitForPageReady(page, 'Todas as Cobranças');
    await expect(page.getByText('Cobrança para cancelar')).toBeVisible();

    // Simular cancelamento
    await prisma.charge.update({
      where: { id: charge.id },
      data: { status: 'CANCELED', statusUpdatedAt: new Date() },
    });

    await page.reload();
    await waitForPageReady(page, 'Todas as Cobranças');
    await expect(page.getByText('Cobrança para cancelar')).not.toBeVisible();
  });
});
