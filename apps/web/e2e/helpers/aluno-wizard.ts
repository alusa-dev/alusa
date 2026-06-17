import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from '../utils/auth';
import {
  fillCep,
  fillCpf,
  fillTelefone,
  mockViaCep,
  waitForAddressAutoFill,
} from '../utils/masked-input-helpers';

/** CPF válido para testes (dígitos verificadores corretos). */
export const VALID_CPF = '52998224725';

export const DEFAULT_CEP = '01001000';

export const DEFAULT_ADDRESS = {
  logradouro: 'Praça da Sé',
  bairro: 'Sé',
  localidade: 'São Paulo',
  uf: 'SP',
} as const;

export type IdentificacaoData = {
  nome: string;
  dataNasc: string;
  cpf?: string;
  email?: string;
  telefone?: string;
};

export type NovoResponsavelData = {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  cep?: string;
};

export async function mockKycRefresh(page: Page) {
  await page.route('**/api/kyc/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          gateStatus: 'NOT_REQUIRED',
          documentsRequired: false,
          canUseProduct: true,
          blockingReason: 'NONE',
          pendingExternal: [],
          pendingInternal: [],
          completed: [],
          nextAction: null,
          lastCheckedAt: null,
          refreshHintSeconds: null,
          message: 'ok',
        },
      }),
    });
  });
}

export async function dismissWelcomeWizard(page: Page) {
  const welcomeDialog = page.getByRole('dialog', { name: 'Bem-vindo à Alusa' });
  if (await welcomeDialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Fazer depois' }).click({ force: true });
    await expect(welcomeDialog).toBeHidden({ timeout: 5000 });
  }
}

export async function setupAlunoWizardTest(page: Page, adminEmail?: string) {
  const email = adminEmail ?? `admin+${randomUUID()}@e2e.test`;
  await seedAdminAndAuthenticate(page, { email });
  await mockKycRefresh(page);
  await mockViaCep(page, DEFAULT_CEP, DEFAULT_ADDRESS);
  await page.goto('/alunos');
  await expect(page.getByText('Gestão de Alunos')).toBeVisible();
  await dismissWelcomeWizard(page);
  return { adminEmail: email };
}

export async function waitForSessionContaId(page: Page, timeout = 20_000) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/auth/session');
        const json = (await res.json()) as { user?: { contaId?: string | null } };
        return json.user?.contaId ?? null;
      },
      { timeout },
    )
    .not.toBeNull();
}

export async function openAlunoWizard(page: Page) {
  await waitForSessionContaId(page);
  const openWizard = page.getByTestId('abrir-wizard-aluno');
  await expect(openWizard).toBeEnabled({ timeout: 20_000 });
  await openWizard.click();
  await expect(page.getByTestId('aluno-wizard')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identificação' })).toBeVisible();
}

export async function expectWizardProgress(page: Page, current: number, total: number) {
  await expect(page.getByTestId('wizard-progress-text')).toHaveText(
    `Etapa ${current} de ${total}`,
  );
}

export async function fillIdentificacao(page: Page, data: IdentificacaoData) {
  await page.locator('#aluno-nome').fill(data.nome);
  await page.locator('#aluno-data-nasc').fill(data.dataNasc);

  if (data.cpf) {
    await fillCpf(page.getByTestId('aluno-cpf'), data.cpf);
  }
  if (data.email) {
    await page.locator('#aluno-email').fill(data.email);
  }
  if (data.telefone) {
    await fillTelefone(page.getByTestId('aluno-telefone'), data.telefone);
  }
}

export async function clickWizardNext(page: Page) {
  await page.getByTestId('wizard-next').click();
}

export async function clickWizardPrev(page: Page) {
  await page.getByTestId('wizard-prev').click();
}

export async function clickConcluir(page: Page) {
  await page.getByTestId('aluno-concluir').click();
}

export async function fillEnderecoAluno(
  page: Page,
  options: { cep?: string; numero: string; autoFill?: boolean } = { numero: '123' },
) {
  const cep = options.cep ?? DEFAULT_CEP;
  await fillCep(page.getByTestId('aluno-endereco-cep'), cep);

  if (options.autoFill !== false) {
    await page.getByRole('button', { name: 'Buscar CEP automaticamente' }).click();
    await waitForAddressAutoFill(page, DEFAULT_ADDRESS.logradouro);
  }

  await page.getByTestId('aluno-endereco-numero').fill(options.numero);
}

export async function advanceThroughOptionalSteps(page: Page) {
  await clickWizardNext(page);
  await expect(page.getByRole('heading', { name: 'Saúde & Emergência' })).toBeVisible();
  await clickWizardNext(page);
  await expect(page.getByRole('heading', { name: 'Perfil & Classificação' })).toBeVisible();
  await clickWizardNext(page);
  await expect(page.getByRole('heading', { name: 'Foto do aluno' })).toBeVisible();
  await clickWizardNext(page);
}

export async function switchResponsavelModoNovo(page: Page) {
  await page.getByRole('tab', { name: 'Criar responsável' }).click();
  await expect(page.locator('#resp-nome')).toBeVisible();
}

export async function fillNovoResponsavel(page: Page, data: NovoResponsavelData) {
  await switchResponsavelModoNovo(page);
  await page.locator('#resp-nome').fill(data.nome);
  await fillCpf(page.getByTestId('resp-cpf'), data.cpf);
  await page.locator('#resp-email').fill(data.email);
  await fillTelefone(page.getByTestId('resp-telefone'), data.telefone);
  await fillCep(page.getByTestId('resp-cep'), data.cep ?? DEFAULT_CEP);
}

export async function selectResponsavelExistente(page: Page, query: string, nome: string) {
  await page.getByRole('tab', { name: 'Escolher responsável' }).click();
  const search = page.locator('#resp-existente-search');
  await search.fill(query);
  await page.getByRole('button', { name: nome }).click();
  await expect(page.getByText(nome).first()).toBeVisible();
}

export async function waitForAlunoCreateResponse(page: Page, timeout = 15_000) {
  const response = await page.waitForResponse(
    (r) => r.url().includes('/api/alunos') && r.request().method() === 'POST',
    { timeout },
  );
  return {
    status: response.status(),
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

export async function expectAlunoInList(page: Page, nome: string) {
  await expect(
    page.locator('[data-testid^="aluno-nome-"]').filter({ hasText: nome }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

export async function seedResponsavelForConta(
  prisma: PrismaClient,
  contaId: string,
  overrides?: Partial<{ nome: string; cpf: string; email: string; telefone: string }>,
) {
  const suffix = Date.now().toString().slice(-6);
  return prisma.responsavel.create({
    data: {
      id: randomUUID(),
      contaId,
      nome: overrides?.nome ?? `Responsável Seed ${suffix}`,
      cpf: overrides?.cpf ?? VALID_CPF,
      email: overrides?.email ?? `resp.seed+${suffix}@e2e.test`,
      telefone: overrides?.telefone ?? '11966665555',
      financeiro: true,
    },
    select: { id: true, nome: true, cpf: true, email: true },
  });
}
