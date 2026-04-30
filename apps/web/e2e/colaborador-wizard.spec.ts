import { test, expect } from '@playwright/test';

test.describe('Wizard Colaborador', () => {
  test('fluxo completo de criação de colaborador', async ({ page }) => {
    // Navegar para a página de colaboradores
    await page.goto('/colaboradores');
    
    // Clicar no botão de adicionar colaborador
    await page.click('button:has-text("Adicionar Colaborador")');
    
    // Verificar se o wizard abriu
    await expect(page.getByTestId('colaborador-wizard')).toBeVisible();
    
    // Preencher dados de identificação
    await page.fill('#colab-nome', 'João Silva Teste');
    await page.fill('#colab-data-nasc', '01/01/1990');
    await page.fill('#colab-cpf', '111.444.777-35');
    await page.fill('#colab-email', 'joao.teste@email.com');
    await page.fill('#colab-telefone1', '(11) 99999-8888');
    
    // Avançar para próxima etapa
    await page.click('[data-testid="wizard-next"]');
    
    // Preencher endereço
    await page.fill('#colab-cep', '01234-567');
    await page.fill('#colab-logradouro', 'Rua Teste');
    await page.fill('#colab-numero', '123');
    await page.fill('#colab-bairro', 'Centro');
    await page.fill('#colab-cidade', 'São Paulo');
    await page.fill('#colab-uf', 'SP');
    
    // Avançar para próxima etapa
    await page.click('[data-testid="wizard-next"]');
    
    // Preencher vínculo (cargo já vem preenchido como RECEPCAO por padrão)
    await page.fill('#colab-admissao', '01/01/2024');
    
    // Avançar para foto (pular)
    await page.click('[data-testid="wizard-next"]');
    await page.click('[data-testid="wizard-next"]');
    
    // Confirmar dados
    await expect(page.getByTestId('wizard-confirmar')).toBeVisible();
    
    // Submeter
    await page.click('[data-testid="wizard-submit"]');
    
    // Verificar sucesso (aguardar toast ou fechamento do modal)
    await expect(page.getByTestId('colaborador-wizard')).not.toBeVisible({ timeout: 10000 });
  });

  test('abre a página de novo colaborador', async ({ page }) => {
    await page.goto('/colaboradores/new');
    await expect(page.getByTestId('colaborador-wizard')).toBeVisible();
  });
});
