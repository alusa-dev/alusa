import { test, expect } from '@playwright/test';

test('Deve cadastrar um colaborador através do wizard', async ({ page }) => {
  // Navegar para a página de colaboradores
  await page.goto('http://localhost:3001/colaboradores');
  
  // Aguardar a página carregar completamente
  await page.waitForLoadState('networkidle');
  
  // Verificar se existe o botão ou aguardar a página carregar
  await page.waitForSelector('[data-testid="add-colaborador"]', { timeout: 10000 });
  
  // Clicar no botão de adicionar colaborador
  await page.click('[data-testid="add-colaborador"]');
  
  // Aguardar o wizard abrir
  await expect(page.locator('[data-testid="colaborador-wizard"]')).toBeVisible();
  
  // === ETAPA 1: IDENTIFICAÇÃO ===
  
  // Preencher nome
  await page.fill('#colab-nome', 'João Silva Teste');
  
  // Preencher data de nascimento
  await page.fill('#colab-data-nasc', '01/01/1990');
  
  // Preencher CPF
  await page.fill('#colab-cpf', '111.444.777-35');
  
  // Preencher email
  await page.fill('#colab-email', 'joao.teste@email.com');
  
  // Preencher telefone
  await page.fill('#colab-telefone1', '(11) 99999-8888');
  
  // Próxima etapa
  await page.click('[data-testid="wizard-next"]');
  
  // === ETAPA 2: ENDEREÇO ===
  
  // Aguardar a etapa de endereço carregar
  await expect(page.locator('#colab-cep')).toBeVisible();
  
  // Preencher CEP
  await page.fill('#colab-cep', '01234-567');
  
  // Preencher logradouro
  await page.fill('#colab-logradouro', 'Rua Teste');
  
  // Preencher número
  await page.fill('#colab-numero', '123');
  
  // Preencher bairro
  await page.fill('#colab-bairro', 'Centro');
  
  // Preencher cidade
  await page.fill('#colab-cidade', 'São Paulo');
  
  // Preencher UF
  await page.fill('#colab-uf', 'SP');
  
  // Próxima etapa
  await page.click('[data-testid="wizard-next"]');
  
  // === ETAPA 3: VÍNCULO ===
  
  // Aguardar a etapa de vínculo carregar
  await expect(page.locator('#colab-admissao')).toBeVisible();
  
  // O cargo já tem valor padrão "RECEPCAO", não precisa alterar
  
  // Preencher data de admissão
  await page.fill('#colab-admissao', '01/01/2024');
  
  // Próxima etapa
  await page.click('[data-testid="wizard-next"]');
  
  // === ETAPA 4: FOTO (PULAR) ===
  
  // Próxima etapa (pular foto)
  await page.click('[data-testid="wizard-next"]');
  
  // === ETAPA 5: CONFIRMAR ===
  
  // Aguardar a etapa de confirmação carregar
  await expect(page.locator('[data-testid="wizard-confirmar"]')).toBeVisible();
  
  // Submeter o formulário
  await page.click('[data-testid="wizard-submit"]');
  
  // Aguardar o sucesso
  await expect(page.locator('text=Colaborador cadastrado com sucesso')).toBeVisible({ timeout: 10000 });
  
  // Verificar se o modal fechou
  await expect(page.locator('[data-testid="colaborador-wizard"]')).not.toBeVisible();
  
  // Verificar se o colaborador aparece na lista
  await expect(page.locator('text=João Silva Teste')).toBeVisible();
});