import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Helper para preencher campos mascarados (IMask) de forma estável
 * Limpa o campo e digita caractere por caractere com delay
 */
export async function fillMaskedInput(
  locator: Locator,
  value: string,
  options: { delay?: number; clearFirst?: boolean } = {}
): Promise<void> {
  const { delay = 50, clearFirst = true } = options;

  // Aguarda o campo estar visível e habilitado
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();

  // Foca no campo
  await locator.click();

  // Limpa o campo se necessário
  if (clearFirst) {
    await locator.fill('');
  }

  // Digita caractere por caractere
  await locator.type(value, { delay });
}

/**
 * Helper para preencher CPF (11 dígitos)
 * Aceita CPF com ou sem máscara, extrai apenas dígitos
 */
export async function fillCpf(locator: Locator, cpf: string): Promise<void> {
  const digits = cpf.replace(/\D/g, '');
  await fillMaskedInput(locator, digits, { delay: 30 });
}

/**
 * Helper para preencher CEP (8 dígitos)
 * Aceita CEP com ou sem máscara, extrai apenas dígitos
 */
export async function fillCep(locator: Locator, cep: string): Promise<void> {
  const digits = cep.replace(/\D/g, '');
  await fillMaskedInput(locator, digits, { delay: 30 });
}

/**
 * Helper para preencher telefone (10-11 dígitos)
 * Aceita telefone com ou sem máscara, extrai apenas dígitos
 */
export async function fillTelefone(locator: Locator, telefone: string): Promise<void> {
  const digits = telefone.replace(/\D/g, '');
  await fillMaskedInput(locator, digits, { delay: 30 });
}

/**
 * Mock do endpoint de CEP (ViaCEP) para testes estáveis
 */
export async function mockViaCep(page: Page, cep: string, endereco: {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
}): Promise<void> {
  const cleanCep = cep.replace(/\D/g, '');
  await page.route(`**/viacep.com.br/ws/${cleanCep}/json/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cep: `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`,
        logradouro: endereco.logradouro,
        bairro: endereco.bairro,
        localidade: endereco.localidade,
        uf: endereco.uf,
        erro: false,
      }),
    });
  });
}

/**
 * Mock genérico de CEP que retorna erro (CEP não encontrado)
 */
export async function mockViaCepNotFound(page: Page): Promise<void> {
  await page.route('**/viacep.com.br/ws/**/json/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ erro: true }),
    });
  });
}

/**
 * Aguarda o preenchimento automático do endereço após busca de CEP
 */
export async function waitForAddressAutoFill(
  page: Page,
  expectedLogradouro: string,
  timeout = 5000
): Promise<void> {
  // Aguarda o campo logradouro ter o valor esperado
  const logradouroInput = page.getByTestId('aluno-endereco-logradouro');
  await expect(logradouroInput).toHaveValue(expectedLogradouro, { timeout });
}
