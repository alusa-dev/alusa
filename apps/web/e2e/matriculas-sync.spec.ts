import { test, expect } from '@playwright/test';

type MatriculaItem = {
  id: string;
  status: string;
  dataInicio: string;
  dataFim: string | null;
  taxaMatricula: number;
  taxaStatus: string;
  taxaIsenta: boolean;
  vencimentoDia: number;
  aluno: { id: string; nome: string | null; cpf: string | null };
  plano: { id: string; nome: string; valor: number };
  responsavelFinanceiro: MatriculaItem['aluno'] | null;
  turma: MatriculaItem['aluno'] | null;
  combo: { id: string; nome: string } | null;
  cobrancas: Array<{
    id: string;
    valor: number;
    status: string;
    formaPagamento: string;
    tipo: string;
    vencimento: string;
  }>;
};

test.describe('Gestão de Matrículas – Sincronização com Asaas', () => {
  test('pausar, retomar, cancelar e reenviar taxa', async ({ page }) => {
    const state: { matriculas: MatriculaItem[] } = {
      matriculas: [
        {
          id: 'matricula-ativa',
          status: 'ATIVA',
          dataInicio: new Date().toISOString(),
          dataFim: null,
          taxaMatricula: 120,
          taxaStatus: 'PENDENTE',
          taxaIsenta: false,
          vencimentoDia: 5,
          aluno: { id: 'aluno-1', nome: 'Ana Souza', cpf: '12345678901' },
          plano: { id: 'plano-1', nome: 'Ballet Iniciante', valor: 199.9 },
          responsavelFinanceiro: null,
          turma: null,
          combo: null,
          cobrancas: [
            {
              id: 'cob-taxa-1',
              valor: 120,
              status: 'PENDENTE',
              formaPagamento: 'BOLETO',
              tipo: 'TAXA_MATRICULA',
              vencimento: new Date().toISOString(),
            },
          ],
        },
      ],
    };

    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'user-1', contaId: 'conta-1', name: 'QA User' } }),
      });
    });

    await page.route('**/api/matriculas?**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: state.matriculas,
          total: state.matriculas.length,
          page: 1,
          pageSize: 50,
        }),
      });
    });

    await page.route('**/api/matriculas/matricula-ativa/status', async (route) => {
      const payload = await route.request().postDataJSON();
      const matricula = state.matriculas[0];
      const previousStatus = matricula.status;
      const targetStatus = (payload as { status: string }).status;

      if (targetStatus === 'PAUSADA') matricula.status = 'PAUSADA';
      if (targetStatus === 'ATIVA') matricula.status = 'ATIVA';
      if (targetStatus === 'CANCELADA') {
        matricula.status = 'CANCELADA';
        matricula.cobrancas = matricula.cobrancas.map((c) =>
          c.status === 'PAGO' ? c : { ...c, status: 'CANCELADO' },
        );
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Status atualizado',
          data: {
            matriculaId: matricula.id,
            status: matricula.status,
            previousStatus,
            asaasAction:
              targetStatus === 'PAUSADA'
                ? 'SUSPEND'
                : targetStatus === 'ATIVA'
                  ? 'ACTIVATE'
                  : 'DELETE',
            cobrancasAtualizadas: 0,
            paymentSync: {
              totalFromAsaas: 0,
              matched: 0,
              updated: 0,
              warnings: [],
              details: [],
              expectedWebhooks:
                targetStatus === 'PAUSADA'
                  ? ['SUBSCRIPTION_INACTIVATED']
                  : targetStatus === 'ATIVA'
                    ? ['SUBSCRIPTION_UPDATED', 'PAYMENT_CREATED']
                    : ['SUBSCRIPTION_DELETED', 'PAYMENT_DELETED'],
            },
            nextDueDate: targetStatus === 'ATIVA' ? '2025-01-10' : null,
            asaasResponse: null,
          },
        }),
      });
    });

    await page.route('**/api/cobrancas/cob-taxa-1/resend', async (route) => {
      const matricula = state.matriculas[0];
      matricula.cobrancas = matricula.cobrancas.map((c) =>
        c.id === 'cob-taxa-1' ? { ...c, status: 'PAGO' } : c,
      );
      matricula.taxaStatus = 'PAGO';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Cobrança reenviada',
          data: {
            cobrancaId: 'cob-taxa-1',
            matriculaId: matricula.id,
            status: 'PAGO',
            previousStatus: 'PENDENTE',
            newTaxaStatus: 'PAGO',
            invoiceUrl: 'https://asaas.test/invoice.pdf',
            bankSlipUrl: null,
            pixQrCodeUrl: null,
            pixCopyPaste: null,
          },
        }),
      });
    });

    await page.goto('/matriculas');

    await expect(page.getByText('Ana Souza')).toBeVisible();
    await expect(page.getByTestId('matricula-status-matricula-ativa')).toContainText(/ativa/i);

    await page.getByTestId('matricula-actions-matricula-ativa').click();
    await page.getByTestId('matricula-action-pausar-matricula-ativa').click();
    await expect(page.getByTestId('matricula-status-matricula-ativa')).toContainText(/pausada/i);

    await page.getByTestId('matricula-actions-matricula-ativa').click();
    await page.getByTestId('matricula-action-retomar-matricula-ativa').click();
    await expect(page.getByTestId('matricula-status-matricula-ativa')).toContainText(/ativa/i);

    await page.getByTestId('matricula-taxa-matricula-ativa').click();
    await expect(page.getByRole('heading', { name: 'Taxa de Matrícula' })).toBeVisible();
    await page.getByRole('button', { name: 'Reenviar cobrança' }).click();
    await expect(page.getByTestId('taxa-links-container')).toBeVisible();
    await expect(page.getByTestId('taxa-invoice-link')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByTestId('matricula-taxa-matricula-ativa')).toContainText(/pago/i);

    await page.getByTestId('matricula-actions-matricula-ativa').click();
    await page.getByTestId('matricula-action-cancelar-matricula-ativa').click();
    await page.getByRole('button', { name: 'Cancelar matrícula' }).click();
    await expect(page.getByTestId('matricula-status-matricula-ativa')).toContainText(/cancelada/i);
  });
});
