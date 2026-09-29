import type { Page, APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

const BASE = '/api';

/**
 * Helper para chamadas à API interna durante testes E2E.
 * Usa o contexto de request do Playwright (cookies de sessão já injetados).
 */
export class ApiHelper {
  constructor(private readonly request: APIRequestContext) {}

  async getOperationalCharges(): Promise<{
    data: Array<{
      id: string;
      tipo: string;
      status: string;
      valor: number;
      vencimento: string | null;
      aluno: { id: string; nome: string };
      isGroup: boolean;
      groupType: string | null;
      installmentPlanId: string | null;
    }>;
    total: number;
  }> {
    const res = await this.request.get(`${BASE}/financeiro/cobrancas?statusView=open`);
    expect(res.ok(), `GET operational charges failed: ${res.status()}`).toBeTruthy();
    return res.json();
  }

  async getStandaloneCharges(): Promise<{
    data: Array<{
      id: string;
      tipo: string;
      status: string;
      valor: number;
      vencimento: string | null;
      aluno: { id: string; nome: string };
    }>;
    total: number;
  }> {
    const res = await this.request.get(`${BASE}/financeiro/cobrancas?statusView=open&scope=standalone`);
    expect(res.ok(), `GET standalone charges failed: ${res.status()}`).toBeTruthy();
    return res.json();
  }

  async getSubscriptions(): Promise<{
    data: Array<{ id: string; alunoNome: string; status: string }>;
    total: number;
  }> {
    const res = await this.request.get(`${BASE}/finance/subscriptions/enriched?page=1&pageSize=20`);
    expect(res.ok(), `GET subscriptions failed: ${res.status()}`).toBeTruthy();
    return res.json();
  }

  async getInstallmentPlans(): Promise<Array<{
    id: string;
    payerName: string;
    totalValue: number;
    installmentCount: number;
    statusConsolidado: string;
  }>> {
    const res = await this.request.get(`${BASE}/finance/installments/aggregated`);
    expect(res.ok(), `GET installment plans failed: ${res.status()}`).toBeTruthy();
    return res.json();
  }

  async getSubscriptionDetail(id: string): Promise<Record<string, unknown>> {
    const res = await this.request.get(`${BASE}/finance/subscriptions/${id}`);
    expect(res.ok(), `GET subscription detail failed: ${res.status()}`).toBeTruthy();
    return res.json();
  }

  async getInstallmentPlanDetail(id: string): Promise<Record<string, unknown>> {
    const res = await this.request.get(`${BASE}/finance/installments/${id}`);
    expect(res.ok(), `GET installment detail failed: ${res.status()}`).toBeTruthy();
    return res.json();
  }

  async getChargeDetail(id: string): Promise<Record<string, unknown>> {
    const res = await this.request.get(`${BASE}/cobrancas/${id}`);
    return res.json();
  }
}

/**
 * Espera a página estabilizar: heading visível + sem skeletons.
 */
export async function waitForPageReady(page: Page, headingText: string) {
  await expect(page.getByRole('heading', { name: headingText })).toBeVisible({ timeout: 15_000 });
  // Esperar skeletons sumirem
  await expect(page.locator('[data-slot="skeleton"], .animate-pulse')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Conta linhas visíveis em uma tabela (tbody > tr).
 */
export async function countTableRows(page: Page): Promise<number> {
  return page.locator('tbody > tr').count();
}
