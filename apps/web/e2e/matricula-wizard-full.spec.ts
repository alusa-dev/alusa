import { test, expect } from '@playwright/test';

/**
 * Teste E2E do fluxo completo do wizard de matrícula
 *
 * Valida:
 * - Etapa 1: Seleção de Aluno e Responsável
 * - Etapa 2: Seleção de Turma/Combo com validações de idade e capacidade
 * - Etapa 3: Seleção de Plano
 */

test.describe('Wizard de Matrícula - Fluxo Completo', () => {
  test.beforeEach(async () => {
    // TODO: Configurar autenticação e navegação para página de matrícula
    // await page.goto('/matriculas/novo');
  });

  test('fluxo completo: aluno → turma → plano', async ({ page }) => {
    // Etapa 1: Selecionar Aluno
    await test.step('Seleciona aluno existente', async () => {
      // Aguarda o carregamento da lista de alunos
      await page.waitForSelector('[data-step="aluno"]', { timeout: 5000 });

      // Seleciona o primeiro aluno disponível
      const primeiroAluno = page.locator('[data-aluno-card]').first();
      await expect(primeiroAluno).toBeVisible();
      await primeiroAluno.click();

      // Verifica se o aluno foi selecionado
      await expect(primeiroAluno).toHaveAttribute('data-selected', 'true');
    });

    await test.step('Confirma responsável financeiro', async () => {
      // Deve exibir responsável automaticamente se já cadastrado
      const responsavelSection = page.locator('[data-responsavel-section]');
      await expect(responsavelSection).toBeVisible();

      // Avança para próxima etapa
      const botaoProximo = page.locator('button:has-text("Próximo")');
      await expect(botaoProximo).toBeEnabled();
      await botaoProximo.click();
    });

    // Etapa 2: Selecionar Turma/Combo
    await test.step('Seleciona turma válida', async () => {
      await page.waitForSelector('[data-step="turmasCombo"]', { timeout: 5000 });

      // Seleciona modo TURMAS
      const modoTurmas = page.locator('button:has-text("Turmas Avulsas")');
      await modoTurmas.click();

      // Aguarda o carregamento das turmas
      await page.waitForSelector('[data-turma-card]', { timeout: 5000 });

      // Seleciona turma que passa na validação (verde)
      const turmaValida = page
        .locator('[data-turma-card][data-validation-status="success"]')
        .first();
      await turmaValida.click();

      // Verifica feedback de validação positivo
      const validacaoPositiva = page.locator(
        '[data-validation-feedback]:has-text("Validações passaram")',
      );
      await expect(validacaoPositiva).toBeVisible();
    });

    await test.step('Valida bloqueio em turma com problema de idade', async () => {
      // Seleciona turma com idade incompatível (se houver)
      const turmaInvalida = page
        .locator('[data-turma-card][data-validation-status="error"]')
        .first();

      if ((await turmaInvalida.count()) > 0) {
        await turmaInvalida.click();

        // Verifica mensagem de erro
        const mensagemErro = page.locator('[data-validation-feedback]:has-text("faixa etária")');
        await expect(mensagemErro).toBeVisible();

        // Botão próximo deve estar desabilitado
        const botaoProximo = page.locator('button:has-text("Próximo")');
        await expect(botaoProximo).toBeDisabled();

        // Reseleciona turma válida
        const turmaValida = page
          .locator('[data-turma-card][data-validation-status="success"]')
          .first();
        await turmaValida.click();
      }
    });

    await test.step('Avança para seleção de plano', async () => {
      const botaoProximo = page.locator('button:has-text("Próximo")');
      await expect(botaoProximo).toBeEnabled();
      await botaoProximo.click();
    });

    // Etapa 3: Selecionar Plano
    await test.step('Seleciona plano', async () => {
      await page.waitForSelector('[data-step="plano"]', { timeout: 5000 });

      // Aguarda carregamento dos planos
      await page.waitForSelector('[data-plano-card]', { timeout: 5000 });

      // Seleciona primeiro plano disponível
      const primeiroPlano = page.locator('[data-plano-card]').first();
      await primeiroPlano.click();

      // Verifica seleção visual
      await expect(primeiroPlano).toHaveClass(/border-violet-500/);

      // Verifica exibição do valor
      const valorPlano = primeiroPlano.locator('text=/R\\$\\s+[0-9,]+/');
      await expect(valorPlano).toBeVisible();
    });

    await test.step('Avança para etapa financeira', async () => {
      const botaoProximo = page.locator('button:has-text("Próximo")');
      await expect(botaoProximo).toBeEnabled();
      await botaoProximo.click();
    });

    // Validação final
    await test.step('Verifica resumo da matrícula', async () => {
      // Deve estar na etapa de resumo ou financeiro
      const resumoSection = page.locator('[data-step="resumo"], [data-step="financeiro"]');
      await expect(resumoSection).toBeVisible({ timeout: 5000 });

      // Verifica se os dados selecionados aparecem no resumo
      // (implementar verificações específicas conforme o layout do resumo)
    });
  });

  test('valida avisos de capacidade de turma', async ({ page }) => {
    await test.step('Exibe aviso para turma com poucas vagas', async () => {
      // Navega até a etapa de turmas
      // (replicar navegação da Etapa 1)

      // Busca turma com aviso de capacidade
      const turmaComAviso = page
        .locator('[data-turma-card][data-validation-status="warning"]')
        .first();

      if ((await turmaComAviso.count()) > 0) {
        await turmaComAviso.click();

        // Verifica mensagem de aviso (amarelo)
        const avisoCapacidade = page.locator(
          '[data-validation-feedback]:has-text("vagas restantes")',
        );
        await expect(avisoCapacidade).toBeVisible();
        await expect(avisoCapacidade).toHaveClass(/text-amber/);

        // Botão próximo deve estar habilitado (apenas aviso, não bloqueio)
        const botaoProximo = page.locator('button:has-text("Próximo")');
        await expect(botaoProximo).toBeEnabled();
      }
    });
  });

  test('valida formatação de horários e dias', async ({ page }) => {
    await test.step('Exibe horários formatados corretamente', async () => {
      // Navega até a etapa de turmas

      const turmaCard = page.locator('[data-turma-card]').first();
      await expect(turmaCard).toBeVisible();

      // Verifica formato de horário (ex: "8h às 10h")
      const horarioFormatado = turmaCard.locator('text=/[0-9]{1,2}h(\\s+às\\s+[0-9]{1,2}h)?/');
      await expect(horarioFormatado).toBeVisible();

      // Verifica formato de dias (ex: "Seg, Qua, Sex")
      const diasFormatados = turmaCard.locator(
        'text=/(Seg|Ter|Qua|Qui|Sex|Sáb|Dom)(,\\s+(Seg|Ter|Qua|Qui|Sex|Sáb|Dom))*/',
      );
      await expect(diasFormatados).toBeVisible();
    });
  });

  test('valida cálculo de desconto no plano', async ({ page }) => {
    await test.step('Aplica desconto percentual', async () => {
      // Navega até etapa de plano
      // Seleciona plano

      // Insere desconto percentual
      const inputDesconto = page.locator('input[name="descontoValor"]');
      await inputDesconto.fill('10');

      const tipoDesconto = page.locator('select[name="descontoTipo"]');
      await tipoDesconto.selectOption('PERCENTUAL');

      // Verifica cálculo do valor final
      // Valor deve ser 10% menor que o original
      // TODO: implementar verificação específica com valores conhecidos
      // const valorFinal = page.locator('[data-valor-final]');
      // await expect(valorFinal).toHaveText(/R\$ [0-9,]+/);
    });

    await test.step('Valida desconto inválido', async () => {
      // Tenta aplicar desconto maior que 100%
      const inputDesconto = page.locator('input[name="descontoValor"]');
      await inputDesconto.fill('150');

      const tipoDesconto = page.locator('select[name="descontoTipo"]');
      await tipoDesconto.selectOption('PERCENTUAL');

      // Deve exibir mensagem de erro
      const mensagemErro = page.locator('text=/maior que 100%/i');
      await expect(mensagemErro).toBeVisible();
    });
  });
});
